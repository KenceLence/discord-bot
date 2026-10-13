const {
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const config = require('../config');
const store = require('../lib/store');

// ---------------------------------------------------------------- modlog

/** Send a moderation action to the modlog channel. */
async function modlog(guild, { action, target, moderator, reason, extra = '' }) {
  store.modLog.add({ action, target: target?.id, targetTag: target?.tag, moderator: moderator?.id, reason });

  const channelId = config.mod.modlogChannelId;
  if (!channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(config.colors.warn)
    .setTitle(`🛡️ ${action}`)
    .addFields(
      { name: 'Target', value: target ? `${target.tag} (\`${target.id}\`)` : 'N/A', inline: true },
      { name: 'Moderator', value: moderator ? moderator.tag : 'Auto-system', inline: true },
      { name: 'Reason', value: reason || 'No reason given', inline: false }
    )
    .setTimestamp();

  await channel.send({ content: extra || undefined, embeds: [embed] }).catch(() => {});
}

/** Create the modlog channel on demand (Admin+). */
async function setupModlog(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ content: '❌ You need `MANAGE_CHANNELS`.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const { guild } = interaction;

  let channel = guild.channels.cache.find((c) => c.id === config.mod.modlogChannelId) ||
    guild.channels.cache.find((c) => c.name.toLowerCase() === 'modlog');

  if (!channel) {
    channel = await guild.channels.create({
      name: 'modlog',
      type: ChannelType.GuildText,
      topic: 'Automated moderation log.',
      reason: 'Modlog setup',
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
      ],
    });
  }

  await channel.send('🛡️ Moderation logging enabled.').catch(() => {});
  await interaction.editReply(
    `✅ Modlog ready: ${channel}\n\nAdd this to your Railway variables:\n\`MODLOG_CHANNEL_ID=${channel.id}\``
  );
}

const dmLine = (action, user, mod, reason, duration) =>
  new EmbedBuilder()
    .setColor(action === 'ban' ? config.colors.danger : config.colors.warn)
    .setTitle(`You were ${action === 'timeout' ? 'timed out' : `${action}ed`} in ${mod.guild.name}`)
    .addFields(
      { name: 'Moderator', value: mod.user.tag, inline: true },
      ...(duration ? [{ name: 'Duration', value: duration, inline: true }] : []),
      { name: 'Reason', value: reason || 'No reason given', inline: false }
    )
    .setTimestamp();

async function kick(interaction) {
  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') || 'No reason given';

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
    return interaction.reply({ content: 'I need the `KICK_MEMBERS` permission.', ephemeral: true });
  }
  if (user.bot) return interaction.reply({ content: 'I cannot kick bots.', ephemeral: true });

  await user.kick(reason);
  user.send({ embeds: [dmLine('kick', user, interaction.member, reason)] }).catch(() => {});
  interaction.reply(`Kicked **${user.tag}**.`);
  await modlog(interaction.guild, { action: 'Kick', target: user, moderator: interaction.user, reason });
}

async function ban(interaction) {
  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') || 'No reason given';

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
    return interaction.reply({ content: 'I need the `BAN_MEMBERS` permission.', ephemeral: true });
  }
  if (user.bot) return interaction.reply({ content: 'I cannot ban bots.', ephemeral: true });

  await user.ban({ reason });
  user.send({ embeds: [dmLine('ban', user, interaction.member, reason)] }).catch(() => {});
  interaction.reply(`Banned **${user.tag}**.`);
  await modlog(interaction.guild, { action: 'Ban', target: user, moderator: interaction.user, reason });
}

async function unban(interaction) {
  const id = interaction.options.getString('id', true);
  const user = await interaction.client.users.fetch(id).catch(() => null);

  if (!user) return interaction.reply({ content: 'That user does not exist.', ephemeral: true });
  await interaction.guild.members.unban(user.id, 'Unbanned by staff');
  interaction.reply(`Unbanned **${user.tag}**.`);
  await modlog(interaction.guild, { action: 'Unban', target: user, moderator: interaction.user });
}

async function purge(interaction) {
  const amount = interaction.options.getInteger('amount', true);

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({ content: 'I need the `MANAGE_MESSAGES` permission.', ephemeral: true });
  }

  await interaction.channel.bulkDelete(amount, true);
  interaction.reply({ content: `Deleted ${amount} messages.`, ephemeral: true });
  await modlog(interaction.guild, {
    action: 'Purge',
    target: interaction.user,
    moderator: interaction.user,
    reason: `${amount} messages in #${interaction.channel.name}`,
  });
}

async function lock(interaction, mode) {
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ content: 'I need the `MANAGE_CHANNELS` permission.', ephemeral: true });
  }

  const lock = mode === 'lock';
  await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, {
    SendMessages: !lock,
    SendMessagesInThreads: !lock,
  });

  interaction.reply(lock ? 'Channel locked.' : 'Channel unlocked.');
  await modlog(interaction.guild, {
    action: lock ? 'Channel lock' : 'Channel unlock',
    target: interaction.user,
    moderator: interaction.user,
    reason: `#${interaction.channel.name}`,
  });
}

async function sendWelcome(member) {
  const channelId = store.welcomeChannel.get() || config.welcome.channelId;
  if (!channelId) return;

  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const count = store.welcomes.add(member.id);
  const embed = new EmbedBuilder()
    .setColor(config.colors.success)
    .setTitle(`Welcome, ${member.user.username}!`)
    .setThumbnail(member.user.displayAvatarURL())
    .setDescription(`Welcome to **${member.guild.name}**! You are member **#${count}**.`)
    .addFields(
      { name: 'Get support', value: 'Use `/ticket new`', inline: true },
      { name: 'Read the rules', value: 'Please check the rules channel.', inline: true }
    )
    .setTimestamp();

  await channel.send({ content: `<@${member.id}>`, embeds: [embed] });
}

// ---------------------------------------------------------------- timeout

const DURATIONS = {
  '10m': 10 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 3600_000,
  '12h': 12 * 3600_000,
  '1d': 24 * 3600_000,
  '3d': 3 * 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
};

async function timeout(interaction) {
  const user = interaction.options.getUser('user', true);
  const key = interaction.options.getString('duration', true);
  const reason = interaction.options.getString('reason') || 'No reason given';
  const ms = DURATIONS[key];

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.reply({ content: '❌ That user is not in this server.', ephemeral: true });
  if (member.id === interaction.user.id) return interaction.reply({ content: '❌ You cannot timeout yourself.', ephemeral: true });
  if (member.roles.highest.position >= interaction.member.roles.highest.position) {
    return interaction.reply({ content: '❌ That member has an equal or higher role than you.', ephemeral: true });
  }
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({ content: '❌ I need the `MODERATE_MEMBERS` permission.', ephemeral: true });
  }

  await member.timeout(ms, `${interaction.user.tag}: ${reason}`);
  user.send({ embeds: [dmLine('timeout', user, interaction.member, reason, key)] }).catch(() => {});

  await interaction.reply(`🔇 <@${user.id}> timed out for **${key}**.`);
  await modlog(interaction.guild, { action: 'Timeout', target: user, moderator: interaction.user, reason, extra: `Duration: ${key}` });
}

async function untimeout(interaction) {
  const user = interaction.options.getUser('user', true);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.reply({ content: '❌ That user is not in this server.', ephemeral: true });

  await member.timeout(null, `Timeout removed by ${interaction.user.tag}`);
  await interaction.reply(`✅ <@${user.id}> can talk again.`);
  await modlog(interaction.guild, { action: 'Timeout removed', target: user, moderator: interaction.user });
}

// ---------------------------------------------------------------- warnings

async function warn(interaction) {
  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason', true);

  const count = store.warnings.add(user.id, reason, interaction.user.id);
  user.send({ embeds: [dmLine('warn', user, interaction.member, reason)] }).catch(() => {});

  await interaction.reply(`⚠️ <@${user.id}> warned (${count} total). Reason: ${reason}`);
  await modlog(interaction.guild, {
    action: 'Warn',
    target: user,
    moderator: interaction.user,
    reason,
    extra: `Total warnings: ${count}`,
  });
}

async function warnings(interaction) {
  const user = interaction.options.getUser('user', true);
  const list = store.warnings.list(user.id);

  const embed = new EmbedBuilder()
    .setColor(list.length ? config.colors.warn : config.colors.success)
    .setTitle(`Warnings — ${user.tag}`)
    .setDescription(
      list.length
        ? list
            .map((w) => `**${w.id}** • <t:${Math.floor(w.at / 1000)}:R> by <@${w.by}>\n${w.reason}`)
            .join('\n\n').slice(0, 4000)
        : 'No warnings. 🎉'
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function removeWarning(interaction) {
  const user = interaction.options.getUser('user', true);
  const id = interaction.options.getString('id', true);
  const before = store.warnings.count(user.id);
  const after = store.warnings.remove(user.id, id);

  await interaction.reply(
    before === after
      ? '❌ Warning not found.'
      : `✅ Warning removed. <@${user.id}> now has ${after}.`
  );
  if (before !== after) {
    await modlog(interaction.guild, { action: 'Warning removed', target: user, moderator: interaction.user, reason: `ID ${id}` });
  }
}

// ---------------------------------------------------------------- spam guard

/** Times out members who send too many messages in a short window. */
function registerSpamGuard(client, { isStaff }) {
  const hits = new Map();

  client.on('messageCreate', async (message) => {
    if (message.author.bot || message.webhookId) return;
    if (message.member?.id === client.user.id) return;
    if (isStaff(message.member)) return;

    const limit = config.mod.spamMessageLimit;
    const windowMs = config.mod.spamWindowSeconds * 1000;
    const now = Date.now();

    const times = (hits.get(message.channelId) || []).filter((t) => now - t < windowMs);
    times.push(now);
    hits.set(message.channelId, times);

    if (times.length < limit) return;

    hits.delete(message.channelId);

    const member = message.guild.members.cache.get(message.author.id);
    if (!member?.timeout) return;
    if (member.roles.highest.position >= (message.guild.members.me.roles.highest?.position ?? 0)) return;

    try {
      await member.timeout(config.mod.spamTimeoutMinutes * 60_000, 'Anti-spam: message flood');
      await modlog(message.guild, {
        action: 'Auto-timeout (spam)',
        target: message.author,
        moderator: null,
        reason: `Sent ${limit}+ messages in ${config.mod.spamWindowSeconds}s`,
      });
    } catch (e) {
      console.error('Spam guard failed:', e.message);
    }
  });
}

// ---------------------------------------------------------------- channel tools

async function slowmode(interaction) {
  const seconds = interaction.options.getInteger('seconds', true);

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ content: '❌ I need `MANAGE_CHANNELS`.', ephemeral: true });
  }

  await interaction.channel.setRateLimitPerUser(seconds, `Slowmode by ${interaction.user.tag}`);
  await interaction.reply(seconds === 0 ? '✅ Slowmode disabled.' : `✅ Slowmode set to **${seconds}s**.`);
  await modlog(interaction.guild, {
    action: 'Slowmode',
    target: interaction.user,
    moderator: interaction.user,
    reason: `${seconds}s in #${interaction.channel.name}`,
  });
}

/** Lock every text channel at once — emergency brake. */
async function lockdown(interaction, on) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ content: '❌ You need `MANAGE_CHANNELS`.', ephemeral: true });
  }
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ content: '❌ I need `MANAGE_CHANNELS`.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const channels = interaction.guild.channels.cache.filter(
    (c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement
  );

  let done = 0;
  for (const channel of channels.values()) {
    await channel
      .permissionOverwrites.edit(interaction.guild.roles.everyone.id, {
        SendMessages: !on,
        SendMessagesInThreads: !on,
        AddReactions: !on,
      })
      .then(() => done++)
      .catch(() => {});
  }

  await interaction.editReply(`🔒 ${on ? 'Locked' : 'Unlocked'} **${done}** channel(s).`);
  await modlog(interaction.guild, {
    action: on ? 'Server lockdown' : 'Server unlocked',
    target: interaction.user,
    moderator: interaction.user,
    reason: `${done} channels affected`,
  });
}

async function modHistory(interaction) {
  const entries = store.modLog.recent(15);

  const embed = new EmbedBuilder()
    .setColor(config.colors.neutral)
    .setTitle('Recent moderation actions')
    .setDescription(
      entries.length
        ? entries
            .map(
              (e) => `**${e.action}** — ${e.targetTag || 'N/A'}\nby ${e.moderator ? `<@${e.moderator}>` : 'Auto-system'} • <t:${Math.floor(e.at / 1000)}:R>\n${e.reason || ''}`
            )
            .join('\n\n').slice(0, 4000)
        : 'No moderation actions recorded yet.'
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/** /profile — a member's record in one embed. */
async function profile(interaction) {
  const target = interaction.options.getUser('user') || interaction.user;
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  const p = store.profile(target.id);

  const duration = (ms) => {
    if (!ms) return 'n/a';
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
  };

  const status =
    p.blacklisted ? `🔴 Blacklisted — ${p.blacklisted.reason}`
    : p.strikes >= config.ticket.maxStrikes ? '🔴 Blocked (too many warnings)'
    : p.strikes > 0 ? `🟠 ${p.strikes} warning(s)`
    : p.warnings > 0 ? `🟡 ${p.warnings} mod warning(s)`
    : p.ticketsOpen > 0 ? '🔵 Has an open ticket'
    : '🟢 Clean';

  const embed = new EmbedBuilder()
    .setColor(p.blacklisted ? config.colors.danger : p.strikes ? config.colors.warn : config.colors.main)
    .setTitle(target.tag)
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Status', value: status, inline: false },
      { name: 'Tickets', value: `${p.ticketsOpened} opened • ${p.ticketsClosed} closed • ${p.ticketsOpen} open`, inline: true },
      { name: 'Avg. resolution', value: duration(p.avgResolutionMs), inline: true },
      { name: 'Ticket warnings', value: `${p.strikes} / ${config.ticket.maxStrikes}`, inline: true },
      { name: 'Mod warnings', value: String(p.warnings), inline: true },
      { name: 'Mod actions', value: String(p.modActions), inline: true },
      { name: 'Support rating', value: p.rating ? `${p.rating}/5` : 'Not rated', inline: true },
      {
        name: 'Account',
        value: [
          `Joined: ${member?.joinedAt ? `<t:${Math.floor(member.joinedAt / 1000)}:D>` : 'unknown'}`,
          `Created: <t:${Math.floor((target.createdTimestamp ?? Date.now()) / 1000)}:D>`,
          p.cooldownMs > 0 ? `Cooldown: ${duration(p.cooldownMs)} left` : null,
        ].filter(Boolean).join('\n'),
        inline: false,
      }
    )
    .setFooter({ text: `ID: ${target.id}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

/** /warnings command lives above; this lists warnings for the profile owner too. */
async function profileWarningsList(interaction) {
  const target = interaction.options.getUser('user') || interaction.user;
  const list = store.warnings.list(target.id);

  await interaction.reply({
    content: list.length
      ? `${target.tag} has ${list.length} warning(s). Use \`/warnings user:${target.username}\` for details.`
      : `${target.tag} has no warnings.`,
    ephemeral: true,
  });
}

module.exports = {
  kick, ban, unban, purge, lock, sendWelcome,
  profile, profileWarningsList,
  timeout, untimeout,
  warn, warnings, removeWarning,
  slowmode, lockdown,
  registerSpamGuard, modlog, setupModlog, modHistory,
};