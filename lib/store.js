const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data.json');

const DEFAULTS = {
  tickets: {},
  welcomes: {},
  welcomeChannelId: null,
  panelChannelId: null,
  settings: {
    ticketCategoryId: null,
    closedCategoryId: null,
    logChannelId: null,
    liveChannelId: null,
    alertChannelId: null,
    archiveMinutes: 0,
  },
  cooldowns: {},
  strikes: {},
  blacklist: {},
  warnings: {},
  surveys: { ratings: {}, comments: [] },
  modActions: [],
  nextTicketNumber: 1,
  counters: { opened: 0, closed: 0 },
  staff: {}, // userId -> { claims, closes, opened }
};

let data = structuredClone(DEFAULTS);

function load() {
  try {
    data = { ...structuredClone(DEFAULTS), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    data = structuredClone(DEFAULTS);
  }
  return data;
}

function save() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save data.json:', e.message);
  }
}

const bump = (key, n = 1) => {
  data.counters[key] = (data.counters[key] || 0) + n;
};

const staffStat = (userId, key) => {
  data.staff[userId] = data.staff[userId] || { claims: 0, closes: 0, opened: 0 };
  data.staff[userId][key] = (data.staff[userId][key] || 0) + 1;
};

module.exports = {
  load,
  save,
  data,

  /** Wipe operational data but keep channel IDs, ranks and survey history. */
  resetAll() {
    data.tickets = {};
    data.cooldowns = {};
    data.strikes = {};
    data.blacklist = {};
    data.warnings = {};
    data.modActions = [];
    data.nextTicketNumber = 1;
    save();
  },

  tickets: {
    /** Number that the next created ticket will get, without consuming it. */
    peekNumber: () => data.nextTicketNumber,

    create(channelId, fields) {
      const number = data.nextTicketNumber++;
      data.tickets[channelId] = {
        number,
        userId: fields.userId,
        subject: fields.subject,
        category: fields.category || 'general',
        priority: 'normal',
        status: 'open',
        staffReplies: 0,
        participants: [fields.userId],
        notes: [],
        messages: [],
        alertLevel: 0,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        closedAt: null,
        closedBy: null,
        closeReason: null,
        transcript: null,
      };
      bump('opened');
      staffStat(fields.userId, 'opened');
      save();
      return data.tickets[channelId];
    },

    get: (channelId) => data.tickets[channelId],

    update(channelId, patch) {
      const t = data.tickets[channelId];
      if (!t) return null;
      Object.assign(t, patch, { lastActivity: Date.now() });
      save();
      return t;
    },

    delete(channelId) {
      const t = data.tickets[channelId];
      delete data.tickets[channelId];
      save();
      return t;
    },

    byUser: (userId) =>
      Object.entries(data.tickets)
        .filter(([, t]) => t.userId === userId && t.status === 'open')
        .map(([channelId, t]) => ({ channelId, ...t })),

    /** Every ticket, each with its channelId attached. */
    all: () => Object.entries(data.tickets).map(([channelId, t]) => ({ channelId, ...t })),

    /** Append a message to a ticket's live log (full history, not just last 100). */
    logMessage(channelId, msg) {
      const t = data.tickets[channelId];
      if (!t) return null;
      t.messages.push({
        id: msg.id,
        authorId: msg.authorId,
        authorTag: msg.authorTag,
        content: (msg.content || '').slice(0, 1000),
        attachments: msg.attachments || 0,
        at: msg.at,
      });
      t.lastActivity = Date.now();
      save();
      return t.messages.length;
    },

    messages: (channelId) => data.tickets[channelId]?.messages || [],

    stale(minutes) {
      const cutoff = Date.now() - minutes * 60_000;
      return Object.entries(data.tickets).filter(
        ([, t]) => t.status === 'open' && t.lastActivity < cutoff
      );
    },
  },

  notes: {
    add(channelId, authorId, body) {
      const t = data.tickets[channelId];
      if (!t) return null;
      t.notes.push({ id: `${Date.now()}`, authorId, body, at: Date.now() });
      t.lastActivity = Date.now();
      save();
      return t.notes;
    },
    remove(channelId, noteId) {
      const t = data.tickets[channelId];
      if (!t) return false;
      const before = t.notes.length;
      t.notes = t.notes.filter((n) => n.id !== noteId);
      save();
      return t.notes.length !== before;
    },
  },

  welcomeChannel: {
    get: () => data.welcomeChannelId,
    set: (id) => { data.welcomeChannelId = id; save(); },
  },

  panelChannel: {
    get: () => data.panelChannelId,
    set: (id) => { data.panelChannelId = id; save(); },
  },

  welcomes: {
    add(userId) {
      data.welcomes[userId] = (data.welcomes[userId] || 0) + 1;
      save();
      return data.welcomes[userId];
    },
  },

  /** Runtime ticket config. Store values (set by /ticket setup) win over .env. */
  settings: {
    get: () => data.settings,
    set: (patch) => {
      Object.assign(data.settings, patch);
      save();
      return data.settings;
    },
  },

  counters: { get: () => data.counters, bump },
  staff: { stat: staffStat, all: () => data.staff },

  /** Cooldown: a user cannot open a new ticket until this timestamp. */
  cooldowns: {
    get: (userId) => data.cooldowns[userId] || 0,
    set: (userId, until) => { data.cooldowns[userId] = until; save(); },
    clear: (userId) => { delete data.cooldowns[userId]; save(); },
    remaining: (userId) => Math.max(0, (data.cooldowns[userId] || 0) - Date.now()),
  },

  /** Strikes for abuse: opened and closed too fast, or reopening repeatedly. */
  strikes: {
    list: (userId) => (data.strikes[userId] || []).filter((s) => Date.now() - s.at < s.windowMs),
    add: (userId, reason, windowMs) => {
      data.strikes[userId] = [...(data.strikes[userId] || []), { at: Date.now(), reason, windowMs }];
      save();
      return data.strikes[userId].length;
    },
    count: (userId) => (data.strikes[userId] || []).filter((s) => Date.now() - s.at < s.windowMs).length,
    clear: (userId) => { delete data.strikes[userId]; save(); },
  },

  /** Manual blacklist — blocks ticket creation entirely. */
  blacklist: {
    is: (userId) => data.blacklist[userId] || null,
    add: (userId, reason, by) => {
      data.blacklist[userId] = { reason: reason || 'No reason', by, at: Date.now() };
      save();
    },
    remove: (userId) => { delete data.blacklist[userId]; save(); },
    all: () => Object.entries(data.blacklist).map(([id, v]) => ({ userId: id, ...v })),
  },

  /** Moderation warnings. */
  warnings: {
    add: (userId, reason, by) => {
      data.warnings[userId] = data.warnings[userId] || [];
      data.warnings[userId].push({ id: `${Date.now()}`, reason, by, at: Date.now() });
      save();
      return data.warnings[userId].length;
    },
    list: (userId) => data.warnings[userId] || [],
    count: (userId) => (data.warnings[userId] || []).length,
    remove: (userId, warningId) => {
      const list = data.warnings[userId] || [];
      data.warnings[userId] = list.filter((w) => w.id !== warningId);
      save();
      return data.warnings[userId].length;
    },
    clear: (userId) => { delete data.warnings[userId]; save(); },
  },

  /** Post-close satisfaction ratings. */
  surveys: {
    rate(userId, rating, ticketNumber) {
      const t = data.surveys.ratings[userId];
      if (t) return null; // one rating per user
      data.surveys.ratings[userId] = { rating, ticketNumber, at: Date.now() };
      save();
      return rating;
    },
    has: (userId) => Boolean(data.surveys.ratings[userId]),
    comment(userId, text, ticketNumber) {
      data.surveys.comments.push({ userId, text, ticketNumber, at: Date.now() });
      save();
    },
    average() {
      const vals = Object.values(data.surveys.ratings).map((r) => r.rating);
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    },
    total: () => Object.keys(data.surveys.ratings).length,
  },

  modLog: {
    add(entry) {
      data.modActions.unshift({ ...entry, at: Date.now() });
      data.modActions = data.modActions.slice(0, 200);
      save();
    },
    recent: (n = 15) => data.modActions.slice(0, n),
  },

  /** Which unanswered-alert stage a ticket has already reached. */
  alerts: {
    level: (channelId) => data.tickets[channelId]?.alertLevel || 0,
    set: (channelId, level) => {
      if (!data.tickets[channelId]) return;
      data.tickets[channelId].alertLevel = level;
      save();
    },
  },

  /** Aggregate member record for /profile. */
  profile(userId) {
    const tickets = Object.values(data.tickets).filter((t) => t.userId === userId);
    const closed = tickets.filter((t) => t.status === 'closed');
    const durations = closed.filter((t) => t.closedAt).map((t) => t.closedAt - t.createdAt);

    return {
      ticketsOpened: tickets.length,
      ticketsClosed: closed.length,
      ticketsOpen: tickets.length - closed.length,
      warnings: (data.warnings[userId] || []).length,
      strikes: (data.strikes[userId] || []).filter((s) => Date.now() - s.at < s.windowMs).length,
      blacklisted: data.blacklist[userId] || null,
      cooldownMs: Math.max(0, (data.cooldowns[userId] || 0) - Date.now()),
      rating: data.surveys.ratings[userId] || null,
      avgResolutionMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
      modActions: data.modActions.filter((a) => a.target === userId).length,
    };
  },
};