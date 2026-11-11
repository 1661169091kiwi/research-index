// Exposes the few things the pages may ask the desktop app to do.
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['feed:batch', 'feed:progress', 'feed:cover', 'feed:take', 'feed:tr', 'feed:chat', 'feed:usage', 'feed:quality']);

contextBridge.exposeInMainWorld('portal', {
  isApp: true,
  openFile: (p) => ipcRenderer.invoke('ri:open-file', p),
  reveal: (p) => ipcRenderer.invoke('ri:reveal', p),
  openFolder: () => ipcRenderer.invoke('ri:open-folder'),
  chooseFolder: () => ipcRenderer.invoke('ri:choose-folder'),
  // the colors of the page's bar, for the window buttons drawn over it (#rrggbb)
  chrome: (bg, fg) => ipcRenderer.send('ri:chrome', String(bg), String(fg)),
  // a paper as an image: save it (a file dialog) or put it on the clipboard
  saveImage: (name, bytes) => ipcRenderer.invoke('ri:save-image', String(name), bytes),
  saveText: (name, text) => ipcRenderer.invoke('ri:save-text', String(name), String(text)),
  copyImage: (bytes) => ipcRenderer.invoke('ri:copy-image', bytes),
  // a paper's figure, for its share card: { bytes, type } or null
  fetchImage: (url) => ipcRenderer.invoke('ri:fetch-image', String(url)),
  // updates from the GitHub releases
  update: {
    check: () => ipcRenderer.invoke('ri:update-check'),
    install: (url) => ipcRenderer.invoke('ri:update-install', String(url)),
    onProgress: (cb) => { const fn = (_e, p) => cb(p); ipcRenderer.on('ri:update-progress', fn); return () => ipcRenderer.removeListener('ri:update-progress', fn); },
  },
  feed: {
    meta: () => ipcRenderer.invoke('feed:meta'),
    status: () => ipcRenderer.invoke('feed:status'),
    boards: () => ipcRenderer.invoke('feed:boards'),
    list: (params) => ipcRenderer.invoke('feed:list', params),
    get: (id) => ipcRenderer.invoke('feed:get', id),
    act: (id, action, payload) => ipcRenderer.invoke('feed:act', id, action, payload),
    collections: (op, a, b) => ipcRenderer.invoke('feed:collections', op, a, b),
    interests: (text) => ipcRenderer.invoke('feed:interests', text),
    refresh: () => ipcRenderer.invoke('feed:refresh'),
    covers: (ids) => ipcRenderer.invoke('feed:covers', ids),
    // Claude takes: the API key stays in the main process; the page only learns whether one is set.
    ai: (patch) => ipcRenderer.invoke('feed:ai', patch),
    takeGet: (id) => ipcRenderer.invoke('feed:take:get', id),
    takeRun: (id, mode, lang) => ipcRenderer.invoke('feed:take:run', id, mode, lang),
    takeStop: (id, key) => ipcRenderer.invoke('feed:take:stop', id, key),
    // questions about one paper (direct, or follow-ups on its take)
    chatGet: (id) => ipcRenderer.invoke('feed:chat:get', id),
    chatAsk: (id, question, lang) => ipcRenderer.invoke('feed:chat:ask', id, question, lang),
    chatStop: (id) => ipcRenderer.invoke('feed:chat:stop', id),
    chatClear: (id) => ipcRenderer.invoke('feed:chat:clear', id),
    // Chinese translation of what is on screen
    trTitles: (ids) => ipcRenderer.invoke('feed:tr:titles', ids),
    trAbstract: (id) => ipcRenderer.invoke('feed:tr:abstract', id),
    usage: (opts) => ipcRenderer.invoke('feed:usage', opts),
    balance: () => ipcRenderer.invoke('feed:balance'),
    on: (channel, cb) => {
      if (!EVENTS.has(channel)) return () => {};
      const fn = (_e, data) => cb(data);
      ipcRenderer.on(channel, fn);
      return () => ipcRenderer.removeListener(channel, fn);
    },
  },
});
