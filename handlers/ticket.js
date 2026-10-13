const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const config = require('../config');
const store = require('../lib/store');
const ranks = require('../lib/permissions');
const { buildTranscript, summaryEmbed, formatDuration } = require('../lib/transcript');

const SUBJECTS = [
  { value: 'billing', label: 'Billing' },
  { value: 'bug', label: 'Bug report' },
  { value: 'account', label: 'Account help' },
  { value: 'technical', label: 'Technical issue' },
  { value: 'abuse', label: 'Report abuse' },
  { value: 'other', label: 'Other' },
];

const COLORS = { urgent: config.colors.danger, high: config.colors.warn, normal: config.colors.main, low: config.colors.neutral };

// ---------------------------------------------------------------- embeds

function panelEmbed() {
  return new EmbedBuilder()
    .setColor(config.colors.main)
    .setTitle('🎫 Support Tickets')
    .setDescription(
      'Need help from our team? Pick a category below and a **private channel** will be created just for you.\n\n' +
        'Our staff will claim your ticket and get back to you as soon as possible.'
    )
    .addFields(
      { name: 'Before you open a ticket', value: '1. Search the FAQ channel\n2. Make sure you have read the rules\n3. Include as much detail as possible', inline: false },
      { name: 'What you get', value: '• Private staff-only channel\n• Claimed by a real staff member\n• Written transcript kept for your records', inline: false }
    )
    .setFooter({ text: 'Tickets are for support only — no spam or advertising.' })
    .setTimestamp();
}

function panelButtons() {
  return new ActionRowBuilder().addComponents(
    ...SUBJECTS.slice(0, 5).map((s) =>
      new ButtonBuilder()
        .setCustomId(`tnew:${s.value}`)
        .setLabel(s.label)
        .setStyle(ButtonStyle.Primary)
    )
  );
}

function ticketHeaderEmbed(ticket) {
  return new EmbedBuilder()
    .setColor(COLORS[ticket.priority])
    .setTitle(`Ticket #${ticket.number} — ${ticket.subject || 'General'}`)
    .setDescription(`Opened by <@${ticket.userId}>. Our staff can see this ticket and will reply here.`)
    .addFields(
      { name: 'Priority', value: ticket.priority, inline: true },
      { name: 'Category', value: ticket.category, inline: true },
      { name: 'Opened', value: `<t:${Math.floor(ticket.createdAt / 1000)}:R>`, inline: true }
    )
    .setTimestamp(ticket.createdAt);
}

function controlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Danger)
  );
}

async function refreshControls(channel, ticket) {
  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (!messages) return;
  const header = messages.find((m) => m.components.length > 0 && m.author?.id === channel.client?.user?.id);
  if (header) {
    await header.edit({ embeds: [ticketHeaderEmbed(ticket)], components: [controlRow()] }).catch(() => {});
  }
}

// ---------------------------------------------------------------- helpers

/** Ticket config: values saved by /ticket setup take priority over .env. */
function cfg() {
  const s = store.settings.get();
  return {
    categoryId: s.ticketCategoryId || config.ticket.categoryId,
    closedCategoryId: s.closedCategoryId || config.ticket.closedCategoryId,
    logChannelId: s.logChannelId || config.ticket.logChannelId,
    liveChannelId: s.liveChannelId || config.ticket.liveChannelId,
    alertChannelId: s.alertChannelId || process.env.TICKET_ALERT_CHANNEL_ID,
    archiveMinutes: s.archiveMinutes ?? config.ticket.archiveMinutes,
  };
}

const LOG_ICONS = { opened: '📂', closed: '🔒', transferred: '📝', priority: '📝' };

const LOG_COLORS = {
  opened: config.colors.success,
  closed: config.colors.danger,
  transferred: config.colors.warn,
  priority: config.colors.warn,
};

function logEmbed(ticket, action, actor, channelId) {
  const icon = LOG_ICONS[action] || '📝';
  return new EmbedBuilder()
    .setColor(LOG_COLORS[action] || config.colors.neutral)
    .setTitle(`${icon} Ticket #${ticket.number} ${action}`)
    .setDescription(
      [
        `**Channel:** ${channelId ? `<#${channelId}>` : 'already deleted'}`,
        `**Owner:** <@${ticket.userId}>`,
        `**Subject:** ${ticket.subject || 'none'}`,
        `**Category:** ${ticket.category}`,
        `**Priority:** ${ticket.priority}`,
        `**Staff replies:** ${ticket.staffReplies ?? 0}`,
        `**Action by:** ${actor ? `<@${actor}>` : 'Auto-system'}`,
      ].join('\n')
    )
    .setFooter({ text: `Ticket #${ticket.number}` })
    .setTimestamp();
}

/** Send to the logs channel. Silently no-ops if it is not set up yet. */
async function sendLog(guild, ticket, action, actor, { channelId = null, content = '' } = {}) {
  const logId = cfg().logChannelId;
  if (!logId) return null;

  const log = await guild.channels.fetch(logId).catch(() => null);
  if (!log) return null;

  await log.send({ content: content || undefined, embeds: [logEmbed(ticket, action, actor, channelId)] }).catch(() => {});
  return log;
}

/** Reject with a friendly ephemeral message. */
function deny(interaction, message) {
  return interaction.reply({ content: `❌ ${message}`, ephemeral: true });
}

function requireConfig() {
  if (!cfg().categoryId) {
    return 'Ticket system is not set up yet — run `/ticket setup` (Admin+) first.';
  }
  return null;
}

// ---------------------------------------------------------------- setup

/**
 * Creates the Tickets category, Closed Tickets category and the logs channel,
 * then persists their IDs. Safe to re-run: reuses anything that already exists.
 */
async function setup(interaction) {
  if (!ranks.hasRank(interaction.member, 2)) return deny(interaction, 'You need rank: Admin+');
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return deny(interaction, 'I need the `MANAGE_CHANNELS` permission.');
  }

  await interaction.deferReply({ ephemeral: true });
  const { guild } = interaction;

  const findOrCreate = async (name, type, extra = {}) => {
    const existing = guild.channels.cache.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    return guild.channels.create({ name, type, reason: 'Ticket system setup', ...extra });
  };

  const tickets = await findOrCreate('Tickets', ChannelType.GuildCategory);
  const closed = await findOrCreate('Closed Tickets', ChannelType.GuildCategory);

  // Logs channel: private to staff, never viewable by @everyone
  let logs = guild.channels.cache.find(
    (c) => c.name.toLowerCase() === 'ticket-logs' || (c.id === cfg().logChannelId)
  );

  if (!logs) {
    logs = await guild.channels.create({
      name: 'ticket-logs',
      type: ChannelType.GuildText,
      parent: closed.id,
      topic: 'Automated ticket activity log. Do not delete.',
      reason: 'Ticket system setup',
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        ...config.RANK_ORDER.flatMap((rank, level) =>
          config.ranks[rank].map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
        ),
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks] },
      ],
    });
  }

  store.settings.set({
    ticketCategoryId: tickets.id,
    closedCategoryId: closed.id,
    logChannelId: logs.id,
  });

  await logs.send('📋 Ticket logging enabled. All ticket activity will be recorded here.').catch(() => {});

  await interaction.editReply(
    `✅ Ticket system set up.\n\n` +
      `- Tickets category: <#${tickets.id}>\n` +
      `- Closed Tickets category: <#${closed.id}>\n` +
      `- Logs channel: <#${logs.id}>\n\n` +
      'Run `/ticket panel` in a public channel to let members open tickets.'
  );
}

// ---------------------------------------------------------------- create

/** Blacklist / strike / cooldown gate. Returns a message if blocked. */
function checkAbuse(userId) {
  const black = store.blacklist.is(userId);
  if (black) {
    return `You are blacklisted from opening tickets. Reason: **${black.reason}**. Contact staff if this is a mistake.`;
  }

  const strikes = store.strikes.count(userId);
  if (strikes >= config.ticket.maxStrikes) {
    const mins = Math.ceil(
      (store.strikes.list(userId)[0].at + config.ticket.strikeWindowMinutes * 60_000 - Date.now()) / 60_000
    );
    return `You have too many recent tickets (${strikes}). Ticket creation is blocked for ${Math.max(1, mins)} more minute(s).`;
  }

  const remaining = store.cooldowns.remaining(userId);
  if (remaining > 0) {
    const mins = Math.ceil(remaining / 60_000);
    return `Please wait **${mins} minute(s)** before opening another ticket.`;
  }

  return null;
}

async function openTicket(interaction, category = 'general', subject = null) {
  const cfgErr = requireConfig();
  if (cfgErr) return deny(interaction, cfgErr);

  const { guild, user } = interaction;
  const { categoryId, logChannelId } = cfg();

  const blocked = checkAbuse(user.id);
  if (blocked) return deny(interaction, blocked);

  const open = store.tickets.byUser(user.id);
  if (open.length >= config.ticket.maxOpenPerUser) {
    return deny(
      interaction,
      `You already have ${open.length} open ticket(s) (limit ${config.ticket.maxOpenPerUser}). Close one first: ${open
        .map((t) => `#${t.number}`)
        .join(', ')}`
    );
  }

  const subjectText = subject || SUBJECTS.find((s) => s.value === category)?.label || 'General';
  const n = store.tickets.peekNumber();
  const staffRoles = ranks.staffRoleIds(guild);

  const channel = await guild.channels.create({
    name: `tkt-${String(n).padStart(4, '0')}-${user.username.toLowerCase().slice(0, 16)}`,
    type: ChannelType.GuildText,
    parent: categoryId,
    topic: `Ticket #${n} • ${user.tag} • ${subjectText}`,
    reason: `Ticket #${n} opened by ${user.tag}`,
    permissionOverwrites: [
      ...ranks.buildOverwrites(guild, user.id),
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      },
    ],
  });

  const ticket = store.tickets.create(channel.id, { userId: user.id, subject: subjectText, category });

  await channel.send({
    content: `<@${user.id}> welcome! Describe your issue below — our staff can see this ticket and will reply here.`,
    embeds: [ticketHeaderEmbed(ticket)],
    components: [controlRow()],
  });

  // Always log the open and ping staff
  if (logChannelId) {
    const ping = staffRoles.map((id) => `<@&${id}>`).join(' ');
    await sendLog(guild, ticket, 'opened', user.id, {
      channelId: channel.id,
      content: `${ping}\nNew ticket: <#${channel.id}>`,
    });
  }

  await updateLiveBoard(guild);

  return interaction.reply({ content: `✅ Your ticket is ready: ${channel}`, ephemeral: true });
}

// ---------------------------------------------------------------- close

async function closeTicket(interaction, reason) {
  const channel = interaction.channel;
  const ticket = store.tickets.get(channel.id);

  if (!ticket) return deny(interaction, 'This is not a ticket channel.');

  const requester = interaction.user.id;
  const isOwner = ticket.userId === requester;
  const isStaff = ranks.isStaff(interaction.member);

  if (!isOwner && !isStaff) return deny(interaction, 'You can only close your own ticket.');

  const durationMin = (Date.now() - ticket.createdAt) / 60_000;

  store.tickets.update(channel.id, {
    status: 'closed',
    closedAt: Date.now(),
    closedBy: requester,
    closeReason: reason || 'No reason given',
  });
  const t = store.tickets.get(channel.id);
  store.counters.bump('closed');
  if (isStaff) store.staff.stat(requester, 'closes');

  // Start the cooldown for the owner so they cannot instantly reopen
  if (config.ticket.cooldownMinutes > 0) {
    store.cooldowns.set(ticket.userId, Date.now() + config.ticket.cooldownMinutes * 60_000);
  }

  // Strike: the owner closed very fast and no staff member ever replied
  const strike = !isStaff && durationMin < config.ticket.strikeUnderMinutes && (t.staffReplies ?? 0) === 0;
  if (strike) {
    const reason = `Opened and closed ticket #${t.number} in ${durationMin.toFixed(1)}m with no staff reply`;
    const strikes = store.strikes.add(ticket.userId, reason, config.ticket.strikeWindowMinutes * 60_000);
    await sendStrikeDm({ ...t, guild: channel.guild }, strikes, reason);
  }

  const transcript = await buildTranscript(channel, t);
  const { closedCategoryId, logChannelId, archiveMinutes } = cfg();

  const deleteIn = archiveMinutes > 0 ? archiveMinutes * 60 : 5;
  await interaction.reply({
    content: `🔒 Ticket closed. This channel will be deleted in ${archiveMinutes > 0 ? archiveMinutes + ' minute(s)' : '5 seconds'}.`,
  });

  // Ask the owner to rate the support they received
  await sendSurvey(channel, t, durationMin);

  // Log the close + summary + full transcript before the channel disappears
  if (logChannelId) {
    const log = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
    if (log) {
      await sendLog(interaction.guild, t, 'closed', requester, { channelId: channel.id });

      if (strike) {
        await log
          .send(`⚠️ <@${ticket.userId}> now has **${store.strikes.count(ticket.userId)}** ticket strike(s) — closed ticket #${t.number} in ${durationMin.toFixed(1)}m with no staff reply.`)
          .catch(() => {});
      }

      if (transcript) {
        await log.send({ embeds: [summaryEmbed(t, transcript.messageCount, requester)] }).catch(() => {});
        for (const embed of transcript.embeds) {
          await log.send({ embeds: [embed] }).catch(() => {});
        }
        if (transcript.truncated) {
          await log.send('⚠️ Transcript truncated — only the last 100 messages were captured.').catch(() => {});
        }
      }
    }
  }

  setTimeout(async () => {
    store.tickets.delete(channel.id);
    await updateLiveBoard(channel.guild);

    if (archiveMinutes > 0 && closedCategoryId) {
      await channel.setParent(closedCategoryId, 'Archiving closed ticket').catch(() => {});
      setTimeout(() => channel.delete().catch(() => {}), archiveMinutes * 60_000);
    } else {
      await channel.delete('Ticket closed').catch(() => {});
    }
  }, deleteIn * 1000);
}

// ---------------------------------------------------------------- extras

async function addUser(interaction, target, level) {
  const ticket = store.tickets.get(interaction.channelId);
  if (!ticket) return deny(interaction, 'Not a ticket channel.');
  if (!ranks.hasRank(interaction.member, level)) return deny(interaction, `You need rank: ${config.rankLabel(level)}+`);

  await interaction.channel.permissionOverwrites.edit(target.id, {
    ViewChannel: true,
    SendMessages: true,
    AttachFiles: true,
    EmbedLinks: true,
    ReadMessageHistory: true,
  });
  store.tickets.update(interaction.channelId, {
    participants: [...new Set([...ticket.participants, target.id])],
  });

  await interaction.reply(`✅ Added <@${target.id}> to this ticket.`);
  await interaction.channel.send(`<@${target.id}> was added to this ticket.`);
}

async function removeUser(interaction, target) {
  const ticket = store.tickets.get(interaction.channelId);
  if (!ticket) return deny(interaction, 'Not a ticket channel.');
  if (target.id === ticket.userId) return deny(interaction, 'You cannot remove the ticket owner.');
  if (!ranks.hasRank(interaction.member, 1)) return deny(interaction, 'You need rank: Moderator+');

  await interaction.channel.permissionOverwrites.edit(target.id, { ViewChannel: false, SendMessages: false });
  store.tickets.update(interaction.channelId, {
    participants: ticket.participants.filter((id) => id !== target.id),
  });

  await interaction.reply(`✅ Removed <@${target.id}>.`);
}

async function renameTicket(interaction, name) {
  const ticket = store.tickets.get(interaction.channelId);
  if (!ticket) return deny(interaction, 'Not a ticket channel.');
  if (!ranks.hasRank(interaction.member, 0)) return deny(interaction, 'Only staff can rename tickets.');

  const clean = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 90);
  await interaction.channel.setName(`tkt-${String(ticket.number).padStart(4, '0')}-${clean}`);
  store.tickets.update(interaction.channelId, { subject: name });
  await interaction.reply({ content: '✅ Renamed.' });
  await refreshControls(interaction.channel, store.tickets.get(interaction.channelId));
}

async function setPriority(interaction, priority, level) {
  const ticket = store.tickets.get(interaction.channelId);
  if (!ticket) return deny(interaction, 'Not a ticket channel.');
  if (!ranks.hasRank(interaction.member, level)) return deny(interaction, `You need rank: ${config.rankLabel(level)}+`);

  store.tickets.update(interaction.channelId, { priority });
  const t = store.tickets.get(interaction.channelId);
  await interaction.reply({ content: `✅ Priority set to **${priority}**.`, components: [controlRow(t)] });
  await refreshControls(interaction.channel, t);
  await sendLog(interaction.guild, t, 'priority', interaction.user.id, { channelId: interaction.channelId, content: `Priority set to **${priority}**` });
}

async function addNote(interaction, body) {
  const ticket = store.tickets.get(interaction.channelId);
  if (!ticket) return deny(interaction, 'Not a ticket channel.');
  if (!ranks.isStaff(interaction.member)) return deny(interaction, 'Only staff can add internal notes.');

  store.notes.add(interaction.channelId, interaction.user.id, body);
  await interaction.reply({ content: '📝 Internal note added (not visible to the ticket owner).', ephemeral: true });
}

async function showNotes(interaction) {
  const ticket = store.tickets.get(interaction.channelId);
  if (!ticket) return deny(interaction, 'Not a ticket channel.');
  if (!ranks.isStaff(interaction.member)) return deny(interaction, 'Staff only.');

  const embed = new EmbedBuilder()
    .setColor(config.colors.main)
    .setTitle(`Internal notes — Ticket #${ticket.number}`)
    .setDescription(
      ticket.notes.length
        ? ticket.notes
            .map((n) => `**ID ${n.id}** • <@${n.authorId}> — <t:${Math.floor(n.at / 1000)}:R>\n${n.body}`)
            .join('\n\n').slice(0, 4000)
        : 'No notes yet.'
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function deleteNote(interaction, noteId) {
  const ticket = store.tickets.get(interaction.channelId);
  if (!ticket) return deny(interaction, 'Not a ticket channel.');
  if (!ranks.hasRank(interaction.member, 2)) return deny(interaction, 'You need rank: Admin+');

  const ok = store.notes.remove(interaction.channelId, noteId);
  await interaction.reply({ content: ok ? `🗑️ Note ${noteId} deleted.` : 'Note not found.', ephemeral: true });
}

async function transferTicket(interaction, target) {
  const ticket = store.tickets.get(interaction.channelId);
  if (!ticket) return deny(interaction, 'Not a ticket channel.');
  if (!ranks.hasRank(interaction.member, 1)) return deny(interaction, 'You need rank: Moderator+');

  if (ticket.userId === target.id) return deny(interaction, 'That user already owns this ticket.');

  // give the new owner owner-level perms, strip the old owner
  await interaction.channel.permissionOverwrites.edit(target.id, {
    ViewChannel: true,
    SendMessages: true,
    AttachFiles: true,
    EmbedLinks: true,
    ReadMessageHistory: true,
  });
  if (ticket.userId !== interaction.user.id) {
    await interaction.channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: false, SendMessages: false }).catch(() => {});
  }

  store.tickets.update(interaction.channelId, {
    userId: target.id,
    claimedBy: interaction.user.id,
    claimedAt: Date.now(),
    participants: [...new Set([target.id])],
    subject: `${ticket.subject} (transferred)`,
  });

  const t = store.tickets.get(interaction.channelId);
  await interaction.reply({ content: `✅ Ticket transferred to <@${target.id}>.` });
  await interaction.channel.send(`This ticket was transferred to <@${target.id}> by <@${interaction.user.id}>.`);
  await refreshControls(interaction.channel, t);
  await sendLog(interaction.guild, t, 'transferred', interaction.user.id, { channelId: interaction.channelId, content: `New owner: <@${target.id}>` });
}

async function listTickets(interaction, filter) {
  const all = store.tickets.all();
  let tickets = filter === 'mine' ? all.filter((t) => t.userId === interaction.user.id) : all;

  if (filter === 'open') tickets = all.filter((t) => t.status === 'open');

  const embed = new EmbedBuilder()
    .setColor(config.colors.main)
    .setTitle(`Ticket list (${tickets.length})`)
    .setDescription(
      tickets.length
        ? tickets
            .slice(-25)
            .map(
              (t) =>
                `**#${t.number}** <#${t.channelId}> — <@${t.userId}> • ` +
                `${t.priority} • ${t.status}${t.claimedBy ? ` • <@${t.claimedBy}>` : ''}`
            )
            .join('\n')
        : 'No tickets found.'
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function claimReminder(interaction) {
  if (!ranks.hasRank(interaction.member, 0)) return deny(interaction, 'Staff only.');
  const open = store.tickets.all().filter((t) => t.status === 'open');
  const unclaimed = open.filter((t) => !t.claimedBy);

  const embed = new EmbedBuilder()
    .setColor(unclaimed.length ? config.colors.warn : config.colors.success)
    .setTitle('Ticket queue')
    .setDescription(
      open.length
        ? open
            .slice(-20)
            .map((t) => `**#${t.number}** — ${t.subject} • ${t.claimedBy ? `with <@${t.claimedBy}>` : '**unclaimed**'} • ${t.priority}`)
            .join('\n')
        : 'No open tickets. 🎉'
    )
    .setFooter({ text: `${unclaimed.length} unclaimed of ${open.length} open` });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function stats(interaction) {
  if (!ranks.isStaff(interaction.member)) return deny(interaction, 'Staff only.');

  const all = store.tickets.all();
  const open = all.filter((t) => t.status === 'open');
  const staff = store.staff.all();
  const ranked = Object.entries(staff)
    .sort((a, b) => (b[1].closes || 0) - (a[1].closes || 0))
    .slice(0, 10);

  const embed = new EmbedBuilder()
    .setColor(config.colors.main)
    .setTitle('Ticket statistics')
    .addFields(
      { name: 'Total opened', value: String(all.length), inline: true },
      { name: 'Currently open', value: String(open.length), inline: true },
      { name: 'Unclaimed', value: String(open.filter((t) => !t.claimedBy).length), inline: true },
      { name: 'Avg. resolution', value: avgResolution(all), inline: true },
      {
        name: 'Top staff (closes)',
        value: ranked.length
          ? ranked.map(([id, s], i) => `${i + 1}. <@${id}> — ${s.closes || 0} closes, ${s.claims || 0} claims`).join('\n')
          : 'No data yet.',
        inline: false },
      {
        name: 'Ranks in use',
        value: config.RANK_ORDER.map((r, i) => `${config.rankLabel(i)}: ${config.ranks[r].length ? config.ranks[r].map((id) => `<@&${id}>`).join(' ') : 'not set'}`).join('\n'),
        inline: false,
      }
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

function avgResolution(tickets) {
  const closed = tickets.filter((t) => t.closedAt);
  if (!closed.length) return 'n/a';
  const total = closed.reduce((s, t) => s + (t.closedAt - t.createdAt), 0);
  return formatDuration(total / closed.length);
}

async function postPanel(interaction) {
  await interaction.channel.send({ embeds: [panelEmbed()], components: [panelButtons()] });
  store.panelChannel.set(interaction.channel.id);
  await interaction.reply({ content: '✅ Ticket panel posted here. Members can now open tickets.' });
}

// ---------------------------------------------------------------- survey

const STARS = ['⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'];

function surveyRow() {
  return new ActionRowBuilder().addComponents(
    ...STARS.map((label, i) =>
      new ButtonBuilder()
        .setCustomId(`survey:${i + 1}`)
        .setEmoji(i + 1 <= 2 ? '😞' : i + 1 === 3 ? '😐' : i <= 4 ? '🙂' : '😍')
        .setStyle(ButtonStyle.Secondary)
        .setLabel(String(i + 1))
    )
  );
}

async function sendSurvey(channel, ticket, durationMin) {
  const embed = new EmbedBuilder()
    .setColor(config.colors.main)
    .setTitle('How was our support?')
    .setDescription(
      `Your ticket was open for **${formatDuration(durationMin * 60_000)}**.\n` +
        'Rate your experience so we can improve. This is optional.'
    )
    .setFooter({ text: `Ticket #${ticket.number} · only the owner can rate` });

  await channel
    .send({ content: `<@${ticket.userId}>`, embeds: [embed], components: [surveyRow()] })
    .catch(() => {});
}

async function handleSurvey(interaction, rating) {
  const userId = interaction.user.id;
  const number = Number(rating);
  const ticketNumber = store.tickets.get(interaction.channelId)?.number;

  if (!store.surveys.has(userId)) {
    store.surveys.rate(userId, number, ticketNumber);
    await followUpDm(interaction.guild, userId, number, ticketNumber);
  }

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(number >= 4 ? config.colors.success : number === 3 ? config.colors.warn : config.colors.danger)
        .setTitle('Thanks for the feedback!')
        .setDescription(
          number <= 2
            ? `You rated **${STARS[number - 1]}** (${number}/5). Sorry about that — please check your DMs so we can fix it.`
            : `You rated **${STARS[number - 1]}** (${number}/5)`
        ),
    ],
    components: [],
  });
}

/** Aggregated survey results for staff. */
async function surveyStats(interaction) {
  if (!ranks.isStaff(interaction.member)) return deny(interaction, 'Staff only.');

  const avg = store.surveys.average();
  const embed = new EmbedBuilder()
    .setColor(config.colors.main)
    .setTitle('📊 Support satisfaction')
    .addFields(
      {
        name: 'Average rating',
        value: avg === null ? 'No ratings yet' : `${avg.toFixed(2)} / 5 ${STARS[Math.round(avg) - 1] || ''}`,
        inline: true,
      },
      { name: 'Total ratings', value: String(store.surveys.total()), inline: true }
    )
    .setTimestamp();

  const logId = cfg().logChannelId;
  if (logId) {
    const log = await interaction.guild.channels.fetch(logId).catch(() => null);
    if (log) {
      embed.addFields({
        name: 'Where to read them',
        value: `Ratings and comments are collected as DM follow-ups in <#${logId}>.`,
        inline: false,
      });
    }
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ---------------------------------------------------------------- live board

/** Repaint the "open tickets" dashboard so staff can jump into any ticket. */
async function updateLiveBoard(guild) {
  const liveId = cfg().liveChannelId;
  if (!liveId) return;

  const channel = await guild.channels.fetch(liveId).catch(() => null);
  if (!channel) return;

  const open = store.tickets.all().filter((t) => t.status === 'open').sort((a, b) => a.number - b.number);

  const embed = new EmbedBuilder()
    .setColor(open.length ? config.colors.main : config.colors.success)
    .setTitle('🎫 Open tickets')
    .setDescription(
      open.length
        ? open
            .slice(0, 25)
            .map(
              (t) =>
                `**#${t.number}** <#${t.channelId}> — <@${t.userId}>\n` +
                `\`${t.subject || t.category}\` • ${t.priority} • opened <t:${Math.floor(t.createdAt / 1000)}:R>` +
                `${t.staffReplies ? ` • ${t.staffReplies} staff repl${t.staffReplies === 1 ? 'y' : 'ies'}` : ''}`
            )
            .join('\n\n')
        : 'No open tickets. 🎉'
    )
    .setFooter({ text: `${open.length} open` })
    .setTimestamp();

  const messages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
  const existing = messages?.first();

  if (existing && existing.author?.id === channel.client?.user?.id) {
    await existing.edit({ embeds: [embed] }).catch(() => {});
  } else {
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
}

/** Create + enable the live dashboard channel. */
async function setupLiveBoard(interaction) {
  if (!ranks.hasRank(interaction.member, 2)) return deny(interaction, 'You need rank: Admin+');

  await interaction.deferReply({ ephemeral: true });
  const { guild } = interaction;

  let live = guild.channels.cache.find((c) => c.id === cfg().liveChannelId);
  if (!live) {
    live = await guild.channels.create({
      name: 'open-tickets',
      type: ChannelType.GuildText,
      topic: 'Live list of open tickets. Updated automatically.',
      reason: 'Ticket system setup',
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        ...config.RANK_ORDER.flatMap((rank) =>
          config.ranks[rank].map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
        ),
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks] },
      ],
    });
  }

  store.settings.set({ liveChannelId: live.id });
  await updateLiveBoard(guild);
  await interaction.editReply(`✅ Live ticket board enabled: ${live}`);
}

// ---------------------------------------------------------------- blacklist

async function blacklistUser(interaction, target, reason) {
  if (!ranks.hasRank(interaction.member, 2)) return deny(interaction, 'You need rank: Admin+');
  const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (targetMember && ranks.isStaff(targetMember)) return deny(interaction, 'You cannot blacklist a staff member.');

  store.blacklist.add(target.id, reason, interaction.user.id);
  await interaction.reply(`🚫 <@${target.id}> is now blacklisted from opening tickets. Reason: ${reason || 'none'}`);
  await target.send(`You have been blacklisted from opening support tickets. Reason: ${reason || 'none'}`).catch(() => {});
}

async function unblacklistUser(interaction, target) {
  if (!ranks.hasRank(interaction.member, 2)) return deny(interaction, 'You need rank: Admin+');
  if (!store.blacklist.is(target.id)) return deny(interaction, 'That user is not blacklisted.');

  store.blacklist.remove(target.id);
  store.strikes.clear(target.id);
  store.cooldowns.clear(target.id);
  await interaction.reply(`✅ <@${target.id}> can open tickets again.`);
}

async function resetAbuse(interaction, target) {
  if (!ranks.hasRank(interaction.member, 1)) return deny(interaction, 'You need rank: Moderator+');

  store.strikes.clear(target.id);
  store.cooldowns.clear(target.id);
  await interaction.reply(`✅ Cleared strikes and cooldown for <@${target.id}>.`);
}

async function abuseStatus(interaction, target) {
  if (!ranks.isStaff(interaction.member)) return deny(interaction, 'Staff only.');

  const user = target || interaction.user;
  const tag = user.tag || user.user?.tag || `<@${user.id}>`;
  const black = store.blacklist.is(user.id);
  const remaining = Math.ceil(store.cooldowns.remaining(user.id) / 60_000);
  const strikes = store.strikes.list(user.id);

  const embed = new EmbedBuilder()
    .setColor(black || strikes.length >= config.ticket.maxStrikes ? config.colors.danger : config.colors.main)
    .setTitle(`Abuse status — ${tag}`)
    .addFields(
      { name: 'Blacklisted', value: black ? `Yes — ${black.reason}` : 'No', inline: true },
      { name: 'Cooldown', value: remaining > 0 ? `${remaining} min left` : 'None', inline: true },
      { name: 'Strikes', value: `${strikes.length} / ${config.ticket.maxStrikes}`, inline: true },
      {
        name: 'Recent strikes',
        value: strikes.length
          ? strikes.map((s) => `• <t:${Math.floor(s.at / 1000)}:R> — ${s.reason}`).join('\n')
          : 'None',
        inline: false,
      }
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ---------------------------------------------------------------- alerts

/** Escalating alerts for tickets that get no staff reply. */
async function sweepUnanswered(client) {
  const minutes = config.ticket.unansweredMinutes;
  const escalate = config.ticket.unansweredEscalateMinutes;
  if (!minutes || !client.guilds.cache.size) return;

  for (const guild of client.guilds.cache.values()) {
    const { alertChannelId, liveChannelId } = cfg();
    if (!alertChannelId) continue;

    const alertChannel = await guild.channels.fetch(alertChannelId).catch(() => null);
    if (!alertChannel) continue;

    const staffRoles = ranks.staffRoleIds(guild).map((id) => `<@&${id}>`).join(' ');
    const liveLink = liveChannelId ? `<#${liveChannelId}>` : '';

    for (const t of store.tickets.all()) {
      if (t.status !== 'open' || (t.staffReplies ?? 0) > 0) continue;

      const ageMin = (Date.now() - t.createdAt) / 60_000;
      const level = store.alerts.level(t.channelId);

      if (level === 0 && ageMin >= minutes) {
        await alertChannel
          .send(
            `⏰ **Ticket #${t.number} has had no staff reply for ${Math.round(ageMin)} minutes.**\n` +
              `<#${t.channelId}> — <@${t.userId}> • \`${t.subject || t.category}\`\n${liveLink}`
          )
          .catch(() => {});
        store.alerts.set(t.channelId, 1);
      } else if (level === 1 && escalate && ageMin >= escalate) {
        await alertChannel
          .send(
            `🚨 **Escalation: ticket #${t.number} is still unanswered after ${Math.round(ageMin / 60)} hours.**\n` +
              `<#${t.channelId}> — <@${t.userId}> • \`${t.subject || t.category}\`\n${staffRoles}`
          )
          .catch(() => {});
        store.alerts.set(t.channelId, 2);
      }
    }
  }
}

/** Create the staff alert channel. */
async function setupAlerts(interaction) {
  if (!ranks.hasRank(interaction.member, 2)) return deny(interaction, 'You need rank: Admin+');

  await interaction.deferReply({ ephemeral: true });
  const { guild } = interaction;

  let channel = guild.channels.cache.find((c) => c.id === cfg().alertChannelId) ||
    guild.channels.cache.find((c) => c.name.toLowerCase() === 'staff-alerts');

  if (!channel) {
    channel = await guild.channels.create({
      name: 'staff-alerts',
      type: ChannelType.GuildText,
      topic: 'Unanswered ticket alerts and escalations.',
      reason: 'Ticket alert setup',
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        ...config.RANK_ORDER.flatMap((rank) =>
          config.ranks[rank].map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
        ),
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
      ],
    });
  }

  store.settings.set({ alertChannelId: channel.id });
  await interaction.editReply(
    `✅ Staff alerts enabled: ${channel}\n\n` +
      `Unanswered tickets are flagged after **${config.ticket.unansweredMinutes} min** and escalated after **${config.ticket.unansweredEscalateMinutes} min**. ` +
      `Tune with \`TICKET_UNANSWERED_MINUTES\` and \`TICKET_UNANSWERED_ESCALATE_MINUTES\`.`
  );
}

// ---------------------------------------------------------------- strike DM

/** DM the user when they collect a strike. Escalates in tone at the limit. */
async function sendStrikeDm(ticket, strikes, reason) {
  const remaining = Math.max(0, config.ticket.maxStrikes - strikes);
  const blocked = remaining === 0;

  const embed = new EmbedBuilder()
    .setColor(blocked ? config.colors.danger : config.colors.warn)
    .setTitle(blocked ? '⛔ Ticket creation blocked' : '⚠️ Ticket warning')
    .setDescription(
      blocked
        ? 'You opened and closed several tickets too quickly without receiving a reply. You cannot open new tickets for a while.\n\nIf you still need help, please wait — our staff are notified when a ticket is ignored.'
        : `You have **${strikes}** ticket warning(s). **${remaining}** more will temporarily block you from opening tickets.\n\nPlease describe your issue in detail and leave the ticket open so staff can reply.`
    )
    .addFields({ name: 'Reason', value: reason, inline: false })
    .setFooter({ text: 'This is an automated message.' })
    .setTimestamp();

  const target = await ticket.guild.members.fetch(ticket.userId).catch(() => null);
  if (!target) return;

  await target.send({ embeds: [embed] }).catch(() => {});
}

/** DM users who rated 1-2 stars asking why, so staff can act on it. */
async function followUpDm(guild, userId, rating, ticketNumber) {
  if (rating > 2) return;

  const user = await guild?.members?.fetch?.(userId).catch(() => null);
  const embed = new EmbedBuilder()
    .setColor(config.colors.warn)
    .setTitle('Can you tell us what went wrong?')
    .setDescription(
      `You rated your support **${rating}/5** on ticket #${ticketNumber}.\n\n` +
        'Sorry we did not get it right. Reply to this message with a short explanation — it goes straight to our staff team and helps us improve.'
    )
    .setFooter({ text: 'Optional — your reply is reviewed by staff only.' })
    .setTimestamp();

  if (user) await user.send({ embeds: [embed] }).catch(() => {});
}

/** Staff view of collected low-rating feedback. */
async function feedback(interaction) {
  if (!ranks.isStaff(interaction.member)) return deny(interaction, 'Staff only.');

  const data = store.data.surveys;
  const low = Object.entries(data.ratings)
    .filter(([, r]) => r.rating <= 2)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 20);

  const avg = store.surveys.average();

  const embed = new EmbedBuilder()
    .setColor(avg !== null && avg < 3 ? config.colors.danger : config.colors.main)
    .setTitle('💬 Support feedback')
    .addFields(
      {
        name: 'Average rating',
        value: avg === null ? 'No ratings yet' : `${avg.toFixed(2)} / 5 (${store.surveys.total()} ratings)`,
        inline: true,
      },
      { name: 'Low ratings (1-2★)', value: String(low.length), inline: true },
      {
        name: 'Recent low ratings',
        value: low.length
          ? low.map(([id, r]) => `• <@${id}> — **${r.rating}/5** on ticket #${r.ticketNumber} • <t:${Math.floor(r.at / 1000)}:R>`).join('\n')
          : 'None 🎉',
        inline: false,
      },
      ...(data.comments.length
        ? [{
            name: 'Written feedback',
            value: data.comments.slice(-10).map((c) => `• <@${c.userId}>: ${c.text}`).join('\n').slice(0, 1000),
            inline: false,
          }]
        : [])
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ---------------------------------------------------------------- reset

/** Wipe all bot data. Owner only, requires an explicit typed confirmation. */
async function resetData(interaction) {
  if (!ranks.hasRank(interaction.member, 3)) return deny(interaction, 'You need rank: Owner+');
  if (interaction.options.getString('confirm') !== 'DELETE EVERYTHING') {
    return deny(interaction, 'Type `DELETE EVERYTHING` as the confirm option to run this.');
  }

  await interaction.deferReply({ ephemeral: true });

  // close live ticket channels so no orphans remain
  const openTickets = store.tickets.all();
  let deleted = 0;
  for (const t of openTickets) {
    const channel = await interaction.guild.channels.fetch(t.channelId).catch(() => null);
    if (channel) { await channel.delete('Data reset').catch(() => {}); deleted++; }
  }

  const counts = {
    tickets: openTickets.length,
    warnings: Object.keys(store.data.warnings).length,
    blacklist: Object.keys(store.data.blacklist).length,
    strikes: Object.keys(store.data.strikes).length,
  };

  store.resetAll();

  await interaction.editReply(
    `🧨 **All bot data wiped.**\n\n` +
      `- ${counts.tickets} ticket records (${deleted} channels deleted)\n` +
      `- ${counts.warnings} warned members\n- ${counts.blacklist} blacklisted members\n- ${counts.strikes} users with strikes\n\n` +
      'Channel IDs, ranks and survey history were kept. Re-run `/ticket setup` if the log channels were removed.'
  );
}

module.exports = {
  SUBJECTS,
  setup,
  cfg,
  sendLog,
  sweepUnanswered,
  setupAlerts,
  sendStrikeDm,
  checkAbuse,
  updateLiveBoard,
  setupLiveBoard,
  blacklistUser,
  unblacklistUser,
  resetAbuse,
  abuseStatus,
  handleSurvey,
  surveyStats,
  panelEmbed,
  panelButtons,
  postPanel,
  openTicket,
  closeTicket,
  addUser,
  removeUser,
  renameTicket,
  setPriority,
  addNote,
  showNotes,
  deleteNote,
  transferTicket,
  listTickets,
  claimReminder,
  stats,
  refreshControls,
  ticketHeaderEmbed,
  controlRow,
};