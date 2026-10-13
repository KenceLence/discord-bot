const http = require('http');
const { URL } = require('url');
const config = require('../config');
const store = require('./store');
const { ask } = require('./ai');

const API_KEY = process.env.API_KEY || '';

/** Only allow requests carrying a valid bearer token (if API_KEY is set). */
function authorized(req) {
  if (!API_KEY) return false; // fail closed: refuse to serve without a key
  const header = req.headers.authorization || '';
  return header === `Bearer ${API_KEY}`;
}

function send(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 100_000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

/** Strip a ticket down to what a website needs. */
function publicTicket(t) {
  return {
    number: t.number,
    status: t.status,
    subject: t.subject,
    category: t.category,
    priority: t.priority,
    userId: t.userId,
    staffReplies: t.staffReplies ?? 0,
    messageCount: t.messages?.length ?? 0,
    createdAt: t.createdAt,
    closedAt: t.closedAt,
    closeReason: t.closeReason,
    lastActivity: t.lastActivity,
  };
}

function start(client) {
  if (!API_KEY) {
    console.warn('[api] API_KEY is not set — the HTTP API will refuse all requests.');
    return;
  }

  const port = Number(process.env.PORT || 3000);

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (!authorized(req)) return send(res, 401, { error: 'Unauthorized' });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

    try {
      // GET /api/health
      if (parts[1] === 'health') {
        const guild = [...(client.guilds.cache.values() || [])][0];
        return send(res, 200, {
          ok: true,
          bot: client.user?.tag,
          guild: guild?.name,
          uptime: Math.round(process.uptime()),
        });
      }

      // GET /api/tickets?status=open
      if (parts[1] === 'tickets' && parts.length === 2) {
        const status = url.searchParams.get('status');
        let tickets = store.tickets.all();
        if (status) tickets = tickets.filter((t) => t.status === status);
        return send(res, 200, { count: tickets.length, tickets: tickets.map(publicTicket) });
      }

      // GET /api/tickets/:number
      if (parts[1] === 'tickets' && parts.length === 3) {
        const ticket = store.tickets.all().find((t) => String(t.number) === parts[2]);
        if (!ticket) return send(res, 404, { error: 'Ticket not found' });
        return send(res, 200, { ...publicTicket(ticket), messages: ticket.messages });
      }

      // GET /api/stats
      if (parts[1] === 'stats') {
        const all = store.tickets.all();
        const open = all.filter((t) => t.status === 'open');
        return send(res, 200, {
          ticketsOpened: all.length,
          ticketsOpen: open.length,
          unresponded: open.filter((t) => (t.staffReplies ?? 0) === 0).length,
          avgRating: store.surveys.average(),
          ratings: store.surveys.total(),
          warnings: Object.keys(store.data.warnings).length,
          blacklisted: Object.keys(store.data.blacklist).length,
        });
      }

      // POST /api/ask  { "question": "..." }
      if (parts[1] === 'ask' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.question) return send(res, 400, { error: 'Missing "question"' });
        const answer = await ask(String(body.question).slice(0, 2000));
        return send(res, 200, { answer });
      }

      return send(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      console.error('[api]', err.message);
      return send(res, 500, { error: err.message });
    }
  });

  server.listen(port, () => {
    console.log(`[api] HTTP API listening on port ${port}`);
  });

  return server;
}

module.exports = { start };