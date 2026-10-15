require('dotenv').config();

const split = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,

  ticket: {
    categoryId: process.env.TICKET_CATEGORY_ID,
    closedCategoryId: process.env.TICKET_CLOSED_CATEGORY_ID,
    logChannelId: process.env.TICKET_LOG_CHANNEL_ID,

    maxOpenPerUser: Number(process.env.TICKET_MAX_OPEN_PER_USER || 3),
    autoCloseHours: Number(process.env.TICKET_AUTO_CLOSE_HOURS || 48),
    // 0 = delete the channel immediately on close, >0 = archive it for N minutes
    archiveMinutes: Number(process.env.TICKET_ARCHIVE_MINUTES || 0),

    // Cooldown + strike abuse prevention
    cooldownMinutes: Number(process.env.TICKET_COOLDOWN_MINUTES || 10),
    maxStrikes: Number(process.env.TICKET_MAX_STRIKES || 3),
    strikeWindowMinutes: Number(process.env.TICKET_STRIKE_WINDOW_MINUTES || 60),
    // Ticket closed faster than this with no staff reply = strike
    strikeUnderMinutes: Number(process.env.TICKET_STRIKE_UNDER_MINUTES || 2),

    // Live "open tickets" dashboard channel
    liveChannelId: process.env.TICKET_LIVE_CHANNEL_ID,

    // Escalating alerts for tickets with no staff reply
    unansweredMinutes: Number(process.env.TICKET_UNANSWERED_MINUTES || 60),
    unansweredEscalateMinutes: Number(process.env.TICKET_UNANSWERED_ESCALATE_MINUTES || 240),
  },

  mod: {
    modlogChannelId: process.env.MODLOG_CHANNEL_ID,
    // Auto-timeout when a member sends >= N messages in the window
    spamMessageLimit: Number(process.env.SPAM_MESSAGE_LIMIT || 6),
    spamWindowSeconds: Number(process.env.SPAM_WINDOW_SECONDS || 8),
    spamTimeoutMinutes: Number(process.env.SPAM_TIMEOUT_MINUTES || 10),
  },

  welcome: {
    channelId: process.env.WELCOME_CHANNEL_ID,
    roleId: process.env.WELCOME_ROLE_ID,
  },

  ai: {
    url: process.env.AI_API_URL,
    key: process.env.AI_API_KEY,
    model: process.env.AI_MODEL || 'gpt-4o-mini',
  },

  /**
   * Staff ranks, lowest -> highest. Each rank inherits the rank below it.
   * Needed rank level for an action = index in this list.
   */
  ranks: {
    owner: split(process.env.RANK_OWNER_ROLE_ID),
    admin: split(process.env.RANK_ADMIN_ROLE_ID),
    moderator: split(process.env.RANK_MODERATOR_ROLE_ID),
    support: split(process.env.TICKET_SUPPORT_ROLE_ID),
  },

  colors: {
    main: 0x5865f2,
    success: 0x57f287,
    warn: 0xfee75c,
    danger: 0xed4245,
    neutral: 0x2b2d31,
  },
};

// Flat ordered list, lowest first: support(0) -> moderator(1) -> admin(2) -> owner(3)
const ORDER = ['support', 'moderator', 'admin', 'owner'];

/** Highest rank level a member holds. -1 = not staff (or not a GuildMember). */
module.exports.rankLevel = function rankLevel(member) {
  const cache = member?.roles?.cache;
  if (!cache) return -1;

  let level = -1;
  ORDER.forEach((rank, i) => {
    if (module.exports.ranks[rank].some((id) => cache.has(id))) level = i;
  });
  return level;
};

module.exports.RANK_ORDER = ORDER;
module.exports.rankLabel = (i) => ['Support', 'Moderator', 'Admin', 'Owner'][i] ?? 'None';