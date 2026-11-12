// Builds the iPhone app. On any computer it prepares the Xcode project (mobile/ios): the app pages, the RiNative
// plugin registered, the icon and launch screen, the version, the Info.plist entries. On a Mac (or in the
// GitHub Actions workflow .github/workflows/ios.yml) it then builds an unsigned
// release/Research-Index-<version>.ipa, which Sideloadly / AltStore sign with your Apple ID when installing.
//   node scripts/ios.mjs              prepare (and build, on a Mac)
//   node scripts/ios.mjs --no-seed    leave the desktop papers out of the app
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = path.join(ROOT, 'mobile');
const APP = path.join(MOBILE, 'ios', 'App');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const BUILD_NO = VERSION.split('.').reduce((n, x) => n * 100 + (parseInt(x, 10) || 0), 0); // 1.8.4 → 10804
const log = (s) => console.log(`\n== ${s}`);
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts }); if (r.status !== 0) throw new Error(`${path.basename(cmd)} failed (${r.status})`); };

// ---------- images: the Research Index mark (as in make-icon.mjs) ----------
const BLUE = [0x1f, 0x3b, 0xe6], PAPER = [0xee, 0xf0, 0xf4];
const RECTS = [[14, 14, 10, 36], [30, 14, 20, 10], [40, 40, 10, 10]];
// an opaque square: `bg` everywhere, the blue mark of size `mark` in the middle
function image(size, { mark = size, bg = BLUE } = {}) {
  const px = Buffer.alloc(size * size * 3);
  const u = mark / 64, o = (size - mark) / 2, SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      const inMark = x >= o - 1 && x < o + mark + 1 && y >= o - 1 && y < o + mark + 1;
      if (!inMark) { px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]; continue; }
      let blue = 0, white = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const fx = x + (sx + 0.5) / SS, fy = y + (sy + 0.5) / SS;
        if (fx < o || fx >= o + mark || fy < o || fy >= o + mark) continue;
        if (RECTS.some(([rx, ry, rw, rh]) => fx >= o + rx * u && fx < o + (rx + rw) * u && fy >= o + ry * u && fy < o + (ry + rh) * u)) white++; else blue++;
      }
      const n = SS * SS, rest = n - blue - white;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round((BLUE[c] * blue + 255 * white + bg[c] * rest) / n);
    }
  }
  return png(size, px);
}
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgb) {
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) rgb.copy(rows, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB, no alpha (App icons must be opaque)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- the Xcode project ----------
function edit(file, fn) {
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) fs.writeFileSync(file, after);
}
function plistSet(s, key, valueXml) {
  const re = new RegExp(`(<key>${key}</key>\\s*)(<string>[^<]*</string>|<array>[\\s\\S]*?</array>|<true/>|<false/>)`);
  if (re.test(s)) return s.replace(re, `$1${valueXml}`);
  return s.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${key}</key>\n\t${valueXml}\n</dict>\n</plist>\n`);
}
function prepareProject() {
  const src = path.join(APP, 'App');
  // RiNative.swift belongs to the App target (Capacitor's template lists every source file in the project)
  edit(path.join(APP, 'App.xcodeproj', 'project.pbxproj'), (s) => {
    if (s.includes('RiNative.swift')) return s;
    const FILE = 'A1C0FFEE0000000000000001', BUILD = 'A1C0FFEE0000000000000002';
    return s
      .replace('/* Begin PBXBuildFile section */\n', `/* Begin PBXBuildFile section */\n\t\t${BUILD} /* RiNative.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${FILE} /* RiNative.swift */; };\n`)
      .replace('/* Begin PBXFileReference section */\n', `/* Begin PBXFileReference section */\n\t\t${FILE} /* RiNative.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = RiNative.swift; sourceTree = "<group>"; };\n`)
      .replace(/(\t+)(504EC3071FED79650016851F \/\* AppDelegate\.swift \*\/,\n)/, `$1$2$1${FILE} /* RiNative.swift */,\n`)
      .replace(/(\t+)(504EC3081FED79650016851F \/\* AppDelegate\.swift in Sources \*\/,\n)/, `$1$2$1${BUILD} /* RiNative.swift in Sources */,\n`);
  });
  edit(path.join(APP, 'App.xcodeproj', 'project.pbxproj'), (s) => s
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${VERSION};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${BUILD_NO};`));
  // the web view with RiNative registered
  edit(path.join(src, 'SceneDelegate.swift'), (s) => s.replace('rootViewController = CAPBridgeViewController()', 'rootViewController = RiBridgeViewController()'));
  edit(path.join(src, 'Base.lproj', 'Main.storyboard'), (s) => s.replace('customClass="CAPBridgeViewController" customModule="Capacitor"', 'customClass="RiBridgeViewController" customModule="App" customModuleProvider="target"'));
  edit(path.join(src, 'Info.plist'), (s) => {
    s = plistSet(s, 'NSPhotoLibraryAddUsageDescription', '<string>Saves a paper\'s share image to your photos.</string>');
    s = plistSet(s, 'UIRequiredDeviceCapabilities', '<array>\n\t\t<string>arm64</string>\n\t</array>');
    s = plistSet(s, 'ITSAppUsesNonExemptEncryption', '<false/>');
    s = plistSet(s, 'UISupportedInterfaceOrientations', '<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>');
    s = plistSet(s, 'UIStatusBarStyle', '<string>UIStatusBarStyleDefault</string>');
    return s;
  });
  // icon and launch screen: the mark on blue, and on the paper colour
  fs.writeFileSync(path.join(src, 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png'), image(1024));
  const splash = image(1366, { mark: 150, bg: PAPER });
  for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) fs.writeFileSync(path.join(src, 'Assets.xcassets', 'Splash.imageset', f), splash);
}

// ---------- an unsigned .ipa (a Mac only) ----------
function buildIpa() {
  const out = path.join(APP, 'build');
  fs.rmSync(out, { recursive: true, force: true });
  run('xcodebuild', ['-project', path.join(APP, 'App.xcodeproj'), '-scheme', 'App', '-configuration', 'Release',
    '-destination', 'generic/platform=iOS', '-archivePath', path.join(out, 'App.xcarchive'),
    'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', 'archive']);
  const payload = path.join(out, 'Payload');
  fs.mkdirSync(payload, { recursive: true });
  run('cp', ['-R', path.join(out, 'App.xcarchive', 'Products', 'Applications', 'App.app'), payload]);
  const ipa = path.join(ROOT, 'release', `Research-Index-${VERSION}.ipa`);
  fs.mkdirSync(path.dirname(ipa), { recursive: true });
  fs.rmSync(ipa, { force: true });
  run('zip', ['-qry', ipa, 'Payload'], { cwd: out });
  console.log(`\nDone: ${ipa} (${(fs.statSync(ipa).size / 1048576).toFixed(1)} MB)`);
}

function main() {
  log('Building the app pages (mobile/www)');
  const buildArgs = [path.join(ROOT, 'build.mjs'), '--mobile', ...process.argv.slice(2).filter((a) => a === '--no-seed' || a.startsWith('--seed='))];
  run(process.execPath, buildArgs, { cwd: ROOT });
  log('Copying them into the Xcode project');
  run(process.execPath, [path.join(MOBILE, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'ios'], { cwd: MOBILE });
  prepareProject();
  if (process.platform !== 'darwin') {
    console.log('\nThe Xcode project is ready (mobile/ios). Building the .ipa needs a Mac: run this script there, or the GitHub Actions workflow "iOS build".');
    return;
  }
  log('xcodebuild archive (unsigned)');
  buildIpa();
}
try { main(); } catch (e) { console.error(`\niOS build failed: ${e.message}`); process.exit(1); }
