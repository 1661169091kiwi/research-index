// AI usage: what each call to DeepSeek or Claude cost, from the token counts the API reports back and the
// providers' published prices. Shared by the desktop app and the phone app.
//
// DeepSeek (api-docs.deepseek.com, quick_start/pricing; checked 2026-11-10): per 1M tokens, peak prices; off-peak
// is half. Peak: Monday–Friday 09:00–12:00 and 14:00–18:00 Beijing time (01:00–04:00, 06:00–10:00 UTC);
// Chinese public holidays are off-peak too, which this does not know about, so a holiday is counted at the
// peak price (an estimate on the high side). Accounts are billed in CNY or USD; both are kept.
const DEEPSEEK = {
  'deepseek-flash': { CNY: { hit: 0.04, miss: 2, out: 8 }, USD: { hit: 0.006, miss: 0.3, out: 1.2 } },
  'deepseek-v4-pro': { CNY: { hit: 0.3, miss: 9, out: 27 }, USD: { hit: 0.044, miss: 1.32, out: 3.96 } },
};
// Claude Opus 5.5, USD per 1M tokens (cache writes 1.25×, cache reads 0.1× the input price)
const CLAUDE = { input: 4, output: 20 };

export function deepseekPeak(t = Date.now()) {
  const bj = new Date(t + 8 * 3600e3); // Beijing time, read through the UTC getters
  const day = bj.getUTCDay(), h = bj.getUTCHours();
  return day >= 1 && day <= 5 && ((h >= 9 && h < 12) || (h >= 14 && h < 18));
}

// One call's tokens and cost. `usage` is the API's own usage object.
export function costOf(provider, model, usage, t = Date.now()) {
  const u = usage || {};
  if (provider === 'claude') {
    const input = u.input_tokens || 0, write = u.cache_creation_input_tokens || 0, read = u.cache_read_input_tokens || 0, out = u.output_tokens || 0;
    const usd = ((input + 1.25 * write + 0.1 * read) * CLAUDE.input + out * CLAUDE.output) / 1e6;
    return { hit: read, miss: input + write, out, USD: usd, CNY: null };
  }
  const price = DEEPSEEK[String(model || '').toLowerCase()] || DEEPSEEK['deepseek-flash'];
  const total = u.prompt_tokens || 0;
  const hit = u.prompt_cache_hit_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? Math.max(0, total - hit);
  const out = u.completion_tokens || 0;
  const k = deepseekPeak(t) ? 1 : 0.5;
  const at = (p) => ((hit * p.hit + miss * p.miss + out * p.out) / 1e6) * k;
  return { hit, miss, out, CNY: at(price.CNY), USD: at(price.USD), offPeak: k < 1 };
}

export const PRICE_NOTE = { deepseekModels: Object.keys(DEEPSEEK), claude: CLAUDE };

// ---------- the summary the usage panel shows ----------
const DAY = 864e5;
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// log: [{ t, p (provider), m (model), k (kind: take | chat | translate | rate), hit, miss, out, CNY, USD }]
// balances: [{ t, currency, total, granted, toppedUp, available }]
export function summarize({ log = [], balances = [] }, { days = 30, currency = '' } = {}) {
  const now = Date.now();
  const cur = currency || balances.at(-1)?.currency || 'CNY';
  const money = (e) => (cur === 'USD' ? e.USD : e.CNY ?? (e.USD != null ? e.USD * 7.1 : 0)) || 0; // Claude is billed in USD
  const since = now - days * DAY;
  const daysOut = [];
  for (let i = days - 1; i >= 0; i--) daysOut.push({ date: dayKey(now - i * DAY), take: 0, chat: 0, translate: 0, rate: 0, calls: 0 });
  const byDate = new Map(daysOut.map((d) => [d.date, d]));
  const totals = { cost: 0, calls: 0, hit: 0, miss: 0, out: 0, byKind: { take: 0, chat: 0, translate: 0, rate: 0 }, byProvider: {} };
  let today = 0, week = 0;
  for (const e of log) {
    const c = money(e);
    if (e.t >= now - 7 * DAY) week += c;
    if (dayKey(e.t) === dayKey(now)) today += c;
    if (e.t < since) continue;
    const d = byDate.get(dayKey(e.t));
    const kind = e.k in totals.byKind ? e.k : 'take';
    if (d) { d[kind] += c; d.calls++; }
    totals.cost += c;
    totals.calls++;
    totals.hit += e.hit || 0;
    totals.miss += e.miss || 0;
    totals.out += e.out || 0;
    totals.byKind[kind] += c;
    totals.byProvider[e.p] = (totals.byProvider[e.p] || 0) + c;
  }
  // Spending from this key outside the app (an estimate): between two balance readings, how far the balance fell
  // beyond what the app itself spent; a rise (a top-up, or a grant) is left out.
  let outside = 0, outsideFrom = 0;
  const bs = balances.filter((b) => b.currency === cur);
  for (let i = 1; i < bs.length; i++) {
    const a = bs[i - 1], b = bs[i];
    if (b.t < since) continue;
    const drop = a.total - b.total;
    if (drop <= 0) continue;
    const app = log.filter((e) => e.p === 'deepseek' && e.t > a.t && e.t <= b.t).reduce((s, e) => s + money(e), 0);
    outside += Math.max(0, drop - app);
    if (!outsideFrom) outsideFrom = a.t;
  }
  const first = log[0]?.t || 0;
  return {
    currency: cur, days: daysOut, totals, today, week,
    cacheRate: totals.hit + totals.miss ? totals.hit / (totals.hit + totals.miss) : null,
    outside: bs.length > 1 ? { amount: outside, since: outsideFrom || bs[0].t } : null,
    balance: balances.at(-1) || null,
    since: first, peakNow: deepseekPeak(now),
  };
}
