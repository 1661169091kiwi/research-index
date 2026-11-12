// Phone-side services for the feed: files, network requests and API keys.
// Inside the Android app they go through native code (Capacitor's bridge, no bundler needed):
//   files   → @capacitor/filesystem, in the app's private storage
//   fetch   → RiNative.request (Java): no CORS, streams the reply back in chunks, and adds the API key
//             itself, so the key never enters the page (it is stored encrypted with the Android Keystore)
// In a plain browser (the web version, and developer previews) they fall back to fetch() and IndexedDB; the web
// version sends arXiv's search API (the one source that does not allow a web page to call it) through a relay,
// and keeps the reader's API key in this browser.

const cap = window.Capacitor;
export const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
export const isWeb = !isNative && document.documentElement.dataset.platform === 'web';
const call = (plugin, method, options) => cap.nativePromise(plugin, method, options);

// ---------- files ----------
const DIR = 'DATA';
// Each file is written to <name>.tmp first, then moved over the old one; if the app stops between the
// two steps, the .tmp copy is read next time.
const readJson = async (path) => JSON.parse((await call('Filesystem', 'readFile', { path, directory: DIR, encoding: 'utf8' })).data);
export const files = isNative ? {
  async read(name) {
    try { return await readJson(`feed/${name}`); } catch { /* missing or cut short */ }
    try { return await readJson(`feed/${name}.tmp`); } catch { return undefined; }
  },
  async write(name, value) {
    const tmp = `feed/${name}.tmp`, file = `feed/${name}`;
    await call('Filesystem', 'writeFile', { path: tmp, directory: DIR, encoding: 'utf8', recursive: true, data: JSON.stringify(value) });
    await call('Filesystem', 'deleteFile', { path: file, directory: DIR }).catch(() => {});
    await call('Filesystem', 'rename', { from: tmp, to: file, directory: DIR, toDirectory: DIR });
  },
} : browserFiles();

// The browser's own database (IndexedDB): room for a whole library, where localStorage stops at about 5 MB.
// Files an older build kept in localStorage are moved over the first time they are read.
function browserFiles() {
  let db = null;
  const open = () => db || (db = new Promise((resolve, reject) => {
    const req = indexedDB.open('research-index', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction('files', mode);
      const r = fn(t.objectStore('files'));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    async read(name) {
      try {
        const v = await tx('readonly', (s) => s.get(name));
        if (v !== undefined) return typeof v === 'string' ? JSON.parse(v) : v;
      } catch (e) { console.warn('[ri] cannot read', name, e?.message); }
      try {
        const old = localStorage.getItem(`ri-file:${name}`);
        if (old == null) return undefined;
        const v = JSON.parse(old);
        await this.write(name, v);
        localStorage.removeItem(`ri-file:${name}`);
        return v;
      } catch { return undefined; }
    },
    async write(name, value) {
      try { await tx('readwrite', (s) => s.put(JSON.stringify(value), name)); } catch (e) { console.warn('[ri] cannot store', name, e?.message); }
    },
  };
}

// ---------- network ----------
let rid = 0;
const streams = new Map();
if (isNative) {
  cap.addListener('RiNative', 'http', (ev) => {
    const s = ev && streams.get(ev.rid);
    if (s) s[ev.type]?.(ev);
  });
}
const NO_BODY = new Set([101, 204, 205, 304]);
function abortError() { try { return new DOMException('The operation was aborted.', 'AbortError'); } catch { const e = new Error('aborted'); e.name = 'AbortError'; return e; } }

// fetch()-compatible: returns a real Response whose body streams as the native side reads.
// init.until = 'figure' stops reading an arXiv HTML page at its first figure (pages can be several MB).
function nativeFetch(url, init = {}) {
  const id = ++rid;
  return new Promise((resolve, reject) => {
    let ctl = null, headed = false, finished = false;
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(c) { ctl = c; },
      cancel() { if (!finished) { finished = true; call('RiNative', 'cancel', { rid: id }).catch(() => {}); streams.delete(id); } },
    });
    const fail = (err) => {
      if (finished) return;
      finished = true;
      streams.delete(id);
      if (!headed) reject(err); else { try { ctl.error(err); } catch { /* already closed */ } }
    };
    streams.set(id, {
      head(ev) {
        headed = true;
        const status = ev.status >= 200 && ev.status <= 599 ? ev.status : 502;
        resolve(new Response(NO_BODY.has(status) ? null : body, { status, headers: ev.headers || {} }));
      },
      data(ev) { if (!finished && ev.text) ctl.enqueue(enc.encode(ev.text)); },
      end() { if (finished) return; finished = true; streams.delete(id); try { ctl.close(); } catch { /* cancelled */ } },
      error(ev) { fail(Object.assign(new Error(ev.message || 'network error'), { code: 'network' })); },
    });
    const signal = init.signal;
    if (signal) {
      if (signal.aborted) { fail(abortError()); return; }
      signal.addEventListener('abort', () => { call('RiNative', 'cancel', { rid: id }).catch(() => {}); fail(abortError()); }, { once: true });
    }
    const headers = {};
    if (init.headers) for (const [k, v] of (init.headers instanceof Headers ? init.headers.entries() : Object.entries(init.headers))) headers[k] = String(v);
    call('RiNative', 'request', {
      rid: id, url: String(url), method: init.method || 'GET', headers,
      body: typeof init.body === 'string' ? init.body : null, until: init.until || '', timeout: 60000,
    }).catch((e) => fail(Object.assign(new Error(e?.message || 'network error'), { code: 'network' })));
  });
}
// the web version: arXiv's search API through the relay named in the page (<meta name="ri-relay">)
const RELAY = (document.querySelector('meta[name="ri-relay"]')?.content || '').replace(/\/+$/, '');
const relayed = (url) => (RELAY && /^https?:\/\/(export\.)?arxiv\.org\/api\//i.test(String(url)) ? `${RELAY}/?u=${encodeURIComponent(String(url).replace(/^http:/, 'https:'))}` : url);
export const hasRelay = !!RELAY;
export const httpFetch = isNative ? nativeFetch : (url, init = {}) => { const { until, ...rest } = init; return fetch(relayed(url), rest); };

// ---------- a paper's share card to the share sheet or the gallery; a page in the browser ----------
const base64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
export const device = isNative ? {
  shareImage: (name, bytes, title, text) => call('RiNative', 'shareImage', { name, data: base64(bytes), title, text }).then(() => ({ ok: true })),
  saveImage: (name, bytes) => call('RiNative', 'saveImage', { name, data: base64(bytes) }).then((r) => ({ ok: true, path: r?.where || '' })),
  // an exported list (Markdown): the share sheet, or Download/Research Index (iOS: the share sheet both ways)
  shareText: (name, text, title) => call('RiNative', 'shareText', { name, text, title }).then(() => ({ ok: true })),
  saveText: (name, text) => call('RiNative', 'saveText', { name, text }).then((r) => ({ ok: true, path: r?.where || '', shared: !!r?.shared })),
  openUrl: (url) => call('RiNative', 'openUrl', { url }),
  fetchImage: (url) => call('RiNative', 'fetchImage', { url }).then((r) => {
    const bin = atob(r.data || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, type: r.type || 'image/png' };
  }).catch(() => null),
} : isWeb ? webDevice() : null;

// The web version: a paper's image or an exported list goes to the browser's share sheet when it can take files
// (phones); figures are fetched directly (arXiv allows it). Without a share sheet the page falls back to a download.
function webDevice() {
  const canFiles = (file) => { try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch { return false; } };
  const fileOf = (name, data, type) => new File([data], name, { type });
  const d = {
    fetchImage: async (url) => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!r.ok || !/^image\//i.test(r.headers.get('content-type') || '')) return null;
        return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get('content-type') };
      } catch { return null; }
    },
  };
  if (navigator.share && canFiles(fileOf('x.png', new Uint8Array(1), 'image/png'))) {
    d.shareImage = (name, bytes, title, text) => navigator.share({ files: [fileOf(name, bytes, 'image/png')], title, text }).then(() => ({ ok: true }), (e) => (e?.name === 'AbortError' ? { ok: false, canceled: true } : Promise.reject(e)));
    d.shareText = (name, text, title) => navigator.share({ files: [fileOf(name, text, 'text/markdown')], title }).catch((e) => { if (e?.name !== 'AbortError') return navigator.share({ title, text }); });
  }
  return d;
}

// ---------- API keys ----------
// The page only ever sees a placeholder ("@native:deepseek"); the native request swaps in the real key,
// and only for the host the key was saved for.
const HOST_OF = (url) => { try { return new URL(url).host; } catch { return ''; } };
export function createKeys() {
  const info = {}; // provider -> { has, hint }
  // browser: the web version keeps the key in this browser (localStorage) and sends it only to the AI provider;
  // a developer preview keeps it in memory
  const mem = {};
  if (isWeb) { try { const k = localStorage.getItem('ri-key:deepseek'); if (k) mem.deepseek = k; } catch { /* storage off */ } }
  return {
    async load(providers) {
      if (!isNative) return;
      try { Object.assign(info, await call('RiNative', 'keyInfo', { providers })); } catch { /* none */ }
    },
    get(provider) {
      if (!isNative) return mem[provider] || '';
      return info[provider]?.has ? `@native:${provider}` : '';
    },
    hint(provider) { return isNative ? (info[provider]?.hint ? `…${info[provider].hint}` : '') : `…${(mem[provider] || '').slice(-4)}`; },
    set(provider, value, baseUrl) {
      const key = String(value || '').trim();
      if (!isNative) {
        mem[provider] = key;
        if (isWeb) { try { if (key) localStorage.setItem(`ri-key:${provider}`, key); else localStorage.removeItem(`ri-key:${provider}`); } catch { /* storage off */ } }
        return;
      }
      info[provider] = { has: !!key, hint: key.slice(-4) };
      call('RiNative', 'setKey', { provider, key, host: HOST_OF(baseUrl) }).catch((e) => console.error('[ri] key not saved', e?.message));
    },
    setHost(provider, baseUrl) { if (isNative) call('RiNative', 'setKeyHost', { provider, host: HOST_OF(baseUrl) }).catch(() => {}); },
  };
}
