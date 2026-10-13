const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const config = require('./config');
const store = require('./lib/store');
const ticket = require('./handlers/ticket');
const ranks = require('./lib/permissions');
const moderation = require('./handlers/moderation');
const { ask } = require('./lib/ai');
const api = require('./lib/api');

// Fail loudly and early if a required variable is missing — otherwise
// discord.js throws an obscure error much later with no context.
const REQUIRED = ['DISCORD_TOKEN', 'CLIENT_ID'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`FATAL: missing required variable(s): ${missing.join(', ')}`);
  console.error('Add these in Railway under the service -> Variables, then redeploy.');
  process.exit(1);
}

store.load();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Optional: auto-give the welcome role to members already in the server
  if (config.welcome.roleId) {
    const guild = client.guilds.cache.get(config.guildId);
    if (guild) {
      for (const m of guild.members.cache.values()) {
        await m.roles.add(config.welcome.roleId).catch(() => {});
      }
    }
  }

  startAutoClose();
  startAlertSweep();
  if (process.env.API_KEY) api.start(client);
});

/** Periodically flag tickets nobody has replied to. */
function startAlertSweep() {
  const run = () => ticket.sweepUnanswered(client).catch((e) => console.error('Alert sweep failed:', e.message));
  setTimeout(run, 60_000);
  setInterval(run, 5 * 60_000);
}

/** Warn then close tickets idle for TICKET_AUTO_CLOSE_HOURS. */
function startAutoClose() {
  const hours = config.ticket.autoCloseHours;
  if (!hours) return;

  setInterval(async () => {
    const stale = store.tickets.stale(hours * 60);
    for (const [channelId, t] of stale) {
      const channel = client.channels.cache.get(channelId);
      if (!channel) { store.tickets.delete(channelId); continue; }

      await channel
        .send(`⏳ This ticket has been inactive for ${hours}h and will close. Use \`/ticket close\` if you still need help.`)
        .catch(() => {});

      store.tickets.update(channelId, {
        status: 'closed',
        closedAt: Date.now(),
        closedBy: null,
        closeReason: `Auto-closed after ${hours}h of inactivity`,
      });
      store.counters.bump('closed');
      store.tickets.delete(channelId);
      await ticket.sendLog(channel.guild, t, 'closed', null, {
        channelId,
        content: `Auto-closed after ${hours}h of inactivity.`,
      }).catch(() => {});
      await channel.delete('Auto-closed: inactivity').catch(() => {});
      console.log(`Auto-closed ticket #${t.number}`);
    }
  }, 60 * 60_000);
}

client.on('guildMemberAdd', (member) => moderation.sendWelcome(member));

// Capture every ticket message live, and count staff replies
client.on('messageCreate', async (message) => {
  if (message.webhookId) return;

  const ticket = store.tickets.get(message.channelId);
  if (!ticket) return;
  if (message.author.id === client.user.id) return;

  store.tickets.logMessage(message.channelId, {
    id: message.id,
    authorId: message.author.id,
    authorTag: message.author.tag,
    content: message.content,
    attachments: message.attachments?.size || 0,
    at: Date.now(),
  });

  const isStaff = ranks.isStaff(message.member);
  if (!isStaff || message.author.id === ticket.userId) return;

  store.tickets.update(message.channelId, {
    staffReplies: (ticket.staffReplies ?? 0) + 1,
    alertLevel: 0, // replied, so silence-alerts can fire again later
  });
  await ticket.updateLiveBoard(message.guild);
});

moderation.registerSpamGuard(client, { isStaff: ranks.isStaff });

// ---- ticket buttons ----
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const [action, arg] = interaction.customId.split(':');

  try {
    if (action === 'tnew' && arg) {
      // "tnew:<category>" — open a ticket from the panel
      await ticket.openTicket(interaction, arg);
      return;
    }

    if (action === 'survey') {
      const ticketRecord = store.tickets.get(interaction.channelId);
      if (!ticketRecord) {
        return interaction.reply({ content: 'This survey is no longer active.', ephemeral: true }).catch(() => {});
      }
      if (interaction.user.id !== ticketRecord.userId) {
        return interaction.reply({ content: 'Only the ticket owner can rate this.', ephemeral: true });
      }
      await ticket.handleSurvey(interaction, arg);
      return;
    }

    switch (action) {
      case 'ticket':
        if (arg === 'close') await ticket.closeTicket(interaction, 'Closed from panel button');
        break;
    }
  } catch (err) {
    console.error('Button error:', err);
    const msg = 'Something went wrong handling that button.';
    if (interaction.deferred) await interaction.editReply(msg);
    else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  try {
    switch (commandName) {
      case 'ping':
        await interaction.reply(`Pong! Latency: ${Math.round(client.ws.ping)}ms`);
        break;

      case 'ticket': {
        const sub = interaction.options.getSubcommand();

        if (sub === 'setup') {
          await ticket.setup(interaction);
        } else if (sub === 'panel') {
          if (!ranks.hasRank(interaction.member, 0)) {
            await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
          } else {
            await ticket.postPanel(interaction);
          }
        } else if (sub === 'new') {
          const cat = interaction.options.getSubcommand(true)?.getString?.('category');
          const subject = interaction.options.getSubcommand(true)?.getString?.('subject');
          await ticket.openTicket(interaction, cat || 'general', subject);
        } else if (sub === 'close') {
          await ticket.closeTicket(interaction, interaction.options.getString('reason'));
        } else if (sub === 'feedback') {
          await ticket.feedback(interaction);
        } else if (sub === 'alerts') {
          await ticket.setupAlerts(interaction);
        } else if (sub === 'live') {
          await ticket.setupLiveBoard(interaction);
        } else if (sub === 'blacklist') {
          await ticket.blacklistUser(interaction, interaction.options.getUser('user', true), interaction.options.getString('reason'));
        } else if (sub === 'unblacklist') {
          await ticket.unblacklistUser(interaction, interaction.options.getUser('user', true));
        } else if (sub === 'resetabuse') {
          await ticket.resetAbuse(interaction, interaction.options.getUser('user', true));
        } else if (sub === 'abusestatus') {
          await ticket.abuseStatus(interaction, interaction.options.getUser('user'));
        } else if (sub === 'surveys') {
          await ticket.surveyStats(interaction);
        } else if (sub === 'add') {
          await ticket.addUser(interaction, interaction.options.getUser('user', true), 0);
        } else if (sub === 'remove') {
          await ticket.removeUser(interaction, interaction.options.getUser('user', true));
        } else if (sub === 'rename') {
          await ticket.renameTicket(interaction, interaction.options.getString('name', true));
        } else if (sub === 'priority') {
          await ticket.setPriority(interaction, interaction.options.getString('level', true), 1);
        } else if (sub === 'note') {
          await ticket.addNote(interaction, interaction.options.getString('body', true));
        } else if (sub === 'notes') {
          await ticket.showNotes(interaction);
        } else if (sub === 'deletenote') {
          await ticket.deleteNote(interaction, interaction.options.getString('id', true));
        } else if (sub === 'transfer') {
          await ticket.transferTicket(interaction, interaction.options.getUser('user', true));
        } else if (sub === 'list') {
          await ticket.listTickets(interaction, interaction.options.getString('filter', true));
        } else if (sub === 'remind') {
          await ticket.claimReminder(interaction);
        } else if (sub === 'stats') {
          await ticket.stats(interaction);
        }
        break;
      }

      case 'reset':
          if (!ranks.hasRank(interaction.member, 3)) {
            await interaction.reply({ content: '❌ You need rank: Owner+', ephemeral: true });
          } else {
            await ticket.resetData(interaction);
          }
          break;
      case 'profile': await moderation.profile(interaction); break;
      case 'mywarnings': await moderation.profileWarningsList(interaction); break;
      case 'timeout': await moderation.timeout(interaction); break;
      case 'untimeout': await moderation.untimeout(interaction); break;
      case 'warn': await moderation.warn(interaction); break;
      case 'warnings': await moderation.warnings(interaction); break;
      case 'removewarning': await moderation.removeWarning(interaction); break;
      case 'slowmode': await moderation.slowmode(interaction); break;
      case 'lockdown': await moderation.lockdown(interaction, interaction.options.getString('mode', true) === 'on'); break;
      case 'modsetup': await moderation.setupModlog(interaction); break;
      case 'modhistory': await moderation.modHistory(interaction); break;

      case 'kick': await moderation.kick(interaction); break;
      case 'ban': await moderation.ban(interaction); break;
      case 'unban': await moderation.unban(interaction); break;
      case 'purge': await moderation.purge(interaction); break;
      case 'lock': await moderation.lock(interaction, interaction.options.getString('mode')); break;

      case 'welcome':
        if (interaction.options.getSubcommand() === 'on') {
          store.welcomeChannel.set(interaction.channel.id);
          await interaction.reply(`Welcome messages are now enabled in ${interaction.channel}.`);
        } else if (interaction.options.getSubcommand() === 'off') {
          store.welcomeChannel.set(null);
          await interaction.reply('Welcome messages disabled.');
        } else {
          await moderation.sendWelcome({ user: interaction.user, guild: interaction.guild, id: interaction.user.id });
          await interaction.reply({ content: 'Test welcome sent.', ephemeral: true });
        }
        break;

      case 'ask':
        await interaction.deferReply();
        const answer = await ask(interaction.options.getString('question', true));
        const embed = new EmbedBuilder().setColor(config.colors.main).setDescription(answer.slice(0, 4000));
        await interaction.editReply({ embeds: [embed] });
        break;

      default:
        await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    const msg = 'Something went wrong. Check the bot logs.';
    if (interaction.deferred) await interaction.editReply(msg);
    else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
});

// Surface crashes in the Railway log instead of dying silently.
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));

client.on('error', (err) => console.error('client error:', err.message));

client.login(config.token).catch((err) => {
  console.error('LOGIN FAILED:', err.message);
  if (/token|unauthorized/i.test(err.message)) {
    console.error('Check DISCORD_TOKEN in Railway variables — reset it in the Developer Portal if unsure.');
  }
  process.exit(1);
});