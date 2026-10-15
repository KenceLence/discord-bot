const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const { token, clientId, guildId } = require('../config');

const commands = {
  ping: new SlashCommandBuilder().setName('ping').setDescription('Check if the bot is alive.'),

  ticket: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Full ticket system: open, claim, transfer, annotate, close')
    .addSubcommand((s) =>
      s.setName('new').setDescription('Open a support ticket')
        .addStringOption((o) =>
          o.setName('category').setDescription('Category')
            .addChoices({ name: 'General', value: 'general' }, { name: 'Billing', value: 'billing' }, { name: 'Bug report', value: 'bug' }, { name: 'Account', value: 'account' }, { name: 'Technical', value: 'technical' }, { name: 'Abuse report', value: 'abuse' })
            .setRequired(false))
        .addStringOption((o) => o.setName('subject').setDescription('One-line summary').setMaxLength(80).setRequired(false)))
    .addSubcommand((s) => s.setName('setup').setDescription('Create ticket categories + logs channel (Admin+)'))
    .addSubcommand((s) => s.setName('panel').setDescription('Post the ticket panel (staff only)'))
    .addSubcommand((s) => s.setName('close').setDescription('Close your ticket')
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)))
    .addSubcommand((s) => s.setName('feedback').setDescription('Low-rating feedback review (staff)'))
    .addSubcommand((s) => s.setName('alerts').setDescription('Create the unanswered-ticket alert channel (Admin+)'))
    .addSubcommand((s) => s.setName('live').setDescription('Create the live open-tickets board (Admin+)'))
    .addSubcommand((s) => s.setName('blacklist').setDescription('Block a user from opening tickets (Admin+)')
      .addUserOption((o) => o.setName('user').setDescription('User to block').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(200).setRequired(false)))
    .addSubcommand((s) => s.setName('unblacklist').setDescription('Unblock a user (Admin+)')
      .addUserOption((o) => o.setName('user').setDescription('User to unblock').setRequired(true)))
    .addSubcommand((s) => s.setName('resetabuse').setDescription('Clear strikes + cooldown (Moderator+)')
      .addUserOption((o) => o.setName('user').setDescription('User to reset').setRequired(true)))
    .addSubcommand((s) => s.setName('abusestatus').setDescription('View blacklist/strike/cooldown (staff)')
      .addUserOption((o) => o.setName('user').setDescription('User to check (defaults to you)').setRequired(false)))
    .addSubcommand((s) => s.setName('surveys').setDescription('Support satisfaction stats (staff)'))
    .addSubcommand((s) => s.setName('add').setDescription('Add a user to this ticket')
      .addUserOption((o) => o.setName('user').setDescription('User to add').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a user from this ticket')
      .addUserOption((o) => o.setName('user').setDescription('User to remove').setRequired(true)))
    .addSubcommand((s) => s.setName('rename').setDescription('Rename this ticket channel')
      .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true)))
    .addSubcommand((s) => s.setName('priority').setDescription('Set ticket priority (Moderator+)')
      .addStringOption((o) => o.setName('level').setDescription('Level')
        .addChoices({ name: 'Low', value: 'low' }, { name: 'Normal', value: 'normal' }, { name: 'High', value: 'high' }, { name: 'Urgent', value: 'urgent' })
        .setRequired(true)))
    .addSubcommand((s) => s.setName('note').setDescription('Add an internal note (staff only)')
      .addStringOption((o) => o.setName('body').setDescription('Note text').setMaxLength(500).setRequired(true)))
    .addSubcommand((s) => s.setName('notes').setDescription('View internal notes (staff only)'))
    .addSubcommand((s) => s.setName('deletenote').setDescription('Delete a note (Admin+)')
      .addStringOption((o) => o.setName('id').setDescription('Note ID').setRequired(true)))
    .addSubcommand((s) => s.setName('transfer').setDescription('Transfer ticket ownership (Moderator+)')
      .addUserOption((o) => o.setName('user').setDescription('New owner').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List tickets')
      .addStringOption((o) => o.setName('filter').setDescription('Filter')
        .addChoices({ name: 'Open', value: 'open' }, { name: 'Mine', value: 'mine' }, { name: 'All', value: 'all' })
        .setRequired(true)))
    .addSubcommand((s) => s.setName('remind').setDescription('Show unclaimed tickets (staff only)'))
    .addSubcommand((s) => s.setName('stats').setDescription('Ticket statistics (staff only)')),

  kick: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member')
    .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)),

  ban: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member')
    .addUserOption((o) => o.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)),

  unban: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by ID')
    .addStringOption((o) => o.setName('id').setDescription('User ID').setRequired(true)),

  purge: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete recent messages')
    .addIntegerOption((o) => o.setName('amount').setDescription('How many (1-100)').setMinValue(1).setMaxValue(100).setRequired(true)),

  reset: new SlashCommandBuilder()
    .setName('reset')
    .setDescription('WIPE ALL bot data: tickets, warnings, blacklist (Owner only)')
    .addStringOption((o) => o.setName('confirm').setDescription('Type DELETE EVERYTHING to confirm').setRequired(true)),

  profile: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View a member record: tickets, warnings, status')
    .addUserOption((o) => o.setName('user').setDescription('Member (defaults to you)').setRequired(false)),

  mywarnings: new SlashCommandBuilder()
    .setName('mywarnings')
    .setDescription('Check your own warnings'),

  timeout: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout (mute) a member')
    .addUserOption((o) => o.setName('user').setDescription('Member to timeout').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('Duration')
      .addChoices({ name: '10 minutes', value: '10m' }, { name: '1 hour', value: '1h' }, { name: '6 hours', value: '6h' }, { name: '12 hours', value: '12h' }, { name: '1 day', value: '1d' }, { name: '3 days', value: '3d' }, { name: '7 days', value: '7d' })
      .setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(200).setRequired(false)),

  untimeout: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove a member timeout')
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),

  warn: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member')
    .addUserOption((o) => o.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300).setRequired(true)),

  warnings: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View a member warnings')
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),

  removewarning: new SlashCommandBuilder()
    .setName('removewarning')
    .setDescription('Remove a warning (Admin+)')
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('id').setDescription('Warning ID').setRequired(true)),

  slowmode: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set this channel slowmode')
    .addIntegerOption((o) => o.setName('seconds').setDescription('Seconds between messages (0 = off)').setMinValue(0).setMaxValue(21600).setRequired(true)),

  lockdown: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Lock or unlock every channel')
    .addStringOption((o) => o.setName('mode').setDescription('on or off').addChoices({ name: 'Lock down', value: 'on' }, { name: 'Unlock all', value: 'off' }).setRequired(true)),

  modsetup: new SlashCommandBuilder()
    .setName('modsetup')
    .setDescription('Create the moderation log channel'),

  modhistory: new SlashCommandBuilder()
    .setName('modhistory')
    .setDescription('Recent moderation actions'),

  lock: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock or unlock this channel')
    .addStringOption((o) => o.setName('mode').setDescription('lock or unlock').addChoices({ name: 'Lock', value: 'lock' }, { name: 'Unlock', value: 'unlock' }).setRequired(true)),

  welcome: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Welcome system')
    .addSubcommand((s) => s.setName('on').setDescription('Enable welcome messages in this channel'))
    .addSubcommand((s) => s.setName('off').setDescription('Disable welcome messages'))
    .addSubcommand((s) => s.setName('test').setDescription('Send a test welcome message')),

  ask: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the AI a question')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true)),
};

module.exports = { commands };

// Only push to Discord when run directly (`npm run deploy-commands`),
// not when index.js imports the command definitions.
if (require.main === module) {
  (async () => {
    const body = Object.values(commands).map((c) => c.toJSON());
    const rest = new REST({ version: '10' }).setToken(token);

    if (guildId) {
      // Instant in your test server
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
      console.log('Slash commands registered (guild, instant).');
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body });
      console.log('Slash commands registered (global, may take ~1h).');
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}