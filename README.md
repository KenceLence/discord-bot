# Discord Bot

Ticket system, moderation, welcomes, and an `/ask` AI command. Runs on Railway or locally.

## Setup

1. **Get credentials** at https://discord.com/developers/applications
   - `DISCORD_TOKEN` — Bot tab → Reset Token
   - `CLIENT_ID` — General Information → Application ID
   - `GUILD_ID` — right-click your server (Developer Mode on) → Copy Server ID

2. **Create the staff roles** — `Support`, `Moderator`, `Admin`, `Owner`. Put each ID in `.env`.

3. **Install & run**
   ```powershell
   npm install
   copy .env.example .env
   npm run deploy-commands
   npm start
   ```

Commands register instantly when `GUILD_ID` is set (test server only — what you want while building). Global commands (remove `GUILD_ID`) can take up to an hour.

4. **One-time setup commands** (each auto-creates its channels and prints IDs you need):
   - `/ticket setup` (Admin+) — creates `Tickets`, `Closed Tickets` and the `ticket-logs` channel
   - `/ticket live` (Admin+) — creates the `open-tickets` dashboard
   - `/ticket alerts` (Admin+) — creates the `staff-alerts` channel for unanswered-ticket warnings
   - `/modsetup` — creates the `modlog` channel; paste the printed `MODLOG_CHANNEL_ID` into `.env`

5. `/ticket panel` in a public channel to let members open tickets.

## Staff ranks

Cumulative — a higher rank gets every permission of the ranks below it.

| Level | Rank | Can do |
|---|---|---|
| 0 | Support | Manage tickets, rename, add users, internal notes |
| 1 | Moderator | + remove users, set priority, transfer tickets, reset abuse |
| 2 | Admin | + blacklist, delete notes |
| 3 | Owner | + everything |

Each rank accepts a comma-separated list of role IDs.

## Tickets

**Flow:** open a ticket → staff see it in the dashboard and reply. There is no claiming step — any staff member can jump in.

**Live dashboard** — `open-tickets` shows every open ticket with a clickable link, subject, priority, age and how many staff have replied. It repaints on every open, close and staff reply.

**Logging** — everything goes to `ticket-logs` as coloured embeds: 📂 opened (green, pings staff), 🔒 closed (red), 📝 transferred/priority (yellow). Each records channel, owner, subject, category, priority, staff reply count and who acted. Closing also posts a summary embed plus the full transcript.

**Surveys** — on close, the owner gets a 1–5 rating prompt. `/ticket surveys` shows the average, `/ticket feedback` lists low ratings. Ratings of 1–2 stars also trigger a DM asking the user what went wrong.

**Auto-delete** — the channel is deleted 5 seconds after closing (transcript captured first). Set `TICKET_ARCHIVE_MINUTES=60` to park it in `Closed Tickets` instead.

### Abuse prevention

- **Cooldown** (default 10 min) — a user can't open another ticket right after closing one
- **Strikes** — closing a ticket in under 2 minutes with zero staff replies earns a strike; 3 strikes in an hour blocks ticket creation until the window expires
- **Strike DM** — the user is DM'd when they collect a strike, told how many are left, and gets a firmer "creation blocked" message at the limit
- **Blacklist** — `/ticket blacklist` blocks a user outright (Admin+)

All three are visible via `/ticket abusestatus`, and `/ticket resetabuse` clears strikes and cooldown.

### Unanswered-ticket alerts

If a ticket gets no staff reply, the bot flags it in `staff-alerts`:

- after **60 minutes** — ⏰ reminder with a link to the ticket and the dashboard
- after **4 hours** — 🚨 escalation that pings all staff roles

Each stage fires once per ticket, and a ticket that gets a reply resets its alert level. Tune with `TICKET_UNANSWERED_MINUTES` and `TICKET_UNANSWERED_ESCALATE_MINUTES`. The sweep runs every 5 minutes.

### Member profile

`/profile [user]` shows a member's full record in one embed: status (clean / warned / blocked / blacklisted), tickets opened and closed, average resolution time, ticket warnings vs mod warnings, mod actions, their support rating, join and account creation dates. `/mywarnings` is the member-facing shortcut.

## Ticket commands

| Command | Rank | Description |
|---|---|---|
| `/ticket new [category] [subject]` | everyone | Open a ticket |
| `/ticket setup` | Admin+ | Create categories + logs channel |
| `/ticket live` | Admin+ | Create the open-tickets dashboard |
| `/ticket alerts` | Admin+ | Create the unanswered-ticket alert channel |
| `/ticket panel` | Support+ | Post the button panel |
| `/ticket close [reason]` | owner / staff | Close, log, survey, delete channel |
| `/ticket blacklist user [reason]` | Admin+ | Block from opening tickets |
| `/ticket unblacklist user` | Admin+ | Unblock |
| `/ticket resetabuse user` | Moderator+ | Clear strikes + cooldown |
| `/ticket abusestatus [user]` | Support+ | Blacklist/strike/cooldown view |
| `/ticket surveys` | Support+ | Satisfaction stats |
| `/ticket feedback` | Support+ | Low ratings + written feedback |
| `/ticket add user` | Support+ | Add someone to the ticket |
| `/ticket remove user` | Moderator+ | Remove someone |
| `/ticket transfer user` | Moderator+ | Hand the ticket to another user |
| `/ticket rename name` | Support+ | Rename the channel |
| `/ticket priority level` | Moderator+ | low / normal / high / urgent |
| `/ticket note body` | Support+ | Internal note, invisible to owner |
| `/ticket notes` | Support+ | View internal notes |
| `/ticket deletenote id` | Admin+ | Delete a note |
| `/ticket list filter` | everyone | open / mine / all |
| `/ticket remind` | Support+ | Unclaimed queue |
| `/ticket stats` | Support+ | Stats + staff leaderboard |

## Moderation

| Command | Description |
|---|---|
| `/profile [user]` | Member record: tickets, warnings, status |
| `/mywarnings` | Check your own warnings |
| `/reset confirm:DELETE EVERYTHING` | Owner only — wipe all bot data |
| `/timeout user duration [reason]` | Mute for 10m–7d |
| `/untimeout user` | Remove a timeout |
| `/warn user reason` | Issue a warning (DM'd) |
| `/warnings user` | View warnings |
| `/removewarning user id` | Delete a warning (Admin+) |
| `/slowmode seconds` | Per-channel slowmode |
| `/lockdown on\|off` | Lock or unlock **every** channel — emergency brake |
| `/lock lock\|unlock` | Single channel |
| `/purge amount` | Bulk delete messages |
| `/kick` `/ban` `/unban` | Standard actions |
| `/modsetup` | Create the modlog channel |
| `/modhistory` | Last 15 moderation actions |

**Anti-spam** — a member sending 6+ messages within 8 seconds is auto-timed-out for 10 minutes. Staff are exempt. Tune with `SPAM_MESSAGE_LIMIT`, `SPAM_WINDOW_SECONDS`, `SPAM_TIMEOUT_MINUTES`.

**Modlog** — every mod action (including auto-spam timeouts and lockdowns) is recorded to `modlog` and to a 200-entry in-memory history.

## Bot permissions

Invite with the `bot` scope, plus: Manage Roles, Kick Members, Ban Members, **Moderate Members**, Manage Messages, Manage Channels, Send Messages, Read Message History, Embed Links, Attach Files.

Enable **Server Members Intent** under Bot → Privileged Gateway Intents, or welcomes will not fire.

## Deploy to Railway

See the Railway section above.

## AI setup

Any OpenAI-compatible endpoint works. Set `AI_API_URL` (e.g. `https://api.openai.com/v1/chat/completions`), `AI_API_KEY`, and `AI_MODEL`. `lib/ai.js` is standalone so your website backend can share the same AI logic.

## Deploy to Railway

1. Push this folder to a GitHub repo (the `discord-bot/` contents).
2. railway.app → **New Project** → **Deploy from GitHub repo** → pick your repo.
3. Railway auto-detects Node. If it asks, the build command is `npm install` and the start command is `node index.js` (already in `railway.json`).
4. Open the service → **Variables** → add every value from `.env.example`. Blank ones you can skip, except `API_KEY` if you want the HTTP API.
5. Click **Deploy** / it redeploys. Watch the logs for `Logged in as ...` and `[api] HTTP API listening on port ...`.

Railway assigns `PORT` automatically — don't set it yourself.

### Railway checklist

- [ ] `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` set
- [ ] Rank role IDs set (`TICKET_SUPPORT_ROLE_ID` at minimum, plus `RANK_*` for higher tiers)
- [ ] Build succeeds and logs show `Logged in as ...`
- [ ] Bot invited to your server with Manage Channels + Moderate Members
- [ ] **Server Members Intent** enabled in the Developer Portal
- [ ] Run `/ticket setup`, `/ticket live`, `/ticket alerts`, `/modsetup` once
- [ ] Paste the `MODLOG_CHANNEL_ID` from `/modsetup` into Railway variables and redeploy
- [ ] `/ticket panel` in a public channel

### Persistence note

`data.json` lives on Railway's ephemeral filesystem — **it is wiped on every redeploy**. That means tickets, warnings, blacklists and history reset when you push changes. For a long-lived bot, swap `lib/store.js` for SQLite on a mounted volume or a free Postgres/KV addon. Until then, avoid frequent redeploys.

## HTTP API (for your website)

Set `API_KEY` in Railway variables and the bot starts an HTTP server on the same service. Every request needs `Authorization: Bearer <API_KEY>`; without a key configured it refuses all traffic.

```bash
curl -H "Authorization: Bearer $API_KEY" https://your-app.up.railway.app/api/tickets?status=open
```

| Endpoint | Method | Returns |
|---|---|---|
| `/api/health` | GET | bot tag, guild, uptime |
| `/api/tickets?status=open\|closed` | GET | all tickets (metadata only, no message bodies) |
| `/api/tickets/:number` | GET | one ticket **including full message history** |
| `/api/stats` | GET | open counts, unresponded tickets, avg rating |
| `/api/ask` | POST | `{"question":"..."}` → `{"answer":"..."}` via your AI |

Set `CORS_ORIGIN` to your site's domain instead of `*`.

## Known limits

- Transcripts use the live-captured history, so they're no longer capped at 100 messages — but only messages sent **while the bot is online** are captured
- Rating averages are per-user and stored locally
- Alert sweep runs in-process every 5 minutes, so it only fires while the bot is online
- `/reset` wipes tickets, warnings, blacklist, strikes and mod history (Owner only, typed confirmation)