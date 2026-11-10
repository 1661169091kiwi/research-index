// DeepSeek provider for paper summaries: OpenAI-style Chat Completions with server-sent-event streaming.
// https://api-docs.deepseek.com/api/create-chat-completion/

// The desktop app hands in Electron's net.fetch (it follows the Windows proxy); the phone app hands in
// its native request, which adds the API key itself so the page never holds it.
let doFetch = (url, init) => fetch(url, init);
export function useAiFetch(fn) { doFetch = fn; }

const timeoutSignal = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };

export const DEEPSEEK_DEFAULTS = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' };

export function classifyDeepSeekError(err) {
  if (err?.name === 'AbortError' || err?.code === 'stopped') return { code: 'stopped' };
  if (err?.code === 'refusal') return { code: 'refusal' };
  switch (err?.status) {
    case 401: return { code: 'auth' };
    case 402: return { code: 'billing' };
    case 429: return { code: 'rate' };
    case 400: case 422: return { code: 'bad', message: err.message };
    case 500: case 502: case 503: return { code: 'server' };
  }
  if (err?.status) return { code: 'api', message: `${err.status}: ${err.message}` };
  return { code: 'network', message: String(err?.message || err) };
}

// One-shot completion with thinking off (used for translation, where speed matters more than depth).
// onUsage(usage, model): the API's token counts for this call (for the usage meter)
export async function completeDeepSeek({ apiKey, baseUrl, model, system, user, maxTokens = 4000, onUsage }) {
  const res = await doFetch(`${String(baseUrl || DEEPSEEK_DEFAULTS.baseUrl).replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    signal: timeoutSignal(120000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || DEEPSEEK_DEFAULTS.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: false,
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
    }),
  });
  if (!res.ok) {
    let message = '';
    try { const j = await res.json(); message = j?.error?.message || JSON.stringify(j); } catch { /* not JSON */ }
    throw Object.assign(new Error(message || `HTTP ${res.status}`), { status: res.status });
  }
  const j = await res.json();
  if (j.usage) onUsage?.(j.usage, j.model || model);
  const choice = j.choices?.[0];
  if (choice?.finish_reason === 'content_filter' && !choice?.message?.content) throw Object.assign(new Error('refusal'), { code: 'refusal' });
  return choice?.message?.content || '';
}

// Streams the summary; onText gets each visible text delta (the model's reasoning is not shown).
export function summarizeDeepSeek({ user, mode, ...rest }) {
  return streamDeepSeek({ ...rest, messages: [{ role: 'user', content: user }], effort: mode === 'deep' ? 'high' : 'low' });
}

// Streams a reply to a conversation: messages are [{ role: 'user' | 'assistant', content }].
// DeepSeek caches shared prefixes on its own, so follow-ups that resend the same paper are cheap.
export function streamDeepSeek({ apiKey, baseUrl, model, system, messages, effort = 'low', onText }) {
  const ctl = new AbortController();
  const done = (async () => {
    const res = await doFetch(`${String(baseUrl || DEEPSEEK_DEFAULTS.baseUrl).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || DEEPSEEK_DEFAULTS.model,
        messages: [{ role: 'system', content: system }, ...messages],
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 32000,
        reasoning_effort: effort,
      }),
    });
    if (!res.ok) {
      let message = '';
      try { const j = await res.json(); message = j?.error?.message || JSON.stringify(j); } catch { /* not JSON */ }
      throw Object.assign(new Error(message || `HTTP ${res.status}`), { status: res.status });
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', text = '', usage = null, finish = null, modelName = model;
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let chunk;
        try { chunk = JSON.parse(data); } catch { continue; }
        if (chunk.model) modelName = chunk.model;
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        const delta = choice?.delta?.content;
        if (delta) { text += delta; onText(delta); }
        if (choice?.finish_reason) finish = choice.finish_reason;
      }
    }
    if (finish === 'content_filter' && !text.trim()) throw Object.assign(new Error('refusal'), { code: 'refusal' });
    return {
      text, provider: 'deepseek', model: modelName, truncated: finish === 'length', cost: null, usage,
      tokens: { input: usage?.prompt_tokens || 0, output: usage?.completion_tokens || 0 },
    };
  })();
  return { done, abort: () => ctl.abort() };
}
