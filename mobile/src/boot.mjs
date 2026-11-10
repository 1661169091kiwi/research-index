// Phone app start-up: runs the feed service (the same code the desktop app runs in its main process)
// inside the page, and gives feed.js the same window.portal.feed interface the desktop preload gives it.

import { createStoreCore, FILES } from './feed/store-core.mjs';
import { createFeedService } from './feed/service.mjs';
import { useFetch } from './feed/sources.mjs';
import { summarizeDeepSeek, streamDeepSeek, completeDeepSeek, classifyDeepSeekError, DEEPSEEK_DEFAULTS, useAiFetch } from './feed/deepseek.mjs';
import { files, httpFetch, createKeys, isNative, device } from './native.mjs';

// the same pages run in the iPhone app: say so before the page's other scripts read it
if (window.Capacitor?.getPlatform?.() === 'ios') {
  document.documentElement.dataset.platform = 'ios';
  document.documentElement.classList.add('is-ios');
}

// older Android WebViews lack these two
if (!AbortSignal.timeout) AbortSignal.timeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(new DOMException('timed out', 'TimeoutError')), ms); return c.signal; };
if (!AbortSignal.any) AbortSignal.any = (list) => { const c = new AbortController(); for (const s of list) { if (s.aborted) { c.abort(s.reason); break; } s.addEventListener('abort', () => c.abort(s.reason), { once: true }); } return c.signal; };

const clone = (v) => (v === undefined ? v : typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const listeners = new Map(); // channel -> Set(callback)
const send = (channel, data) => { for (const cb of listeners.get(channel) || []) { try { cb(clone(data)); } catch (e) { console.error(e); } } };

async function seedFile(name) {
  try { const r = await fetch(new URL(`./seed/${name}.json`, import.meta.url)); return r.ok ? await r.json() : undefined; } catch { return undefined; }
}

const keys = createKeys();
let service = null;
const ready = (async () => {
  useFetch(httpFetch);
  useAiFetch(httpFetch);
  const data = {};
  for (const n of FILES) data[n] = await files.read(`${n}.json`);
  // first start: begin from the snapshot of the desktop app's papers built into the app (if any)
  if (!data.papers) {
    data.papers = await seedFile('papers');
    data.translations = data.translations || await seedFile('translations');
    data.state = data.state || await seedFile('state');
  }
  const pending = {};
  let writing = null;
  const store = createStoreCore(data, (changed) => {
    Object.assign(pending, changed);
    if (!writing) writing = (async () => {
      while (Object.keys(pending).length) {
        const [name] = Object.keys(pending);
        const value = pending[name];
        delete pending[name];
        try { await files.write(`${name}.json`, value); } catch (e) { console.error('[ri] save failed', name, e?.message); }
      }
      writing = null;
    })();
  }, { delay: 600 });
  if (!data.papers || !Object.keys(data.papers).length) store.flush();
  await keys.load(['deepseek']);
  service = createFeedService({
    store, keys, send, maxPool: 4500,
    providers: { fetch: httpFetch, deepseek: { summarize: summarizeDeepSeek, stream: streamDeepSeek, complete: completeDeepSeek, classify: classifyDeepSeekError, defaults: DEEPSEEK_DEFAULTS } },
  });
  // the native side adds the key only for the host it was saved for: keep that in step with the settings
  const aiHandler = service.handlers['feed:ai'];
  service.handlers['feed:ai'] = (patch) => {
    const baseUrl = () => store.state.ai?.baseUrl || DEEPSEEK_DEFAULTS.baseUrl;
    if (patch && 'key' in patch) {
      keys.set('deepseek', patch.key, patch.baseUrl || baseUrl());
      const { key, ...rest } = patch;
      return aiHandler({ ...rest });
    }
    const res = aiHandler(patch);
    if (patch && 'baseUrl' in patch) keys.setHost('deepseek', baseUrl());
    return res;
  };
  service.start();
  // save before the app is put away
  document.addEventListener('visibilitychange', () => { if (document.hidden) store.flush(); });
  window.addEventListener('pagehide', () => store.flush());
  return service;
})();
ready.catch((e) => console.error('[ri] feed failed to start', e));

const invoke = (channel) => async (...args) => clone(await (await ready).handlers[channel](...args));
window.portal = {
  isApp: true,
  isMobile: true,
  native: isNative,
  openFile() {}, reveal() {}, openFolder() {}, chooseFolder() {},
  // a paper as an image: the Android share sheet, or Pictures/Research Index
  shareImage: device?.shareImage,
  saveImage: device ? (name, bytes) => device.saveImage(name, bytes).catch((e) => ({ ok: false, error: String(e?.message || e) })) : undefined,
  openUrl: device?.openUrl,
  fetchImage: device?.fetchImage,
  // updates: the latest release on GitHub (the page's version is stamped in by the build); a new APK downloads
  // in the browser and installs over this one (same signing key)
  update: {
    async check() {
      const current = document.documentElement.dataset.version || '';
      try {
        const r = await httpFetch(`https://api.github.com/repos/${document.documentElement.dataset.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'research-index-app' } });
        if (!r.ok) return { error: `HTTP ${r.status}`, current };
        const j = await r.json();
        return {
          current, version: String(j.tag_name || '').replace(/^v/i, ''), name: j.name || '', notes: String(j.body || '').slice(0, 4000), url: j.html_url,
          assets: (j.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
        };
      } catch (e) { return { error: String(e?.message || e), current }; }
    },
    async install(url) {
      if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\/[^?#]+\.apk$/i.test(String(url))) return { ok: false };
      if (device) await device.openUrl(url); else window.open(url, '_blank');
      return { ok: true, opened: true };
    },
    onProgress() { return () => {}; },
  },
  feed: {
    meta: invoke('feed:meta'), status: invoke('feed:status'), boards: invoke('feed:boards'),
    list: invoke('feed:list'), get: invoke('feed:get'), act: invoke('feed:act'),
    collections: invoke('feed:collections'), interests: invoke('feed:interests'), refresh: invoke('feed:refresh'),
    covers: invoke('feed:covers'), ai: invoke('feed:ai'),
    takeGet: invoke('feed:take:get'), takeRun: invoke('feed:take:run'), takeStop: invoke('feed:take:stop'),
    chatGet: invoke('feed:chat:get'), chatAsk: invoke('feed:chat:ask'), chatStop: invoke('feed:chat:stop'), chatClear: invoke('feed:chat:clear'),
    trTitles: invoke('feed:tr:titles'), trAbstract: invoke('feed:tr:abstract'),
    usage: invoke('feed:usage'), balance: invoke('feed:balance'),
    on(channel, cb) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(cb);
      return () => listeners.get(channel)?.delete(cb);
    },
  },
};

// Android back button (sent by MainActivity): close what is open before leaving the page
window.__riBack = () => {
  // a dialog on top (share card, update, About) closes first
  const top = [...document.querySelectorAll('[data-back-close]')].pop();
  if (top) { top.click(); return true; }
  const sheet = document.getElementById('sheet');
  if (sheet && !sheet.hidden) { sheet.querySelector('[data-close]')?.click(); return true; }
  const pops = [...document.querySelectorAll('[data-pop]')].filter((el) => !el.hidden && el.getClientRects().length);
  if (pops.length) {
    for (const el of pops) { if (el.dataset.pop === 'remove') el.remove(); else el.hidden = true; }
    document.querySelectorAll('[data-pop-opener][aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    return true;
  }
  const swipe = document.getElementById('swipe');
  if (swipe && swipe.hidden && document.getElementById('grid')) { document.getElementById('view-btn')?.click(); return true; }
  return false;
};
