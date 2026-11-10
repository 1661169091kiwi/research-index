// Builds the Windows installer, keeping every download cache inside portal\.cache (so nothing lands on C:).
//   node scripts/installer.mjs      (same as: npm run installer)
import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');

// The build tools download with plain Node, which ignores the Windows proxy; hand it over explicitly.
function windowsProxy() {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) return process.env.HTTPS_PROXY || process.env.https_proxy;
  if (process.platform !== 'win32') return '';
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/.test(execSync(`reg query "${key}" /v ProxyEnable`, { encoding: 'utf8' }));
    if (!enabled) return '';
    const server = (/ProxyServer\s+REG_SZ\s+(\S+)/.exec(execSync(`reg query "${key}" /v ProxyServer`, { encoding: 'utf8' })) || [])[1] || '';
    const https = (/https=([^;]+)/.exec(server) || [])[1] || server.split(';')[0];
    return https ? (/^\w+:\/\//.test(https) ? https : `http://${https}`) : '';
  } catch { return ''; }
}
const proxy = windowsProxy();

const env = {
  ...process.env,
  ELECTRON_CACHE: path.join(CACHE, 'electron'),          // Electron runtime zips (electron-builder)
  electron_config_cache: path.join(CACHE, 'electron'),   // the same, for @electron/get
  ELECTRON_BUILDER_CACHE: path.join(CACHE, 'electron-builder'), // NSIS and other build tools
  ...(proxy ? {
    HTTPS_PROXY: proxy, HTTP_PROXY: proxy,
    ELECTRON_GET_USE_PROXY: 'true', GLOBAL_AGENT_HTTPS_PROXY: proxy, GLOBAL_AGENT_HTTP_PROXY: proxy,
  } : {}),
};
if (proxy) console.log(`Using proxy ${proxy} for build downloads`);

function run(args) {
  const res = spawnSync(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

run([path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js'), '--win', 'nsis', '--x64']);
