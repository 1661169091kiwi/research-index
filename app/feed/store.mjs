// Desktop storage for the paper feed: plain JSON files in the app's user-data folder, written atomically.
// The data model itself is in store-core.mjs (shared with the phone app).

import fs from 'node:fs';
import path from 'node:path';
import { createStoreCore, FILES } from './store-core.mjs';

const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeAtomic = (file, data) => {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
};

export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const data = Object.fromEntries(FILES.map((n) => [n, read(path.join(dir, `${n}.json`), undefined)]));
  return createStoreCore(data, (changed) => {
    for (const [name, value] of Object.entries(changed)) writeAtomic(path.join(dir, `${name}.json`), value);
  });
}
