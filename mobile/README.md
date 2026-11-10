# Research Index for Android and iPhone

The phone version of the paper feed: one paper at a time (swipe up for the next), or the grid you know
from the desktop app. The feed code itself is shared with the desktop app (`../app/feed/*.mjs`,
`../src/feed.js`, `../src/swipe.js`); this folder only adds the phone shell.

Nothing of yours is built into the app: your surveys stay on your computer, and the phone starts with no
likes, saves, interests, notes or AI settings of yours. Add interests and an API key on the phone itself.

## Build the app

```
cd portal
node scripts/android.mjs
```

This writes `portal/release/Research-Index-<version>.apk`. It needs the Android SDK (`D:\AndroidSDK`)
and a JDK 21+ (it finds `portal\.cache\jdk`); every download and cache stays on D:.

So the feed is not empty on first start, the app carries a snapshot of the public paper data the desktop
app has fetched (titles, abstracts, Chinese titles; from `D:\Research Index Data\feed`). `--no-seed`
leaves that out too.

## Install it on the phone

Copy the `.apk` to the phone (USB, WeChat 文件传输助手, …), open it, and allow installing from that app
when Android asks. Updates install over the old version because they are signed with the same key
(`keystore/` — keep it).

## The iPhone app

Apple's tools only run on a Mac, so the iPhone app is built by GitHub Actions on a Mac machine:

1. On GitHub: **Actions → iOS build → Run workflow** (it also runs by itself for every published release and
   attaches the `.ipa` to it).
2. When the run is done, download `research-index-ios` from its **Artifacts** (or the `.ipa` from the
   release) and unzip it: `Research-Index-<version>.ipa`.

On a Mac, `node scripts/ios.mjs` builds the same `.ipa` locally. On Windows the script only prepares the
Xcode project (`ios/`).

### Install it on an iPhone (no App Store)

The `.ipa` is unsigned; the tool that installs it signs it with your own Apple ID.

- **Sideloadly** (Windows or Mac, free): install iTunes (from apple.com, not the Microsoft Store), connect the
  iPhone by USB and tap *Trust*, open Sideloadly, drop the `.ipa` in, enter your Apple ID, *Start*.
  On the iPhone: *Settings → General → VPN & Device Management* → trust your Apple ID, and on iOS 16+
  turn on *Settings → Privacy & Security → Developer Mode* (it restarts).
- **AltStore** works the same way and can re-sign over Wi-Fi.

With a free Apple ID the app runs for 7 days, then needs installing again (Sideloadly: same steps; your
data stays). A paid Apple Developer account ($99 a year) makes it last a year and allows TestFlight.
Updates: the app says when a new version is out and opens the release page; install the new `.ipa` the
same way.

On the iPhone the glass is plain frosted blur: the bending of the backdrop needs Chromium, and iOS apps
use Safari's engine. The DeepSeek key is kept in the iOS Keychain.

## Files

- `src/boot.mjs`: starts the shared feed service inside the page and provides `window.portal.feed`
- `src/native.mjs`: storage (app-private files), network (native requests, no CORS) and API keys
- `android/app/src/main/java/io/researchindex/app/RiNative.java`: native requests; the DeepSeek key is
  stored encrypted with the Android Keystore and added to requests natively, so the page never holds it
- `ios/App/App/RiNative.swift`: the same for the iPhone (the key in the Keychain), plus the share sheet,
  saving to Photos and opening links; `../scripts/ios.mjs` registers it in the Xcode project
- `../.github/workflows/ios.yml`: builds the `.ipa` on a Mac runner
- `../scripts/mobile-preview.mjs`: opens the phone pages in a phone-sized window on the PC for testing
