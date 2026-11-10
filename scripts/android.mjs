// Builds the Android app (an .apk you can install on your phone) into portal/release.
//   node scripts/android.mjs            (same as: cd mobile && npm run apk)
//   node scripts/android.mjs --no-seed  without the snapshot of your desktop papers / likes / interests
//
// Uses the Android SDK at D:\AndroidSDK and a JDK 21+; every download and cache stays on D:
// (portal\.cache\gradle, portal\.cache\android-user). Gradle reuses, read-only, any libraries already
// in C:\Users\<you>\.gradle so nothing new is written there.
// The app is signed with mobile/keystore/release.jks (made on the first build; keep it: Android only
// installs an update over the app when it is signed with the same key).

import { execSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = path.join(ROOT, 'mobile');
const ANDROID = path.join(MOBILE, 'android');
const CACHE = path.join(ROOT, '.cache');
const pkg = JSON.parse(fs.readFileSync(path.join(MOBILE, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const log = (s) => console.log(`\n▸ ${s}`);

// ---------- tools ----------
function findJdk() {
  const javaVer = (home) => { try { return +(/version "(\d+)/.exec(execSync(`"${path.join(home, 'bin', 'java.exe')}" -version 2>&1`, { encoding: 'utf8' })) || [])[1] || 0; } catch { return 0; } };
  const candidates = [process.env.RI_JAVA_HOME, process.env.JAVA_HOME, 'D:/AndroidStudio/jbr', path.join(CACHE, 'jdk')]
    .concat(...['C:/Program Files/Java', 'C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Microsoft', path.join(os.homedir(), '.jdks')]
      .map((d) => { try { return fs.readdirSync(d).map((x) => path.join(d, x)); } catch { return []; } }))
    .filter(Boolean);
  // a full JDK: the Android Gradle plugin needs jlink (IDE-bundled runtimes usually lack it)
  for (const home of candidates) if (fs.existsSync(path.join(home, 'bin', 'jlink.exe')) && javaVer(home) >= 21) return home;
  throw new Error('No JDK 21 or newer found. Install one (for example Microsoft OpenJDK 21) or set RI_JAVA_HOME.');
}
function windowsProxy() {
  if (process.env.HTTPS_PROXY) return process.env.HTTPS_PROXY;
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/.test(execSync(`reg query "${key}" /v ProxyEnable`, { encoding: 'utf8' }))) return '';
    const server = (/ProxyServer\s+REG_SZ\s+(\S+)/.exec(execSync(`reg query "${key}" /v ProxyServer`, { encoding: 'utf8' })) || [])[1] || '';
    const https = (/https=([^;]+)/.exec(server) || [])[1] || server.split(';')[0];
    return https ? (/^\w+:\/\//.test(https) ? https : `http://${https}`) : '';
  } catch { return ''; }
}

// ---------- launcher icon (the Research Index mark: blue square, three white blocks) ----------
const BLUE = [0x1f, 0x3b, 0xe6];
const RECTS = [[14, 14, 10, 36], [30, 14, 20, 10], [40, 40, 10, 10]]; // on a 64-unit grid, as in make-icon.mjs
function render(size, { background = true, circle = false, scale = 1 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const u = (size / 64) * scale, o = size / 2 - 32 * u;
  const SS = 4; // supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inShape = 0, white = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const fx = x + (sx + 0.5) / SS, fy = y + (sy + 0.5) / SS;
        const inside = !circle || (fx - size / 2) ** 2 + (fy - size / 2) ** 2 <= (size / 2) ** 2;
        if (!inside) continue;
        inShape++;
        if (RECTS.some(([rx, ry, rw, rh]) => fx >= o + rx * u && fx < o + (rx + rw) * u && fy >= o + ry * u && fy < o + (ry + rh) * u)) white++;
      }
      const i = (y * size + x) * 4, n = SS * SS;
      if (background) {
        const w = inShape ? white / inShape : 0;
        for (let c = 0; c < 3; c++) px[i + c] = Math.round(BLUE[c] + (255 - BLUE[c]) * w);
        px[i + 3] = Math.round(255 * inShape / n);
      } else {
        px[i] = px[i + 1] = px[i + 2] = 255;
        px[i + 3] = Math.round(255 * white / n);
      }
    }
  }
  return px;
}
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, opts) {
  const raw = render(size, opts);
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) raw.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function writeResources() {
  const res = path.join(ANDROID, 'app', 'src', 'main', 'res');
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const dir = path.join(res, `mipmap-${d}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ic_launcher.png'), png(Math.round(48 * k)));
    fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), png(Math.round(48 * k), { circle: true }));
    // adaptive icon: 108 dp canvas, the mark inside the 66 dp safe zone
    fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), png(Math.round(108 * k), { background: false, scale: 0.62 }));
  }
  fs.writeFileSync(path.join(res, 'values', 'ic_launcher_background.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1F3BE6</color>\n</resources>\n');
  // the name under the icon: 研究索引 on a Chinese phone
  for (const [dir, name] of [['values-zh', '研究索引'], ['values-zh-rCN', '研究索引']]) {
    fs.mkdirSync(path.join(res, dir), { recursive: true });
    fs.writeFileSync(path.join(res, dir, 'strings.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name">${name}</string>\n    <string name="title_activity_main">${name}</string>\n</resources>\n`);
  }
  // start-up screen: plain paper colour with the mark (instead of Capacitor's own splash)
  fs.writeFileSync(path.join(res, 'drawable', 'ri_splash.xml'), `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item><color android:color="#F6F5F1"/></item>
    <item android:width="56dp" android:height="56dp" android:gravity="center" android:drawable="@mipmap/ic_launcher"/>
</layer-list>
`);
  const styles = path.join(res, 'values', 'styles.xml');
  let s = fs.readFileSync(styles, 'utf8');
  s = s.replace(/<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">[\s\S]*?<\/style>/, `<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/ri_splash</item>
        <item name="windowSplashScreenBackground">#F6F5F1</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>`);
  // the window behind the page (once: this runs on every build)
  s = s.replace(/\n\s*<item name="android:windowBackground">@color\/ri_paper<\/item>/g, '');
  s = s.replace('<item name="android:background">@null</item>', '<item name="android:background">@null</item>\n        <item name="android:windowBackground">@color/ri_paper</item>');
  fs.writeFileSync(styles, s);
  fs.writeFileSync(path.join(res, 'values', 'ri_colors.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ri_paper">#F6F5F1</color>\n</resources>\n');
  // version shown in Android's app info
  const gradle = path.join(ANDROID, 'app', 'build.gradle');
  const [a, b, c] = VERSION.split('.').map(Number);
  fs.writeFileSync(gradle, fs.readFileSync(gradle, 'utf8')
    .replace(/versionCode \d+/, `versionCode ${a * 10000 + b * 100 + c}`)
    .replace(/versionName "[^"]*"/, `versionName "${VERSION}"`));
}

// ---------- signing key (made once, kept in mobile/keystore) ----------
function keystore(jdk) {
  const dir = path.join(MOBILE, 'keystore');
  const file = path.join(dir, 'release.jks');
  const props = path.join(dir, 'keystore.json');
  if (fs.existsSync(file) && fs.existsSync(props)) return { file, ...JSON.parse(fs.readFileSync(props, 'utf8')) };
  fs.mkdirSync(dir, { recursive: true });
  const password = crypto.randomBytes(18).toString('base64url');
  const res = spawnSync(path.join(jdk, 'bin', 'keytool.exe'), ['-genkeypair', '-keystore', file, '-storetype', 'PKCS12', '-alias', 'research-index',
    '-keyalg', 'RSA', '-keysize', '3072', '-validity', '18250', '-storepass', password, '-keypass', password,
    '-dname', 'CN=Research Index, O=Research Index'], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error('keytool failed');
  const info = { alias: 'research-index', password };
  fs.writeFileSync(props, JSON.stringify(info, null, 2));
  fs.writeFileSync(path.join(dir, 'README.txt'), 'Signing key for the Research Index Android app. Keep both files: an update installs over the app only when it is signed with this key. Do not share them.\n');
  return { file, ...info };
}

// ---------- Gradle with everything on D: ----------
function gradleHome() {
  const home = path.join(CACHE, 'gradle');
  // reuse the Gradle 8.14.3 download already on this PC instead of fetching it again
  const dists = path.join(home, 'wrapper', 'dists', 'gradle-8.14.3-all');
  const userDists = path.join(os.homedir(), '.gradle', 'wrapper', 'dists', 'gradle-8.14.3-all');
  if (!fs.existsSync(dists) && fs.existsSync(userDists)) {
    log('Copying the Gradle 8.14.3 distribution already on this PC');
    fs.cpSync(userDists, dists, { recursive: true });
  }
  return home;
}

function main() {
  const jdk = findJdk();
  const sdk = process.env.ANDROID_HOME || 'D:/AndroidSDK';
  if (!fs.existsSync(path.join(sdk, 'platforms'))) throw new Error(`Android SDK not found at ${sdk} (set ANDROID_HOME)`);
  fs.writeFileSync(path.join(ANDROID, 'local.properties'), `sdk.dir=${sdk.replace(/\\/g, '/')}\n`);
  const proxy = windowsProxy();
  const env = {
    ...process.env,
    JAVA_HOME: jdk,
    ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk,
    // Android's own settings folder: yours if ANDROID_SDK_HOME is set (the build refuses two different ones)
    ...(process.env.ANDROID_SDK_HOME || process.env.ANDROID_USER_HOME ? {} : { ANDROID_USER_HOME: path.join(CACHE, 'android-user') }),
    GRADLE_USER_HOME: gradleHome(),
    ...(fs.existsSync(path.join(os.homedir(), '.gradle', 'caches', 'modules-2')) ? { GRADLE_RO_DEP_CACHE: path.join(os.homedir(), '.gradle', 'caches') } : {}),
  };
  if (proxy) {
    const u = new URL(proxy);
    env.GRADLE_OPTS = `${process.env.GRADLE_OPTS || ''} -Dhttp.proxyHost=${u.hostname} -Dhttp.proxyPort=${u.port} -Dhttps.proxyHost=${u.hostname} -Dhttps.proxyPort=${u.port}`.trim();
    env.HTTPS_PROXY = env.HTTP_PROXY = proxy;
  }
  console.log(`JDK ${jdk}\nSDK ${sdk}\nGradle home ${env.GRADLE_USER_HOME}${proxy ? `\nproxy ${proxy}` : ''}`);

  log('Building the app pages (mobile/www)');
  const buildArgs = [path.join(ROOT, 'build.mjs'), '--mobile', ...process.argv.slice(2).filter((a) => a === '--no-seed' || a.startsWith('--seed='))];
  if (spawnSync(process.execPath, buildArgs, { cwd: ROOT, stdio: 'inherit' }).status !== 0) process.exit(1);

  log('Copying them into the Android project');
  const cap = spawnSync(process.execPath, [path.join(MOBILE, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android'], { cwd: MOBILE, stdio: 'inherit', env });
  if (cap.status !== 0) process.exit(cap.status || 1);
  writeResources();

  log('Signing key');
  const ks = keystore(jdk);

  log('Gradle: assembleRelease');
  const args = ['assembleRelease', '--console=plain',
    `-Pandroid.injected.signing.store.file=${ks.file}`, `-Pandroid.injected.signing.store.password=${ks.password}`,
    `-Pandroid.injected.signing.key.alias=${ks.alias}`, `-Pandroid.injected.signing.key.password=${ks.password}`];
  const bat = path.join(ANDROID, 'gradlew.bat');
  const res = spawnSync('cmd.exe', ['/d', '/s', '/c', `""${bat}" ${args.map((a) => `"${a}"`).join(' ')}"`], { cwd: ANDROID, stdio: 'inherit', env, windowsVerbatimArguments: true });
  if (res.status !== 0) process.exit(res.status || 1);

  const apk = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  const out = path.join(ROOT, 'release', `Research-Index-${VERSION}.apk`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(apk, out);
  console.log(`\nDone: ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
}

try { main(); } catch (e) { console.error(`\nAndroid build failed: ${e.message}`); process.exit(1); }
