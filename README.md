# Research Index · 研究索引

A reader for new AI papers, for Windows and Android: one paper at a time (swipe up for the next) or a
waterfall grid, recommendations that follow what you read, Chinese translations, and AI takes on a paper.

一个读 AI 新论文的应用（Windows 与 Android）：一次看一篇（上滑看下一篇）或瀑布流浏览，推荐会跟着你读过的内容走，
支持中文翻译和 AI 解读。

## Download · 下载

Get the latest version from [Releases](https://github.com/1661169091kiwi/research-index/releases/latest):

- **Windows**: `Research-Index-Setup-<version>.exe`, an installer (you choose the folder)
- **Android**: `Research-Index-<version>.apk`, which installs over an earlier version and keeps your data

The app checks for a new version when it opens (you can turn that off, skip a version, or check yourself
under About).

从 [Releases](https://github.com/1661169091kiwi/research-index/releases/latest) 下载最新版本：Windows 用安装包，
Android 用 APK（可直接覆盖安装，保留数据）。应用打开时会检查更新，可以在“关于”里关闭、跳过某个版本或手动检查。

## What it does · 功能

- Papers from arXiv and Hugging Face, sorted into research directions; Latest, Trending, For you, and a
  Recommended feed that deals the next cards from what held your attention
- One paper at a time (swipe or ↑ ↓), or the grid; Saved papers in boards
- Chinese titles and abstracts (DeepSeek), AI takes and questions about a paper (DeepSeek or Claude)
- Share a paper as an image: title, authors, abstract, a QR code to the paper and to this app
- Two looks: **Glass** (the default) and **Classic**; Glass follows the system's light or dark mode

API keys stay on your device: encrypted with Windows' data protection on the desktop, with the Android
Keystore on the phone, and sent only to the provider they are for.

API 密钥只保存在你的设备上（桌面端用 Windows 数据保护加密，手机端用 Android Keystore），只发送给对应的服务商。

## Build from source · 从源码构建

```
npm install
npm start                      # run the desktop app
npm run installer              # the Windows installer, in release/
node scripts/android.mjs       # the Android app (needs the Android SDK and JDK 21), in release/
```

The Android build signs with a key it makes on first run in `mobile/keystore/` (not in the repository).

## Credits · 致谢

- The Glass look and its motion follow the design of [FlClash](https://github.com/chen08209/FlClash) and its
  prism_ui kit (re-made for the web here; no code is copied)
- [KaTeX](https://katex.org) (MIT) for formulas, [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
  (MIT) for QR codes, [Inter](https://rsms.me/inter/) and Noto Sans SC (SIL OFL) for type
