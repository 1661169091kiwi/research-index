// Desktop side of the paper feed: the shared service (service.mjs) wired to Electron IPC, with
// network requests through Electron (they follow the Windows proxy) and API keys kept in this process.

import { ipcMain, net, session } from 'electron';
import path from 'node:path';
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
  const store = createStore(path.join(userDataDir, 'feed'));
  const keys = createKeyStore(path.join(userDataDir, 'feed'));
  const send = (channel, data) => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send(channel, data); };
  const service = createFeedService({
    store, keys, send,
    providers: {
      deepseek: { summarize: summarizeDeepSeek, stream: streamDeepSeek, complete: completeDeepSeek, classify: classifyDeepSeekError, defaults: DEEPSEEK_DEFAULTS },
      claude: { summarize: summarizeClaude, stream: streamClaude, complete: completeClaude, classify: classifyClaudeError, model: CLAUDE_MODEL },
    },
    envKey: (provider) => (provider === 'claude' ? process.env.ANTHROPIC_API_KEY : process.env.DEEPSEEK_API_KEY) || '',
    debug: !!process.env.RI_SELFTEST,
  });
  for (const [channel, fn] of Object.entries(service.handlers)) ipcMain.handle(channel, (_e, ...args) => fn(...args));
  return service;
}
