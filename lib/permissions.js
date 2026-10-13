const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');

const ALL_RANKS = [...config.ranks.owner, ...config.ranks.admin, ...config.ranks.moderator, ...config.ranks.support];

/** Base perms any staff rank gets inside a ticket channel. */
const STAFF_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
];

function isStaff(member) {
  return config.rankLevel(member) >= 0;
}

/** member needs at least `level` (0=support .. 3=owner). */
function hasRank(member, level) {
  return config.rankLevel(member) >= level;
}

/** Discord perms to grant for a given rank level (cumulative). */
function permsForLevel(level) {
  const perms = [...STAFF_PERMS];
  if (level >= 1) perms.push(PermissionFlagsBits.KickMembers);
  if (level >= 2) perms.push(PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageMessages);
  if (level >= 3) perms.push(PermissionFlagsBits.BanMembers, PermissionFlagsBits.Administrator);
  return perms;
}

/** Overwrite entries for every configured rank role + the ticket owner. */
function buildOverwrites(guild, ownerId, level = 0) {
  const everyone = guild.roles.everyone.id;
  const overwrites = [
    { id: everyone, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: ownerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  for (const [rankName, level_] of [['support', 0], ['moderator', 1], ['admin', 2], ['owner', 3]]) {
    if (level_ < level) continue;
    for (const roleId of config.ranks[rankName]) {
      overwrites.push({ id: roleId, allow: permsForLevel(level_) });
    }
  }

  return overwrites;
}

/** All staff rank role IDs that exist in this guild. */
function staffRoleIds(guild) {
  return ALL_RANKS.filter((id) => guild.roles.cache.has(id));
}

module.exports = { isStaff, hasRank, permsForLevel, buildOverwrites, staffRoleIds, STAFF_PERMS };