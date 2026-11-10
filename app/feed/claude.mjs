// Claude provider for paper summaries (official Anthropic SDK). Main process only.

import Anthropic from '@anthropic-ai/sdk';
import { net } from 'electron';

export const CLAUDE_MODEL = 'claude-opus-5-5';
const PRICE_PER_MTOK = { input: 4, output: 20 }; // Claude Opus 5.5, USD — for the "≈ $" estimate only

export function classifyClaudeError(err) {
  if (err instanceof Anthropic.APIUserAbortError) return { code: 'stopped' };
  if (err?.code === 'refusal') return { code: 'refusal', message: err.detail || '' };
  if (err instanceof Anthropic.AuthenticationError) return { code: 'auth' };
  if (err instanceof Anthropic.PermissionDeniedError) return { code: 'permission', message: err.message };
  if (err instanceof Anthropic.RateLimitError) return { code: 'rate' };
  if (err instanceof Anthropic.BadRequestError) return { code: 'bad', message: err.message };
  if (err instanceof Anthropic.InternalServerError) return { code: 'server' };
  if (err instanceof Anthropic.APIConnectionError) return { code: 'network' };
  if (err instanceof Anthropic.APIError) return err.status === 402 ? { code: 'billing' } : { code: 'api', message: `${err.status}: ${err.message}` };
  return { code: 'unknown', message: String(err?.message || err) };
}

let client = null;
let clientKey = '';
function getClient(apiKey) {
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({
      apiKey,
      // Electron's network stack follows the Windows proxy settings (Node's fetch does not).
      fetch: (input, init) => net.fetch(typeof input === 'string' || input instanceof Request ? input : String(input), init),
    });
    clientKey = apiKey;
  }
  return client;
}

// One-shot completion at low effort (used for translation).
export async function completeClaude({ apiKey, system, user, maxTokens = 8000 }) {
  const msg = await getClient(apiKey).beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (msg.stop_reason === 'refusal') throw Object.assign(new Error('refusal'), { code: 'refusal', detail: msg.stop_details?.explanation || '' });
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// Streams the summary; onText gets each text delta. Returns { done: Promise, abort() }.
export function summarizeClaude({ system, user, mode, ...rest }) {
  return streamClaude({
    ...rest,
    system: mode === 'quick' ? `${system}\n\nLatency-sensitive: begin your visible answer immediately.` : system,
    messages: [{ role: 'user', content: user }],
  });
}

// Streams a reply to a conversation: messages are [{ role, content }] in the Messages API shape.
export function streamClaude({ apiKey, system, messages, effort = 'medium', onText }) {
  const stream = getClient(apiKey).beta.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default', // if a safety classifier declines, the API re-runs the request on a fallback model
    output_config: { effort },
    system,
    messages,
  });
  stream.on('text', (delta) => onText(delta));
  const done = stream.finalMessage().then((msg) => {
    if (msg.stop_reason === 'refusal') throw Object.assign(new Error('refusal'), { code: 'refusal', detail: msg.stop_details?.explanation || '' });
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const u = msg.usage || {};
    const cost = ((u.input_tokens || 0) + 1.25 * (u.cache_creation_input_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0)) * PRICE_PER_MTOK.input / 1e6
      + (u.output_tokens || 0) * PRICE_PER_MTOK.output / 1e6;
    return {
      text, provider: 'claude', model: msg.model, truncated: msg.stop_reason === 'max_tokens', cost,
      tokens: { input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output: u.output_tokens || 0 },
    };
  });
  return { done, abort: () => stream.abort() };
}
