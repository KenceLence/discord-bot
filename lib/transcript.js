const { EmbedBuilder } = require('discord.js');
const config = require('../config');

const MAX_EMBEDS = 10;
const PER_EMBED_LINES = 18;

/**
 * Build a transcript from the ticket's live-captured history.
 * Falls back to fetching the channel if nothing was captured (e.g. bot was offline).
 */
async function buildTranscript(channel, ticket) {
  const captured = ticket.messages || [];

  let messages;
  if (captured.length) {
    messages = captured.map((m) => ({
      content: m.content,
      createdTimestamp: m.at,
      attachments: m.attachments,
      author: { username: m.authorTag?.split('#')[0] || 'user', tag: m.authorTag || 'user' },
    }));
  } else {
    const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    messages = fetched
      ? [...fetched.values()].map((m) => ({
          content: m.content,
          createdTimestamp: m.createdTimestamp,
          attachments: m.attachments.size,
          author: m.author,
        }))
      : [];
  }

  if (!messages.length) return null;

  const sorted = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const embeds = [];
  let current = new EmbedBuilder()
    .setColor(config.colors.neutral)
    .setAuthor({
      name: ticket.subject || 'Support ticket',
      iconURL: channel.guild?.iconURL?.() || undefined,
    });
  let chunk = [];
  let flush = () => {
    if (!chunk.length) return;
    current.addFields({ name: '\u200b', value: '```' + chunk.join('\n') + '```' });
    embeds.push(current);
    current = new EmbedBuilder().setColor(config.colors.neutral);
    chunk = [];
  };

  for (const m of sorted) {
    const time = new Date(m.createdTimestamp).toISOString().slice(11, 16);
    const body = (m.content || '').replace(/```/g, "'''").slice(0, 300) ||
      (m.attachments ? `*(${m.attachments} attachment${m.attachments === 1 ? '' : 's'})*` : '*no text*');
    chunk.push(`[${time}] ${m.author.username}: ${body}`);

    if (chunk.length >= PER_EMBED_LINES) flush();
  }
  flush();

  return {
    embeds: embeds.slice(0, MAX_EMBEDS),
    messageCount: sorted.length,
    truncated: embeds.length > MAX_EMBEDS,
  };
}

function summaryEmbed(ticket, messageCount, closer) {
  return new EmbedBuilder()
    .setColor(ticket.priority === 'urgent' ? config.colors.danger : config.colors.main)
    .setTitle(`Ticket #${ticket.number} — ${ticket.subject || 'No subject'}`)
    .addFields(
      { name: 'Opened by', value: `<@${ticket.userId}>`, inline: true },
      { name: 'Category', value: ticket.category, inline: true },
      { name: 'Priority', value: ticket.priority, inline: true },
      { name: 'Staff replies', value: String(ticket.staffReplies ?? 0), inline: true },
      { name: 'Messages', value: String(messageCount), inline: true },
      { name: 'Duration', value: formatDuration((ticket.closedAt || Date.now()) - ticket.createdAt), inline: true },
      { name: 'Closed by', value: closer ? `<@${closer}>` : 'Unknown', inline: true },
      { name: 'Reason', value: ticket.closeReason || 'None given', inline: false },
      ...(ticket.notes.length
        ? [{ name: `Staff notes (${ticket.notes.length})`, value: ticket.notes.map((n) => `• <@${n.authorId}>: ${n.body}`).join('\n').slice(0, 1000), inline: false }]
        : [])
    )
    .setFooter({ text: `Ticket ID: ${ticket.number}` })
    .setTimestamp();
}

function formatDuration(ms) {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

module.exports = { buildTranscript, summaryEmbed, formatDuration };