// API keys, one file per provider, encrypted with Windows' own protection (Electron safeStorage).
import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export function createKeyStore(dir) {
  const cache = new Map();
  const file = (provider) => path.join(dir, `${provider}-key.bin`);
  return {
    get(provider) {
      if (cache.has(provider)) return cache.get(provider);
      let key = '';
      try {
        const buf = fs.readFileSync(file(provider));
        key = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
      } catch { /* none yet */ }
      cache.set(provider, key);
      return key;
    },
    set(provider, value) {
      const key = String(value || '').trim();
      fs.mkdirSync(dir, { recursive: true });
      if (!key) fs.rmSync(file(provider), { force: true });
      else fs.writeFileSync(file(provider), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8'));
      cache.set(provider, key);
    },
    encrypted: () => safeStorage.isEncryptionAvailable(),
  };
}
