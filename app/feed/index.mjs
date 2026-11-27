// Desktop side of the paper feed: the shared service (service.mjs) wired to Electron IPC, with
// network requests through Electron (they follow the Windows proxy) and API keys kept in this process.

import { ipcMain, net, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { usePack, packDir } from './packs.mjs';
import { createStore } from './store.mjs';
import { useFetch } from './sources.mjs';
import { createKeyStore } from './keys.mjs';
import { createFeedService } from './service.mjs';
import { summarizeClaude, streamClaude, completeClaude, classifyClaudeError, CLAUDE_MODEL } from './claude.mjs';
import { summarizeDeepSeek, streamDeepSeek, completeDeepSeek, classifyDeepSeekError, DEEPSEEK_DEFAULTS, useAiFetch } from './deepseek.mjs';

export function setupFeed({ userDataDir, getWindow }) {
  // arXiv / Hugging Face lookups run in their own (in-memory) session: with a separate connection
  // pool they do not queue behind the figure images the page is loading from the same host.
  const fetchSession = session.fromPartition('ri-fetch', { cache: false });
  useFetch((url, init) => fetchSession.fetch(url, init));
  useAiFetch((url, init) => net.fetch(url, init));
  // the discipline pack (pack.json in the data folder, set from the settings): each keeps its own library;
  // the API key stays in feed/ for all of them
  let packId = 'ai';
  try { packId = JSON.parse(fs.readFileSync(path.join(userDataDir, 'pack.json'), 'utf8')).id || 'ai'; } catch { /* the default */ }
  const P = usePack(packId);
  const store = createStore(path.join(userDataDir, packDir(P.id)));
  // a pack opened for the first time takes the AI settings (provider, model, limits, "about you") of the main one
  if (P.id !== 'ai' && !store.state.ai) {
    try {
      const main = JSON.parse(fs.readFileSync(path.join(userDataDir, 'feed', 'state.json'), 'utf8'));
      if (main.ai) store.setAi(main.ai);
      if (main.aiContext) store.setAiContext(main.aiContext);
    } catch { /* nothing to copy */ }
  }
  const keys = createKeyStore(path.join(userDataDir, 'feed'));
  const send = (channel, data) => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send(channel, data); };
  const service = createFeedService({
    store, keys, send,
    providers: {
      fetch: (url, init) => net.fetch(url, init), // the balance lookup (follows the Windows proxy)
      deepseek: { summarize: summarizeDeepSeek, stream: streamDeepSeek, complete: completeDeepSeek, classify: classifyDeepSeekError, defaults: DEEPSEEK_DEFAULTS },
      claude: { summarize: summarizeClaude, stream: streamClaude, complete: completeClaude, classify: classifyClaudeError, model: CLAUDE_MODEL },
    },
    envKey: (provider) => (provider === 'claude' ? process.env.ANTHROPIC_API_KEY : process.env.DEEPSEEK_API_KEY) || '',
    debug: !!process.env.RI_SELFTEST,
  });
  for (const [channel, fn] of Object.entries(service.handlers)) ipcMain.handle(channel, (_e, ...args) => fn(...args));
  return service;
}
