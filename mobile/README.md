# Research Index for Android

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

## Files

- `src/boot.mjs`: starts the shared feed service inside the page and provides `window.portal.feed`
- `src/native.mjs`: storage (app-private files), network (native requests, no CORS) and API keys
- `android/app/src/main/java/io/researchindex/app/RiNative.java`: native requests; the DeepSeek key is
  stored encrypted with the Android Keystore and added to requests natively, so the page never holds it
- `../scripts/mobile-preview.mjs`: opens the phone pages in a phone-sized window on the PC for testing
