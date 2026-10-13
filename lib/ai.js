const { ai } = require('../config');

const SYSTEM_PROMPT = 'You are a helpful assistant embedded in a Discord server. Keep answers short (under 300 words) unless asked for detail.';

async function ask(question, history = []) {
  if (!ai.url || !ai.key) throw new Error('AI is not configured (AI_API_URL / AI_API_KEY missing).');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: question },
  ];

  const res = await fetch(ai.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ai.key}`,
    },
    body: JSON.stringify({ model: ai.model, messages }),
  });

  if (!res.ok) throw new Error(`AI request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '(no response)';
}

module.exports = { ask };