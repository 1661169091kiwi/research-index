// Phone-side services for the feed: files, network requests and API keys.
// Inside the Android app they go through native code (Capacitor's bridge, no bundler needed):
//   files   → @capacitor/filesystem, in the app's private storage
//   fetch   → RiNative.request (Java): no CORS, streams the reply back in chunks, and adds the API key
//             itself, so the key never enters the page (it is stored encrypted with the Android Keystore)
// In a plain browser (developer previews and tests) they fall back to fetch() and localStorage.

const cap = window.Capacitor;
export const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
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
} : {
  async read(name) { try { const v = localStorage.getItem(`ri-file:${name}`); return v == null ? undefined : JSON.parse(v); } catch { return undefined; } },
  async write(name, value) { try { localStorage.setItem(`ri-file:${name}`, JSON.stringify(value)); } catch (e) { console.warn('[ri] cannot store', name, e.message); } },
};

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
export const httpFetch = isNative ? nativeFetch : (url, init) => fetch(url, init);

// ---------- a paper's share card to the share sheet or the gallery; a page in the browser ----------
const base64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
export const device = isNative ? {
  shareImage: (name, bytes, title, text) => call('RiNative', 'shareImage', { name, data: base64(bytes), title, text }).then(() => ({ ok: true })),
  saveImage: (name, bytes) => call('RiNative', 'saveImage', { name, data: base64(bytes) }).then((r) => ({ ok: true, path: r?.where || '' })),
  openUrl: (url) => call('RiNative', 'openUrl', { url }),
  fetchImage: (url) => call('RiNative', 'fetchImage', { url }).then((r) => {
    const bin = atob(r.data || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, type: r.type || 'image/png' };
  }).catch(() => null),
} : null;

// ---------- API keys ----------
// The page only ever sees a placeholder ("@native:deepseek"); the native request swaps in the real key,
// and only for the host the key was saved for.
const HOST_OF = (url) => { try { return new URL(url).host; } catch { return ''; } };
export function createKeys() {
  const info = {}; // provider -> { has, hint }
  const mem = {};  // browser fallback only
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
      if (!isNative) { mem[provider] = key; return; }
      info[provider] = { has: !!key, hint: key.slice(-4) };
      call('RiNative', 'setKey', { provider, key, host: HOST_OF(baseUrl) }).catch((e) => console.error('[ri] key not saved', e?.message));
    },
    setHost(provider, baseUrl) { if (isNative) call('RiNative', 'setKeyHost', { provider, host: HOST_OF(baseUrl) }).catch(() => {}); },
  };
}
