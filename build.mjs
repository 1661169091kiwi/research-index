// Builds the Research index (English + 中文) from the .md files in the parent folder.
//
//   node build.mjs          build into ./dist
//   node build.mjs --open   build, then open it in an Edge app window (no Electron needed)
//   node build.mjs --mobile build the phone app's pages into ./mobile/www (see mobile/README.md)
//
// Chinese versions live next to the original as  <name>.zh.md.
// A survey written only in Chinese can be  <name>.zh.md  (or a plain .md in Chinese).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { Marked } from 'marked';
import katex from 'katex';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const DOCS_DIR = path.resolve(ROOT, '..');
export const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'src');
const LANGS = ['en', 'zh'];
// Where the surveys are read from and where the site is written; set by build().
export const REPO = '1661169091kiwi/research-index';
let CTX = { docsDir: DOCS_DIR, outDir: DIST, mobile: false, version: '' };

// ---------- interface text ----------
const I18N = {
  en: {
    htmlLang: 'en',
    siteTitle: 'Research index',
    tabSurveys: 'Surveys',
    tabPapers: 'Papers',
    styleLabel: 'Style', styleGlass: 'Glass', styleClassic: 'Classic', langName: 'Language',
    surveys: 'Surveys',
    surveysOnFile: 'Surveys on file', readLatest: 'Read it',
    noSurveys: 'No surveys here yet. Put Markdown (.md) files in the survey folder, or choose another folder below.',
    since: (d) => `Since ${d}`,
    latest: 'Latest',
    index: 'Index',
    searchAll: 'Search all surveys',
    min: 'min',
    minRead: 'min read',
    sections: (n) => `${n} sections`,
    contents: 'Contents',
    findInPage: 'Find in this survey',
    allSurveys: 'All surveys',
    previous: 'Previous',
    next: 'Next',
    backTo: 'Back to',
    theIndex: 'The index',
    builtFrom: (n) => `Built from ${n} Markdown file${n === 1 ? '' : 's'}`,
    lastBuilt: 'Last built',
    addHint: 'Add a .md file to the folder and the app updates by itself',
    fallbackNote: 'No English version yet — showing the Chinese original.',
    openFile: 'Open .md',
    reveal: 'Show in folder',
    openFolder: 'Open survey folder',
    changeFolder: 'Change folder…',
    status: { done: 'Done', active: 'Active', draft: 'Draft', paused: 'Paused', archived: 'Archived' },
    date: (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    short: (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    client: {
      matches: '<b>{n}</b> matches for “{q}”', match: '<b>1</b> match for “{q}”', topN: ' · showing the top {n}',
      noMatches: 'No matches. Try fewer or shorter words.', findNone: 'No results', updated: 'Updated just now',
      readPct: '{p}% read',
      about: 'Settings and updates', more: 'More', langName: 'Language', styleLabel: 'Style', version: 'Version {v}', available: '{v} available', checkUpdates: 'Check for updates', checking: 'Checking…',
      upToDate: 'Up to date', checkFailed: 'Could not reach GitHub',
      updateTitle: 'Version {v} is available', updateDownload: 'Download', updateInstall: 'Download and install', updateSkip: 'Skip this version',
      updateLater: 'Later', updateNotes: 'What is new', downloading: 'Downloading… {p}%', updateOpening: 'Starting the installer…',
      autoCheck: 'Check when the app opens', projectPage: 'Project page on GitHub', skipped: 'Skipped {v}',
    },
  },
  zh: {
    htmlLang: 'zh-CN',
    siteTitle: '研究索引',
    tabSurveys: '调研',
    tabPapers: '论文',
    styleLabel: '风格', styleGlass: '玻璃', styleClassic: '经典', langName: '语言',
    surveys: '调研',
    surveysOnFile: '已收录调研', readLatest: '打开阅读',
    noSurveys: '这里还没有调研文档。把 Markdown（.md）文件放进调研文件夹，或在下方换一个文件夹。',
    since: (d) => `始于 ${d}`,
    latest: '最新',
    index: '索引',
    searchAll: '搜索全部调研',
    min: '分钟',
    minRead: '分钟阅读',
    sections: (n) => `${n} 个章节`,
    contents: '目录',
    findInPage: '在本文中查找',
    allSurveys: '全部调研',
    previous: '上一篇',
    next: '下一篇',
    backTo: '返回',
    theIndex: '索引首页',
    builtFrom: (n) => `由 ${n} 个 Markdown 文件生成`,
    lastBuilt: '最近构建',
    addHint: '把 .md 文件放进文件夹，应用会自动更新',
    fallbackNote: '本文暂无中文版本，以下为英文原文。',
    openFile: '打开 .md',
    reveal: '在文件夹中显示',
    openFolder: '打开调研文件夹',
    changeFolder: '更换文件夹…',
    status: { done: '已完成', active: '进行中', draft: '草稿', paused: '暂停', archived: '归档' },
    date: (d) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
    short: (d) => `${d.getMonth() + 1}月${d.getDate()}日`,
    client: {
      matches: '“{q}”共 <b>{n}</b> 条结果', match: '“{q}”共 <b>1</b> 条结果', topN: '，显示前 {n} 条',
      noMatches: '没有匹配的结果，试试更少或更短的关键词。', findNone: '无结果', updated: '内容已更新',
      readPct: '已读 {p}%',
      about: '设置与更新', more: '更多', langName: '语言', styleLabel: '风格', version: '版本 {v}', available: '有新版本 {v}', checkUpdates: '检查更新', checking: '正在检查…',
      upToDate: '已是最新', checkFailed: '无法连接 GitHub',
      updateTitle: '发现新版本 {v}', updateDownload: '下载', updateInstall: '下载并安装', updateSkip: '跳过此版本',
      updateLater: '以后再说', updateNotes: '更新内容', downloading: '正在下载… {p}%', updateOpening: '正在启动安装程序…',
      autoCheck: '打开应用时检查更新', projectPage: 'GitHub 项目主页', skipped: '已跳过 {v}',
    },
  },
};

// ---------- paper feed text ----------
const FEED = {
  en: {
    title: 'Papers', searchPapers: 'Search papers', interests: 'Interests', refresh: 'Refresh',
    mode_foryou: 'For you', mode_recommended: 'For you', mode_latest: 'Latest', mode_trending: 'Trending', mode_surveys: 'Surveys', mode_saved: 'Saved', mode_liked: 'Liked', dirAll: 'All directions', dirPick: 'Show papers in',
    mode_venues: 'Top venues', modeTip_venues: 'Accepted at a top conference or journal (NeurIPS, ICML, ICLR, CVPR, ACL, EMNLP, Nature…), as the authors say on arXiv; workshops not included',
    all: 'All', survey: 'Survey',
    count: '{n} papers', updated: 'updated {rel}', never: 'not fetched yet', justNow: 'just now',
    minAgo: '{n} min ago', hAgo: '{n} h ago', dAgo: '{n} d ago',
    fetching: 'Fetching {label} · {done}/{total}',
    newBelow: '{n} new, mixed in below', refreshTip: 'A new batch of papers (R)', justIn: 'Just in', backTop: 'Back to top',
    coldFor: 'Tell this feed what you work on: add a few interests, or like and save papers as you go.', coldForBtn: 'Add interests',
    firstRunTitle: 'Fetching the latest papers for the first time.',
    firstRun: 'Cards appear as each direction arrives; the full first pass takes about a minute and a half.',
    emptyFeed: 'No papers match this view. Try another direction or clear the search.',
    emptySaved: 'Save papers with the bookmark on any card and they collect here.',
    emptyLiked: 'Papers you like show up here.',
    end: 'You have reached the end of this view.',
    because: 'Because you saved “{title}”', trending: 'Trending on Hugging Face', explore: 'Something different',
    becauseRead: 'Because you read “{title}”',
    view_swipe: 'One at a time', viewTip: 'One paper at a time, full screen (V)', view_grid: 'Grid',
    swMore: 'More', swHint: 'Swipe up for the next paper', swHintDesk: 'Scroll, or press ↓, for the next paper',
    swEnd: 'That is everything in this view for now.', swNewBatch: 'New batch', swOpen: 'Open',
    swHidden: 'Got it: fewer papers like this.', swUndo: 'Undo', swLoading: 'Picking papers…', swAi: 'AI take', swShare: 'Share', swSearch: 'Search', swSearchCancel: 'Cancel', swBack: 'Back to the list', swNoResults: 'No papers match. Try fewer or other words.', shelfEmptySaved: 'Papers you save show up here.', shelfEmptyLiked: 'Papers you like show up here.',
    swKeys: '↑ ↓ previous / next · Enter open · L like · S save · A AI take · X not interested · V grid',
    swSurveys: 'Surveys', swLiked: 'Liked', swSaved: 'Saved',
    directions: 'Directions',
    share: 'Share as image', shareTitle: 'Share this paper', shareSave: 'Save image', shareCopy: 'Copy image', shareSend: 'Share…',
    shareSaved: 'Saved to {where}', shareCopied: 'Image copied', shareFailed: 'Could not make the image',
    shareScan: 'Scan to read the paper', shareGet: 'Get Research Index', shareApp: 'Research Index · papers, one at a time',
    swPrev: 'Previous paper', swNext: 'Next paper', swActions: 'This paper',
    modeTip_foryou: 'Your interests and saved papers. A new batch on each refresh.',
    modeTip_recommended: 'Learns from your interests, likes and saves, and from what you read right now: the papers ahead change to match. A new batch on each refresh.',
    basis: 'Following what you just read', basisCold: 'Open any paper that catches your eye. This tab follows what you read and changes as you go.',
    etal: '{name} et al.', moreAuthors: '+{n} more',
    like: 'Like', liked: 'Liked', save: 'Save', savedTo: 'Saved', hide: 'Not interested', close: 'Close',
    abstract: 'Abstract', notes: 'Your notes', noteSaved: 'Saved',
    notesPh: 'Ideas, doubts, and how it connects to your project…',
    similar: 'More like this', code: 'Code', upvotes: '{n} upvotes on Hugging Face',
    keys: '← → next / previous · L like · S save · X not interested · N notes · Esc close',
    boardsAll: 'All saved', boardDefault: 'Saved', boardLiked: 'Liked', newBoard: '+ New board', boardName: 'Board name',
    rename: 'Rename', deleteBoard: 'Delete board', deleteConfirm: 'Delete “{name}”? Papers stay in your other boards.',
    tuneTitle: 'What are you working on?',
    tuneHint: 'Comma-separated topics. “For you” ranks papers by these, plus what you like, save and open.',
    tuneSave: 'Update feed',
    webOnly: 'The paper feed runs inside the Research Index desktop app. Open it there to browse, like and save papers.',
    translate: 'Translate to 中文', trNeedsKey: 'translation needs an API key (AI settings)', trAbstracting: 'Translating…',
    showOriginal: 'Show original', showTranslation: 'Show Chinese', trFailed: 'Translation failed: {message}',
    qN: 'Novelty', qR: 'Rigour', qS: 'Significance', qC: 'Clarity',
    q: 'Quality', qTier3: 'Excellent', qTier2: 'Good', qTier1: 'Fair', qTier0: 'Weak',
    qTip: 'Quality {s}/100 · {tier}, from public evidence (50: none either way)', qCounted: 'Counted in the score', qRef: 'For reference',
    qTitle: 'Quality', qOutOf: 'out of 100', qVenue: 'Accepted at {v}', qInst: 'From {names}', qH: 'Authors’ h-index up to {h}', qUp: '{n} upvotes on Hugging Face',
    qStars: '{n} GitHub stars', qCites: 'Cited {n} times', qCode: 'Code released', qAi: 'AI review of the abstract', qAiParts: 'novelty {n} · rigour {r} · significance {s} · clarity {c}',
    qNote: 'A rough guide from public evidence, not a verdict: 50 means no evidence either way. Acceptance at a top venue, citations, released code and the AI review move it; in a backtest these predicted top-venue acceptance better than upvotes, the authors’ record or the institution, which are shown for reference. Citations and authors’ records come from OpenAlex about a week after a paper appears.',
    qNone: 'Little evidence so far: the score will firm up as citations, upvotes and reviews come in.', qOnly: 'High quality only', qOnlyHint: 'Scoring 70 or more',
    rateOn: 'AI rating', rateHint: 'Rates the papers you see from their abstracts (about ¥0.001 each), once each, within a daily budget; older ones only off-peak, at half price.', rateCap: 'Daily budget', rateSpent: 'Today {v}',
    usageMenu: 'AI usage', usageTitle: 'AI usage', usageBalance: 'DeepSeek balance', usageAvailable: 'Available', usageUnavailable: 'Too low to call the API',
    usageToppedUp: 'Topped up {v}', usageGranted: 'Granted {v}', usageUpdated: 'Updated {rel}', usageRefresh: 'Refresh balance', usageChecking: 'Checking…',
    usageNoKey: 'Add a DeepSeek key in AI settings to see its balance here.', usageAddKey: 'Open AI settings', usageBalanceFailed: 'Could not read the balance ({why}).',
    usageApp: 'This app · {range}', usageToday: 'Today', usageCache: 'Cache hits', usageCacheHint: 'Repeated parts of a request (the paper, earlier questions) are billed at about 2% of the price.',
    usageDaily: 'Spent per day', usageTable: 'Table', usageChart: 'Chart', usageDate: 'Date', usageTotal: 'Total',
    usageKind_take: 'AI takes', usageKind_chat: 'Questions', usageKind_translate: 'Translation', usageKind_rate: 'Rating',
    usageTokens: 'Tokens', usageIn: 'Input', usageInCached: '{n} cached', usageOut: 'Output', usageCalls: '{n} calls',
    usageOutside: 'Used elsewhere with this key', usageOutsideNote: 'An estimate: how far the balance fell between readings, minus what this app spent. A reading is taken each time this panel opens.',
    usageOutsideWait: 'Needs two balance readings: open this panel again later.', usageEmpty: 'No AI calls from this app in this period.',
    usagePeakNow: 'Peak hours now', usageOffPeakNow: 'Off-peak now · half price',
    usagePriceNote: 'Costs are worked out from the tokens each call used and DeepSeek’s published prices ({model}, per 1M tokens: {hit} cache hit · {miss} input · {out} output; half price off-peak). The balance is DeepSeek’s own figure. Calls that were stopped part-way are not counted.',
    usageRange: '{n} days', usageOpen: 'Usage & balance',
    ai: 'AI', aiTitle: 'AI settings', aiProvider: 'Model provider',
    hideAsk: 'Not interested in this paper?', hideAskText: 'You will see fewer papers like it. You can undo it on the card.', cancel: 'Cancel',
    aiKeyFor: '{provider} API key', aiKeyPh: 'sk-…', aiKeySave: 'Save key', aiKeyRemove: 'Remove key',
    aiKeyHint_deepseek: 'Stored encrypted on this computer and sent only to the DeepSeek API. Create a key at platform.deepseek.com.',
    aiKeyHint_claude: 'Stored encrypted on this computer and sent only to api.anthropic.com. Create a key at console.anthropic.com.',
    aiKeyHint_deepseek_mobile: 'Stored encrypted on this phone (Android Keystore or iOS Keychain) and added only to requests to the DeepSeek API. Create a key at platform.deepseek.com.',
    aiKeySaved: 'Key saved ({hint})', aiKeyEnv: 'Using the API key from the environment', aiNoKey: 'No key yet',
    aiBase: 'API URL', aiModel: 'Model',
    aiContext: 'About you and your project', aiContextHint: 'The model uses this to tailor “Ideas for you” to your own work.', aiSave: 'Save',
    aiContextPh: 'For example: your field, your current project, the compute you have. Leave empty for general ideas.',
    takeTitle: 'AI take', quickTake: 'Quick take', deepRead: 'Deep read',
    takeHintQuick: 'From the abstract · fast', takeHintDeep: 'Reads the whole paper · slower',
    takeReading: 'Reading…', takeFetching: 'Fetching the full paper…', takeStop: 'Stop', takeRegenerate: 'Regenerate',
    takeToNotes: 'Add ideas to notes', takeAdded: 'Added to notes', ideasFrom: 'Ideas from {model}',
    takeMeta: '{mode} · {tokens} tokens{cost}',
    takeAbstractOnly: 'This paper has no HTML version on arXiv, so the deep read used the abstract only.',
    takeTruncated: 'The answer was cut off before the end.',
    err_nokey: 'Add an API key in the AI settings to get summaries and research ideas for any paper.',
    err_auth: 'The API key was rejected. Check it in the AI settings.', err_permission: 'This key is not allowed to use the model: {message}',
    err_rate: 'Rate limit reached. Try again in a minute.', err_network: 'Could not reach the model API. Check your network or proxy.',
    err_refusal: 'The model declined to summarize this paper.', err_billing: 'Your API account is out of credit.',
    err_server: 'The model provider had a problem. Try again.', err_bad: 'The request was rejected: {message}',
    err_api: 'API error {message}', err_unknown: 'Something went wrong: {message}', err_stopped: 'Stopped.',
    retry: 'Try again', setupKey: 'Add API key',
    keys2: 'Q quick take · D deep read · A ask',
    askTitle: 'Ask about this paper', askPh: 'Ask anything about this paper…', askPhFollow: 'Ask a follow-up about the paper or the take…',
    askSend: 'Ask', askStop: 'Stop', askClear: 'Clear', askClearConfirm: 'Clear all?', askYou: 'You',
    askFetching: 'Reading the full paper…', askThinking: 'Thinking…', askToNotes: 'Add to notes', askAdded: 'Added', askCopy: 'Copy', askCopied: 'Copied',
    askNote: 'Answers use the full paper when arXiv has an HTML version. Enter to send · Shift+Enter for a new line.',
    askAbstractOnly: 'abstract only', askStopped: 'Stopped before the answer was finished.',
    askSuggest: ['What is the key idea, in plain words?', 'Which result is most convincing, and which is weakest?', 'How could this help my own project?', 'What would it take to reproduce this?'],
    askSuggestFollow: ['Explain the method step by step', 'Turn idea 1 into a concrete experiment plan', 'What are the closest prior works, and how is this different?'],
  },
  zh: {
    title: '论文', searchPapers: '搜索论文', interests: '兴趣', refresh: '刷新',
    mode_foryou: '推荐', mode_recommended: '推荐', mode_latest: '最新', mode_trending: '热门', mode_surveys: '综述', mode_saved: '收藏', mode_liked: '喜欢', dirAll: '全部方向', dirPick: '只看这个方向',
    mode_venues: '顶会顶刊', modeTip_venues: '作者在 arXiv 上注明已被顶级会议或期刊录用（NeurIPS、ICML、ICLR、CVPR、ACL、EMNLP、Nature 等），不含 workshop',
    all: '全部', survey: '综述',
    count: '{n} 篇论文', updated: '{rel}更新', never: '尚未获取', justNow: '刚刚',
    minAgo: '{n} 分钟前', hAgo: '{n} 小时前', dAgo: '{n} 天前',
    fetching: '正在获取 {label} · {done}/{total}',
    newBelow: '新增 {n} 篇，已混入下方', refreshTip: '换一批论文（R）', justIn: '新到', backTop: '回到顶部',
    coldFor: '告诉推荐你在研究什么：添加几个兴趣，或在浏览时点喜欢、收藏。', coldForBtn: '添加兴趣',
    firstRunTitle: '正在首次获取最新论文。',
    firstRun: '每个方向的论文到达后就会显示出来；完整获取一次大约需要一分半钟。',
    emptyFeed: '没有符合条件的论文。换个方向，或清空搜索试试。',
    emptySaved: '点任意卡片上的书签即可收藏，收藏的论文会出现在这里。',
    emptyLiked: '你点过喜欢的论文会出现在这里。',
    end: '这一栏已经到底了。',
    because: '因为你收藏了「{title}」', trending: 'Hugging Face 热门', explore: '换个口味',
    becauseRead: '因为你看过「{title}」',
    view_swipe: '单篇浏览', viewTip: '一次看一篇，全屏浏览（V）', view_grid: '多篇浏览',
    swMore: '更多', swHint: '上滑看下一篇', swHintDesk: '滚动或按 ↓ 看下一篇',
    swEnd: '这一栏暂时看完了。', swNewBatch: '换一批', swOpen: '展开',
    swHidden: '好的，将减少此类推荐。', swUndo: '撤销', swLoading: '正在挑选论文…', swAi: 'AI 解读', swShare: '分享', swSearch: '搜索', swSearchCancel: '取消', swBack: '返回列表', swNoResults: '没有匹配的论文，换几个词试试。', shelfEmptySaved: '收藏的论文会出现在这里。', shelfEmptyLiked: '点过喜欢的论文会出现在这里。',
    swKeys: '↑ ↓ 上一篇 / 下一篇 · Enter 展开 · L 喜欢 · S 收藏 · A AI 解读 · X 不感兴趣 · V 多篇浏览',
    swSurveys: '综述', swLiked: '已喜欢', swSaved: '已收藏',
    directions: '方向',
    share: '分享为图片', shareTitle: '分享这篇论文', shareSave: '保存图片', shareCopy: '复制图片', shareSend: '分享…',
    shareSaved: '已保存到{where}', shareCopied: '图片已复制', shareFailed: '图片生成失败',
    shareScan: '扫码阅读论文', shareGet: '下载 研究索引', shareApp: '研究索引 · 一次读一篇论文',
    swPrev: '上一篇', swNext: '下一篇', swActions: '这篇论文',
    modeTip_foryou: '按你的兴趣和收藏推荐，每次刷新换一批。',
    modeTip_recommended: '结合你的兴趣、喜欢和收藏，也跟着你此刻在看的内容走：后面的论文会随之调整。每次刷新换一批。',
    basis: '正在参考你刚看过的', basisCold: '点开任意感兴趣的论文。这一栏会跟着你看的内容实时调整。',
    etal: '{name} 等', moreAuthors: '等 {n} 人',
    like: '喜欢', liked: '已喜欢', save: '收藏', savedTo: '已收藏', hide: '不感兴趣', close: '关闭',
    abstract: '摘要', notes: '我的笔记', noteSaved: '已保存',
    notesPh: '想法、疑问、和你的项目有什么联系……',
    similar: '相似论文', code: '代码', upvotes: 'Hugging Face {n} 赞',
    keys: '← → 上一篇 / 下一篇 · L 喜欢 · S 收藏 · X 不感兴趣 · N 写笔记 · Esc 关闭',
    boardsAll: '全部收藏', boardDefault: '默认收藏夹', boardLiked: '喜欢', newBoard: '+ 新建收藏夹', boardName: '收藏夹名称',
    rename: '重命名', deleteBoard: '删除收藏夹', deleteConfirm: '删除「{name}」？论文仍会保留在其他收藏夹中。',
    tuneTitle: '你在研究什么？',
    tuneHint: '用逗号分隔主题。“推荐”会结合这些主题，以及你喜欢、收藏和打开过的论文来排序。',
    tuneSave: '更新推荐',
    webOnly: '论文流需要在 Research Index 桌面应用中使用。请在应用里浏览、点赞和收藏论文。',
    translate: '中文翻译', trNeedsKey: '翻译需要在 AI 设置中添加 API 密钥', trAbstracting: '正在翻译…',
    showOriginal: '显示原文', showTranslation: '显示译文', trFailed: '翻译失败：{message}',
    qN: '新颖', qR: '严谨', qS: '重要', qC: '清晰',
    q: '质量', qTier3: '优秀', qTier2: '良好', qTier1: '一般', qTier0: '偏弱',
    qTip: '质量 {s}/100 · {tier}，依据公开信号（50 表示还没有证据）', qCounted: '计入评分', qRef: '供参考',
    qTitle: '质量评分', qOutOf: '满分 100', qVenue: '{v} 已接收', qInst: '来自 {names}', qH: '作者最高 h 指数 {h}', qUp: 'Hugging Face {n} 赞',
    qStars: 'GitHub {n} 星', qCites: '被引用 {n} 次', qCode: '已开源代码', qAi: 'AI 对摘要的评审', qAiParts: '新颖 {n} · 严谨 {r} · 重要 {s} · 清晰 {c}',
    qNote: '依据公开证据的粗略参考，不是对论文的定论：50 表示还没有证据。顶会/顶刊接收、引用、开源代码和 AI 评审会影响评分；回测中它们比点赞数、作者履历或机构更能预测顶会接收，后者仅供参考。引用和作者数据来自 OpenAlex，论文发布约一周后才有。',
    qNone: '目前证据还不多：随着引用、点赞和评审的增加，评分会更可靠。', qOnly: '只看高质量', qOnlyHint: '评分 70 及以上',
    rateOn: 'AI 评分', rateHint: '根据摘要给你看到的论文打分（每篇约 ¥0.001），每篇只评一次，不超过每日预算；较早的论文只在闲时（半价）评。', rateCap: '每日预算', rateSpent: '今天 {v}',
    usageMenu: 'AI 用量', usageTitle: 'AI 用量', usageBalance: 'DeepSeek 余额', usageAvailable: '可用', usageUnavailable: '余额不足，无法调用',
    usageToppedUp: '充值 {v}', usageGranted: '赠送 {v}', usageUpdated: '{rel}更新', usageRefresh: '刷新余额', usageChecking: '正在查询…',
    usageNoKey: '在 AI 设置里添加 DeepSeek 密钥后，这里会显示余额。', usageAddKey: '打开 AI 设置', usageBalanceFailed: '没能读取余额（{why}）。',
    usageApp: '本应用 · {range}', usageToday: '今天', usageCache: '缓存命中', usageCacheHint: '请求里重复的部分（论文、之前的提问）按约 2% 的价格计费。',
    usageDaily: '每日花费', usageTable: '表格', usageChart: '图表', usageDate: '日期', usageTotal: '合计',
    usageKind_take: 'AI 解读', usageKind_chat: '提问', usageKind_translate: '翻译', usageKind_rate: 'AI 评分',
    usageTokens: 'Tokens', usageIn: '输入', usageInCached: '缓存 {n}', usageOut: '输出', usageCalls: '{n} 次调用',
    usageOutside: '这个密钥在别处的花费', usageOutsideNote: '估算值：两次读数之间余额减少的部分，减去本应用的花费。每次打开这个面板都会读一次余额。',
    usageOutsideWait: '需要两次余额读数：过一段时间再打开这个面板。', usageEmpty: '这段时间本应用没有调用 AI。',
    usagePeakNow: '现在是高峰时段', usageOffPeakNow: '现在是闲时 · 半价',
    usagePriceNote: '花费按每次调用实际用的 tokens 和 DeepSeek 公布的价格计算（{model}，每百万 tokens：缓存命中 {hit} · 输入 {miss} · 输出 {out}；闲时半价）。余额是 DeepSeek 返回的数字。中途停止的调用没有计入。',
    usageRange: '{n} 天', usageOpen: '用量与余额',
    ai: 'AI', aiTitle: 'AI 设置', aiProvider: '模型服务',
    hideAsk: '对这篇论文不感兴趣？', hideAskText: '之后会少推荐类似的论文，可在卡片上撤销。', cancel: '取消',
    aiKeyFor: '{provider} API 密钥', aiKeyPh: 'sk-…', aiKeySave: '保存密钥', aiKeyRemove: '移除密钥',
    aiKeyHint_deepseek: '密钥加密保存在本机，只会发送给 DeepSeek API。可在 platform.deepseek.com 创建密钥。',
    aiKeyHint_claude: '密钥加密保存在本机，只会发送给 api.anthropic.com。可在 console.anthropic.com 创建密钥。',
    aiKeyHint_deepseek_mobile: '密钥加密保存在这部手机上（Android 密钥库或 iOS 钥匙串），只会附加到发往 DeepSeek API 的请求中。可在 platform.deepseek.com 创建密钥。',
    aiKeySaved: '已保存密钥（{hint}）', aiKeyEnv: '正在使用环境变量中的密钥', aiNoKey: '尚未设置密钥',
    aiBase: '接口地址', aiModel: '模型',
    aiContext: '关于你和你的项目', aiContextHint: '模型会据此把“给你的研究灵感”贴合到你自己的工作上。', aiSave: '保存',
    aiContextPh: '例如：你的研究方向、正在做的项目、可用的算力。留空则给出通用的研究灵感。',
    takeTitle: 'AI 解读', quickTake: '快速解读', deepRead: '精读全文',
    takeHintQuick: '基于摘要 · 较快', takeHintDeep: '阅读整篇论文 · 较慢',
    takeReading: '阅读中…', takeFetching: '正在获取全文…', takeStop: '停止', takeRegenerate: '重新生成',
    takeToNotes: '把灵感加入笔记', takeAdded: '已加入笔记', ideasFrom: '来自 {model} 的灵感',
    takeMeta: '{mode} · {tokens} tokens{cost}',
    takeAbstractOnly: '这篇论文在 arXiv 上没有 HTML 版本，所以精读只用了摘要。',
    takeTruncated: '回答在结束前被截断了。',
    err_nokey: '在 AI 设置中添加 API 密钥，即可为任意论文生成解读和研究灵感。',
    err_auth: '密钥被拒绝了，请在 AI 设置中检查。', err_permission: '这个密钥无权使用该模型：{message}',
    err_rate: '达到速率限制，请一分钟后再试。', err_network: '无法连接模型 API，请检查网络或代理。',
    err_refusal: '模型拒绝解读这篇论文。', err_billing: '你的 API 账户余额不足。',
    err_server: '模型服务出了问题，请重试。', err_bad: '请求被拒绝：{message}',
    err_api: 'API 错误 {message}', err_unknown: '出了点问题：{message}', err_stopped: '已停止。',
    retry: '重试', setupKey: '添加密钥',
    keys2: 'Q 快速解读 · D 精读全文 · A 提问',
    askTitle: '向这篇论文提问', askPh: '关于这篇论文，想问什么都可以……', askPhFollow: '针对论文或上面的解读继续追问……',
    askSend: '提问', askStop: '停止', askClear: '清空', askClearConfirm: '确认清空？', askYou: '我',
    askFetching: '正在读取全文…', askThinking: '思考中…', askToNotes: '加入笔记', askAdded: '已加入', askCopy: '复制', askCopied: '已复制',
    askNote: 'arXiv 有 HTML 版本时，回答会基于论文全文。Enter 发送 · Shift+Enter 换行。',
    askAbstractOnly: '仅基于摘要', askStopped: '回答在完成前被停止了。',
    askSuggest: ['用大白话讲讲这篇的核心思想？', '哪个实验结果最有说服力，哪个最弱？', '这篇对我自己的项目有什么启发？', '复现这篇论文需要什么条件？'],
    askSuggestFollow: ['一步一步讲解方法', '把灵感 1 展开成具体的实验方案', '最相关的前人工作有哪些？区别在哪？'],
  },
};

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const pick = (v, L) => (v == null ? undefined : typeof v === 'string' ? v : (v[L] ?? v.en ?? v.zh));
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/g;

// Settings live next to the surveys (so they travel with a shared folder); the copy in portal/ is the fallback.
function readConfig() {
  const file = [path.join(CTX.docsDir, 'portal.config.json'), path.join(ROOT, 'portal.config.json')].find((f) => fs.existsSync(f));
  if (!file) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`portal.config.json is not valid JSON (${e.message})`); }
}

function textOf(t, sep = ' ') {
  if (!t) return '';
  if (Array.isArray(t)) return t.map((x) => textOf(x, sep)).join(sep);
  switch (t.type) {
    case 'table':
      return [...t.header.map((c) => textOf(c.tokens, '')), ...t.rows.flat().map((c) => textOf(c.tokens, ''))].join(' ');
    case 'list':
      return t.items.map((it) => textOf(it.tokens)).join(' ');
    case 'code':
      return t.text;
    case 'space': case 'hr': case 'html': case 'checkbox':
      return '';
    case 'br':
      return ' ';
  }
  const inline = ['paragraph', 'heading', 'text', 'strong', 'em', 'link', 'del'].includes(t.type);
  if (t.tokens) return textOf(t.tokens, inline ? '' : sep);
  return t.text ?? '';
}
const inlineText = (tokens) => textOf(tokens, '').replace(/\s+/g, ' ').trim();

// Formulas in the surveys are typeset here, at build time: $$…$$ on its own lines is a display
// formula, $…$ is inline. A single $ must hug its formula ($x$, not $ x $) and must not be
// followed by a digit, so "$5 to $10" stays text; \$ is a literal dollar.
const tex = (src, displayMode) => katex.renderToString(src, { displayMode, throwOnError: false, strict: 'ignore', errorColor: 'currentColor' });
const MATH = {
  extensions: [
    {
      name: 'mathBlock', level: 'block',
      start: (src) => src.match(/^\$\$/m)?.index,
      tokenizer(src) {
        const m = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src);
        if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
      },
      renderer: (t) => `<div class="math-display">${tex(t.text, true)}</div>\n`,
    },
    {
      name: 'mathInline', level: 'inline',
      start: (src) => src.match(/(?<!\\)\$/)?.index,
      tokenizer(src) {
        const m = /^\$\$([^$]+?)\$\$|^\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
        if (m) return { type: 'mathInline', raw: m[0], text: (m[1] ?? m[2]).trim(), display: m[1] != null };
      },
      renderer: (t) => tex(t.text, t.display),
    },
  ],
};

function slugify(s) {
  const slug = s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'section';
}

function parseDate(str) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(str || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function detectLang(text) {
  const cjk = (text.match(CJK) || []).length;
  const latin = (text.match(/[A-Za-z]{2,}/g) || []).length;
  return cjk > latin * 0.6 ? 'zh' : 'en';
}

// Splits a leading section number ("3." or "3.1") from heading HTML.
function splitNumber(html, depth) {
  const re = depth === 2 ? /^(\d{1,2})\.\s*/ : /^(\d{1,2}\.\d{1,2})\.?\s+/;
  const m = re.exec(html);
  if (!m) return { num: '', rest: html };
  return { num: depth === 2 ? pad2(m[1]) : m[1], rest: html.slice(m[0].length) };
}

// ---------- documents ----------
function discover(config) {
  const exclude = new Set((config.exclude || []).map((f) => f.toLowerCase()));
  const groups = new Map();
  for (const f of fs.readdirSync(CTX.docsDir)) {
    if (!/\.md$/i.test(f) || exclude.has(f.toLowerCase())) continue;
    const full = path.join(CTX.docsDir, f);
    if (!fs.statSync(full).isFile()) continue;
    const m = /^(.*)\.(zh|zh-cn|cn|en)\.md$/i.exec(f);
    const base = m ? m[1] : f.slice(0, -3);
    const lang = m ? (m[2].toLowerCase() === 'en' ? 'en' : 'zh') : detectLang(fs.readFileSync(full, 'utf8'));
    const key = base.toLowerCase();
    const g = groups.get(key) || { base, files: {}, explicit: {} };
    if (!g.files[lang] || (m && !g.explicit[lang])) { g.files[lang] = full; g.explicit[lang] = !!m; }
    groups.set(key, g);
  }

  const order = (config.order || []).map((f) => f.toLowerCase().replace(/(\.(zh|zh-cn|cn|en))?\.md$/, ''));
  const firstSeen = (g) => Math.min(...Object.values(g.files).map((f) => fs.statSync(f).mtimeMs));
  const list = [...groups.entries()].sort(([ka, a], [kb, b]) => {
    const ia = order.indexOf(ka), ib = order.indexOf(kb);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
    return firstSeen(a) - firstSeen(b);
  });

  const metaByKey = new Map(Object.entries(config.docs || {}).map(([k, v]) => [k.toLowerCase().replace(/(\.(zh|zh-cn|cn|en))?\.md$/, ''), v]));
  const used = new Set();
  return list.map(([key, g], i) => {
    let slug = slugify(g.base);
    while (used.has(slug)) slug += '-x';
    used.add(slug);
    return { key, base: g.base, files: g.files, slug, href: `${slug}.html`, num: pad2(i + 1), meta: metaByKey.get(key) || {} };
  });
}

function renderDoc(file, linkFor) {
  const src = fs.readFileSync(file, 'utf8');
  const marked = new Marked({ gfm: true }).use(MATH);
  const tokens = marked.lexer(src);

  // Title block: H1, an optional H2 straight after it (subtitle), an optional all-italic paragraph (deck).
  let title = path.basename(file).replace(/(\.(zh|en))?\.md$/i, ''), subtitle = '', deck = '', deckText = '';
  const skipSpace = (k) => { while (tokens[k] && tokens[k].type === 'space') k++; return k; };
  const h1 = tokens.findIndex((t) => t.type === 'heading' && t.depth === 1);
  if (h1 !== -1) {
    title = inlineText(tokens[h1].tokens);
    tokens.splice(h1, 1);
    let k = skipSpace(h1);
    if (tokens[k]?.type === 'heading' && tokens[k].depth === 2) {
      subtitle = marked.parseInline(tokens[k].text.trim().replace(/^["“”「」]+|["“”「」]+$/g, ''));
      tokens.splice(k, 1);
      k = skipSpace(k);
    }
    const p = tokens[k];
    if (p?.type === 'paragraph' && p.tokens?.length === 1 && p.tokens[0].type === 'em') {
      deck = marked.parser([{ type: 'paragraph', tokens: p.tokens[0].tokens, raw: '', text: '' }]).replace(/^<p>|<\/p>\s*$/g, '');
      deckText = inlineText(p.tokens[0].tokens);
      tokens.splice(k, 1);
    }
  }
  while (tokens[0] && (tokens[0].type === 'space' || tokens[0].type === 'hr')) tokens.shift();

  // Heading ids, contents and search sections in one pass.
  const ids = new Set();
  const toc = [];
  const sections = [{ h: '', a: '', parts: [] }];
  for (const t of tokens) {
    if (t.type === 'heading') {
      const text = inlineText(t.tokens);
      let id = slugify(text), n = 2;
      while (ids.has(id)) id = `${slugify(text)}-${n++}`;
      ids.add(id);
      t._id = id;
      if (t.depth === 2 || t.depth === 3) toc.push({ depth: t.depth, text, id });
      sections.push({ h: text, a: id, parts: [] });
    } else {
      sections.at(-1).parts.push(textOf(t));
    }
  }

  marked.use({
    renderer: {
      heading(token) {
        const inner = this.parser.parseInline(token.tokens);
        const id = token._id || slugify(inlineText(token.tokens));
        if (token.depth === 2 || token.depth === 3) {
          const { num, rest } = splitNumber(inner, token.depth);
          const numHtml = num ? `<span class="h-num">${num}</span>` : '';
          return `<h${token.depth} id="${id}">${numHtml}<span class="h-text">${rest}</span><a class="h-anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a></h${token.depth}>\n`;
        }
        return `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`;
      },
      link(token) {
        const inner = this.parser.parseInline(token.tokens);
        const internal = linkFor(token.href);
        const href = internal || token.href;
        const external = !internal && /^https?:/i.test(href);
        const title = token.title ? ` title="${esc(token.title)}"` : '';
        return `<a href="${esc(href)}"${title}${external ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>`;
      },
      codespan(token) {
        const internal = linkFor(token.text);
        const code = `<code>${esc(token.text)}</code>`;
        return internal ? `<a class="doc-ref" href="${esc(internal)}">${code}</a>` : code;
      },
    },
  });

  let html = marked.parser(tokens);
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');

  const body = textOf(tokens);
  const latin = body.replace(CJK, ' ').split(/\s+/).filter(Boolean).length;
  const cjk = (body.match(CJK) || []).length;

  return {
    title, subtitle, deck, deckText, html, toc,
    minutes: Math.max(1, Math.round(latin / 230 + cjk / 420)),
    date: parseDate(src.slice(0, 800)) || new Date(fs.statSync(file).mtimeMs),
    sections: sections
      .map((s) => ({ h: s.h, a: s.a, t: s.parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 6000) }))
      .filter((s) => s.h || s.t),
  };
}

// ---------- page templates ----------
function tabs(L, current) {
  const T = I18N[L];
  if (CTX.mobile) return ''; // the phone app is the paper feed only
  return `<nav class="tabs" aria-label="Sections"><a href="index.html"${current === 'surveys' ? ' class="is-current"' : ''}>${T.tabSurveys}</a><a href="papers.html"${current === 'papers' ? ' class="is-current"' : ''}>${T.tabPapers}</a></nav>`;
}

function layout({ L, title, bodyClass, bar, main, after = '' }) {
  const T = I18N[L];
  return `<!doctype html>
<html lang="${T.htmlLang}" data-lang="${L}" data-version="${CTX.version}" data-repo="${REPO}" data-platform="${CTX.mobile ? 'android' : 'desktop'}"${CTX.mobile ? ' class="is-app is-mobile"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1${CTX.mobile ? ', viewport-fit=cover' : ''}">
<meta name="theme-color" content="#f6f5f1">
<meta name="color-scheme" content="light">
<title>${esc(title)}</title>
<script>(function(){var r=document.documentElement,d=window.devicePixelRatio||1;r.style.setProperty('--line-w',Math.max(1,Math.round(d*0.8))/d+'px');r.style.setProperty('--rule-w',Math.max(2,Math.round(d*1.6))/d+'px');if(window.portal&&window.portal.isApp)r.classList.add('is-app');var t;try{t=localStorage.getItem('ri-style')}catch(e){}if(t!=='classic'){r.classList.add('fl');var m=document.querySelector('meta[name="color-scheme"]');if(m)m.content='light dark';}}());</script>
<link rel="icon" href="../assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../assets/fonts.css">
<link rel="stylesheet" href="../assets/style.css">
<link rel="stylesheet" href="../assets/feed.css">
<link rel="stylesheet" href="../assets/katex/katex.min.css">
<link rel="stylesheet" href="../assets/swipe.css">
<link rel="stylesheet" href="../assets/usage.css">
<link rel="stylesheet" href="../assets/glass.css">${CTX.mobile ? '\n<script type="module" src="../assets/mobile/boot.mjs"></script>' : ''}
<script src="../assets/glass.js" defer></script>
<script src="../assets/update.js" defer></script>
<script src="../assets/app.js" defer></script>${bodyClass === 'page-papers' ? '\n<script src="../assets/katex/katex.min.js" defer></script>\n<script src="../assets/feed.js" defer></script>\n<script src="../assets/swipe.js" defer></script>\n<script src="../assets/qrcode.js" defer></script>\n<script src="../assets/share.js" defer></script>\n<script src="../assets/usage.js" defer></script>' : ''}
</head>
<body class="${bodyClass}">
<header class="bar"><div class="bar-inner">${bar}</div><div class="progress" aria-hidden="true"><span></span></div></header>
<div class="scroller" id="scroller">
${main}
</div>
<script type="application/json" id="ri-strings">${JSON.stringify(T.client).replace(/</g, '\\u003c')}</script>
${after}
</body>
</html>
`;
}

// The bar's ⋯: one button for language, style, updates and About (nothing of it is on screen all the time)
function styleSwitch(L) {
  const T = I18N[L];
  return `<nav class="lang style-switch" aria-label="${T.styleLabel}"><button type="button" data-style-set="glass">${T.styleGlass}</button><button type="button" data-style-set="classic">${T.styleClassic}</button></nav>`;
}
function barMenu(L, page) {
  const T = I18N[L], C = T.client;
  const row = (label, control) => `<div class="ab-row"><span class="ab-label">${label}</span>${control}</div>`;
  return `<button class="bar-menu-btn" type="button" data-about data-pop-opener aria-label="${C.more}" title="${C.more}" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><span class="about-dot" hidden></span></button>
<div class="about-pop" id="about-pop" data-glass="menu" data-pop role="dialog" aria-label="${C.about}" hidden>
  <div class="ab-head"><img class="ab-icon" src="../assets/icon.svg" alt=""><div class="ab-name"><b>${T.siteTitle}</b><span>${C.version.replace('{v}', CTX.version)}</span></div></div>
  <div class="ab-group">${row(C.langName, langSwitch(L, page))}${row(C.styleLabel, styleSwitch(L))}</div>
  <div class="ab-group">
    <button type="button" class="ab-row ab-btn" data-ab="check"><span class="ab-label">${C.checkUpdates}</span><span class="ab-status" role="status"></span></button>
    <label class="ab-row ab-btn"><span class="ab-label">${C.autoCheck}</span><input type="checkbox" class="ab-switch" data-ab="auto" checked></label>
    <a class="ab-row ab-btn" href="https://github.com/${REPO}" target="_blank" rel="noopener"><span class="ab-label">${C.projectPage}</span><span class="ab-go" aria-hidden="true">↗</span></a>
  </div>
</div>`;
}

function langSwitch(L, page) {
  return `<nav class="lang" aria-label="Language / 语言">${LANGS.map((l) =>
    `<a href="../${l}/${page}" data-lang="${l}" hreflang="${I18N[l].htmlLang}"${l === L ? ' class="is-current" aria-current="true"' : ''}>${l === 'en' ? 'EN' : '中文'}</a>`).join('')}</nav>`;
}

function chip(status, L) {
  if (!status) return '';
  const label = I18N[L].status[status] || status[0].toUpperCase() + status.slice(1);
  return `<span class="chip chip-${esc(status)}">${esc(label)}</span>`;
}

function homePage(L, docs, config) {
  const T = I18N[L];
  const siteTitle = pick(config.siteTitle, L) || T.siteTitle;
  // The newest survey in the folder, as a way in. (Nothing personal is built into the app.)
  const touched = (d) => Math.max(0, ...Object.values(d.files).map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }));
  const latest = docs.slice().sort((a, b) => (b[L].date - a[L].date) || (touched(b) - touched(a)))[0];
  const v = latest?.[L];
  const nowBlock = latest ? `
    <div class="hero-now">
      <div class="eyebrow"><span class="sq" aria-hidden="true"></span>${esc(T.latest)}</div>
      <h1 class="now-title">${esc(v.short)}</h1>
      ${v.deckText ? `<p class="now-note">${esc(v.deckText.length > 170 ? `${v.deckText.slice(0, 168)}…` : v.deckText)}</p>` : ''}
      <a class="now-cta" href="${latest.href}"><span>${esc(T.readLatest)}</span><span class="arrow" aria-hidden="true">→</span></a>
    </div>` : '';

  const rows = docs.map((d) => {
    const v = d[L];
    const sub = v.short !== v.title ? v.title : v.deckText;
    return `
      <li><a class="row" href="${d.href}">
        <span class="row-num">${d.num}</span>
        <span class="row-main"><span class="row-title">${esc(v.short)}</span><span class="row-deck">${esc(sub.slice(0, 160))}</span></span>
        <span class="row-date">${T.date(v.date)}</span>
        <span class="row-read">${v.minutes} ${T.min}<span class="row-pct" data-pct></span></span>
        <span class="row-status">${chip(d.meta.status, L)}</span>
        <span class="row-arrow" aria-hidden="true">→</span>
      </a></li>`;
  }).join('');

  const searchData = {
    docs: docs.map((d) => ({ n: d.num, s: d[L].short, f: d.href })),
    sections: docs.flatMap((d, i) => [
      { d: i, h: d[L].title, a: '', t: d[L].deckText },
      ...d[L].sections.filter((s) => s.h).map((s) => ({ d: i, h: s.h, a: s.a, t: s.t })),
    ]),
  };

  const first = docs.length ? new Date(Math.min(...docs.map((d) => d[L].date))) : null;
  const builtAt = L === 'zh'
    ? new Date().toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
    : new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const bar = `${tabs(L, 'surveys')}<div class="bar-right"><nav class="bar-meta"><span>${T.surveys} <b>${pad2(docs.length)}</b></span></nav>${barMenu(L, 'index.html')}</div>`;
  const main = `
<main class="wrap home">
  <section class="hero">
    <div class="hero-count">
      <div class="numeral" aria-label="${docs.length} ${esc(T.surveys)}">${pad2(docs.length)}</div>
      <div class="numeral-label"><span>${T.surveysOnFile}</span><span>${first ? T.since(T.short(first)) : ''}</span></div>
    </div>
    ${nowBlock}
  </section>

  <section class="index" aria-labelledby="index-label">
    <div class="index-head">
      <h2 class="section-label" id="index-label">${T.index} <span>(${pad2(docs.length)})</span></h2>
      <label class="search">
        <span class="sr-only">${T.searchAll}</span>
        <input type="search" id="q" placeholder="${T.searchAll}" autocomplete="off" spellcheck="false">
        <kbd aria-hidden="true">/</kbd>
      </label>
    </div>
    <p class="results-label" id="results-label" hidden></p>
    <ol class="doc-list" id="doc-list">${rows}
    </ol>${docs.length ? '' : `\n    <p class="empty">${T.noSurveys}</p>`}
    <ol class="doc-list results" id="results" hidden></ol>
  </section>

  <footer class="foot">
    <span>${T.builtFrom(docs.reduce((n, d) => n + Object.keys(d.files).length, 0))}${CTX.mobile ? '' : ` · ${esc(CTX.docsDir)}`}</span>
    <span>${T.lastBuilt} ${esc(builtAt)}</span>
    <span class="foot-end"><span class="web-only">${T.addHint}</span><button class="tool app-only" type="button" data-open-folder>${T.openFolder}</button><button class="tool app-only" type="button" data-choose-folder>${T.changeFolder}</button></span>
  </footer>
</main>`;
  const after = `<script type="application/json" id="search-data">${JSON.stringify(searchData).replace(/</g, '\\u003c')}</script>`;
  return layout({ L, title: siteTitle, bodyClass: 'page-home', bar, main, after });
}

function docPage(L, docs, i, config) {
  const T = I18N[L];
  const d = docs[i], v = d[L];
  const prev = docs[i - 1], next = docs[i + 1];
  const siteTitle = pick(config.siteTitle, L) || T.siteTitle;
  const tocHtml = v.toc.map((t) => {
    const { num, rest } = splitNumber(esc(t.text), t.depth);
    return `<li class="toc-${t.depth}"><a href="#${t.id}" data-toc="${t.id}"><span class="toc-num">${t.depth === 2 ? num : ''}</span><span>${rest}</span></a></li>`;
  }).join('');
  const bar = `${tabs(L, 'surveys')}<span class="crumb"><span class="crumb-num">${d.num}</span>${esc(v.short)}</span><div class="bar-right"><a class="back" href="index.html"><span aria-hidden="true">←</span> ${T.allSurveys}</a>${barMenu(L, d.href)}</div>`;
  const meta = [
    chip(d.meta.status, L),
    `<span>${T.date(v.date)}</span>`,
    `<span>${v.minutes} ${T.minRead}</span>`,
    v.toc.some((t) => t.depth === 2) ? `<span>${T.sections(v.toc.filter((t) => t.depth === 2).length)}</span>` : '',
    `<span class="tools app-only"><button class="tool" type="button" data-open-file="${esc(v.file)}">${T.openFile}</button><button class="tool" type="button" data-reveal="${esc(v.file)}">${T.reveal}</button></span>`,
  ].filter(Boolean).join('');

  const main = `
<main class="wrap reader">
  <header class="doc-head">
    <div class="doc-num">${d.num}</div>
    <div class="doc-titles">
      ${v.fallback ? `<p class="fallback-note">${T.fallbackNote}</p>` : ''}
      <div class="doc-meta">${meta}</div>
      <h1 class="doc-title">${esc(v.title)}</h1>
      ${v.subtitle ? `<p class="doc-subtitle">${v.subtitle}</p>` : ''}
      ${v.deck ? `<p class="doc-deck">${v.deck}</p>` : ''}
    </div>
  </header>
  <div class="doc-body">
    <aside class="toc" aria-label="${T.contents}">
      <div class="find">
        <input type="search" id="find" placeholder="${T.findInPage}" autocomplete="off" spellcheck="false">
        <span class="find-count" id="find-count" aria-live="polite"></span>
        <button class="find-btn" type="button" data-find="prev" aria-label="Previous match">↑</button>
        <button class="find-btn" type="button" data-find="next" aria-label="Next match">↓</button>
      </div>
      ${v.toc.length ? `<div class="toc-label">${T.contents}</div><ol>${tocHtml}</ol>` : ''}
    </aside>
    <article class="prose" id="article"${v.fallback ? ` lang="${I18N[v.lang].htmlLang}"` : ''}>
${v.html}
    </article>
  </div>
  <nav class="pager" aria-label="${T.allSurveys}">
    ${prev ? `<a class="pager-prev" href="${prev.href}"><span class="pager-label">← ${T.previous} · ${prev.num}</span><span class="pager-title">${esc(prev[L].short)}</span></a>` : '<span></span>'}
    ${next ? `<a class="pager-next" href="${next.href}"><span class="pager-label">${T.next} · ${next.num} →</span><span class="pager-title">${esc(next[L].short)}</span></a>` : `<a class="pager-next" href="index.html"><span class="pager-label">${T.backTo} →</span><span class="pager-title">${T.theIndex}</span></a>`}
  </nav>
</main>`;
  return layout({ L, title: `${d.num} · ${v.short} — ${siteTitle}`, bodyClass: 'page-doc', bar, main });
}

function papersPage(L, config) {
  const T = I18N[L];
  const F = FEED[L];
  const siteTitle = pick(config.siteTitle, L) || T.siteTitle;
  const search = `<label class="feed-search bar-search"><span class="sr-only">${F.searchPapers}</span><svg class="bs-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input type="search" id="fq" placeholder="${F.searchPapers}" autocomplete="off" spellcheck="false"><kbd aria-hidden="true">/</kbd></label>`;
  const bar = `${tabs(L, 'papers')}${search}<div class="bar-right"><span class="bar-meta"><span id="bar-feed"></span></span>${barMenu(L, 'papers.html')}</div>`;
  const main = `
<main id="feed">
  <section class="wrap feed-head">
    <div class="feed-title">
      <h1>${F.title}</h1>
      <p class="feed-sub" id="feed-status">&nbsp;</p>
    </div>
    <div class="feed-tools">
      <button class="tool" type="button" id="tr-btn" aria-pressed="false">${F.translate}</button>
      <button class="tool" type="button" id="tune" data-pop-opener>${F.interests}</button>
      <button class="tool" type="button" id="ai-btn" data-pop-opener><span class="spark" aria-hidden="true">✦</span> ${F.ai}</button>
      <button class="tool" type="button" id="refresh" title="${F.refreshTip}">${F.refresh}</button>
      <button class="tool tool-view" type="button" id="view-btn" title="${F.viewTip}"><span class="vb-icon" aria-hidden="true"></span>${F.view_swipe}</button>
      <div class="tune-pop ai-pop" id="ai-pop" data-glass="menu" data-pop hidden>
        <button type="button" class="share-x pop-x" data-pop-close aria-label="${F.close}">×</button>
        <h3>${F.aiTitle}</h3>
        <button type="button" class="ai-usage-row" id="ai-usage-open"><span class="aur-label">${F.usageOpen}</span><span class="aur-value" id="ai-usage-value"></span><span class="aur-go" aria-hidden="true">›</span></button>
        <span class="ai-label">${F.aiProvider}</span>
        <div class="seg" id="ai-provider"><button type="button" data-provider="deepseek">DeepSeek</button><button type="button" data-provider="claude">Claude</button></div>
        <p class="ai-status" id="ai-status"></p>
        <label class="ai-label" for="ai-key" id="ai-key-label"></label>
        <div class="ai-key-row"><input type="password" id="ai-key" placeholder="${F.aiKeyPh}" autocomplete="off" spellcheck="false"><button class="btn-primary" type="button" id="ai-key-save">${F.aiKeySave}</button></div>
        <p class="take-hint" id="ai-key-hint"></p>
        <button class="tool" type="button" id="ai-key-remove" hidden>${F.aiKeyRemove}</button>
        <div class="ai-ds" id="ai-ds">
          <label class="ai-label" for="ai-base">${F.aiBase}</label><input class="ai-input" id="ai-base" spellcheck="false" autocomplete="off">
          <label class="ai-label" for="ai-model">${F.aiModel}</label><input class="ai-input" id="ai-model" spellcheck="false" autocomplete="off">
        </div>
        <div class="ai-rate"><label class="ab-row ai-rate-row"><span class="ab-label">${F.rateOn}</span><input type="checkbox" class="ab-switch" id="ai-rate-on"></label>
          <p class="take-hint">${F.rateHint}</p>
          <div class="ai-rate-cap"><span class="ai-label">${F.rateCap}</span><div class="seg" id="ai-rate-cap">${[0.1, 0.2, 0.5, 1].map((v) => `<button type="button" data-cap="${v}">¥${v}</button>`).join('')}</div><span class="ai-rate-spent" id="ai-rate-spent"></span></div></div>
        <label class="ai-label" for="ai-context">${F.aiContext}</label>
        <p class="take-hint">${F.aiContextHint}</p>
        <textarea id="ai-context" spellcheck="false" placeholder="${F.aiContextPh}"></textarea>
        <div class="row"><button class="btn-primary" type="button" id="ai-save">${F.aiSave}</button></div>
      </div>
      <div class="tune-pop" id="tune-pop" data-glass="menu" data-pop hidden>
        <button type="button" class="share-x pop-x" data-pop-close aria-label="${F.close}">×</button>
        <h3>${F.tuneTitle}</h3>
        <p>${F.tuneHint}</p>
        <textarea id="tune-text" spellcheck="false"></textarea>
        <div class="row"><button class="btn-primary" type="button" id="tune-save">${F.tuneSave}</button></div>
      </div>
    </div>
  </section>
  <div class="feed-nav" data-glass="panel">
    <div class="wrap">
      <div class="modes-row"><nav class="modes" id="modes" aria-label="${F.title}"></nav><button class="dir-btn" type="button" id="dir-btn" data-pop-opener aria-haspopup="dialog" aria-expanded="false" aria-label="${F.directions}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><span class="dir-name"></span></button></div>
      <div class="chips" id="chips"></div>
    </div>
  </div>
  <section class="wrap">
    <p class="feed-basis" id="feed-basis" hidden></p>
    <p class="feed-cold" id="feed-cold" hidden><span>${F.coldFor}</span> <button class="link-btn" type="button" id="cold-tune">${F.coldForBtn}</button></p>
    <div class="masonry" id="grid"></div>
    <div class="feed-msg" id="feed-msg" hidden></div>
    <div class="feed-more" id="feed-more"></div>
    <div class="feed-end" id="feed-end" hidden>${F.end}</div>
  </section>
  <button class="to-top" id="to-top" data-glass="round" type="button" aria-label="${F.backTop}" title="${F.backTop}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19.5V5M5.5 11.5L12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
</main>
<div class="feed-web" id="feed-web" hidden>${F.webOnly}</div>`;
  const strings = { ...F };
  // The action bar sits outside the cards, so it stays put while the papers slide past (a bottom bar on the
  // phone and in narrow windows, a column beside the card on a wide screen).
  const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2"${extra}/></svg>`;
  const SWI = {
    heart: svg('M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.7 1.1 5 2.9 1.3-1.8 3-2.9 5-2.9 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z', ' stroke-linejoin="round"'),
    mark: svg('M6 3.5h12v17l-6-4.2-6 4.2z'),
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l1.9 6.9 6.9 1.9-6.9 1.9-1.9 6.9-1.9-6.9L3.2 12l6.9-1.9z" fill="currentColor"/></svg>',
    open: svg('M7.5 16.5l9-9M9 7h8.5v8.5'),
    share: svg('M12 14.5V3.8M7.6 8.2L12 3.8l4.4 4.4M5.5 11.5v8.5h13v-8.5', ' stroke-linejoin="round"'),
    hide: svg('M6.5 6.5l11 11M17.5 6.5l-11 11'),
    up: svg('M5.5 15l6.5-6.5 6.5 6.5'),
    down: svg('M5.5 9l6.5 6.5 6.5-6.5'),
  };
  const act = (kind, icon, label, attrs = '') => `<button type="button" class="sw-act ${kind}" data-sw="${kind}"${attrs}><span class="sw-ico">${icon}</span><span class="sw-lbl">${label}</span></button>`;
  const swipe = `<div class="swipe" id="swipe" hidden>
  <header class="sw-top">
    <div class="sw-top-in">
      <button class="sw-icon" type="button" id="sw-grid" data-glass="round" aria-label="${F.view_grid}" title="${F.view_grid} (V)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
      <button class="sw-icon sw-back" type="button" id="sw-back" data-glass="round" aria-label="${F.swBack}" title="${F.swBack}" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div class="sw-modes-wrap" data-glass="pill"><nav class="sw-modes" id="sw-modes" aria-label="${F.title}"></nav></div>
      <button class="sw-icon sw-search-btn" type="button" id="sw-search-btn" data-glass="round" aria-label="${F.swSearch}" title="${F.swSearch}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.2 15.2l4.6 4.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
      <form class="sw-search" id="sw-search" role="search" hidden><label class="sw-search-field" data-glass="pill"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.2 15.2l4.6 4.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><input type="search" id="sw-q" enterkeyhint="search" placeholder="${F.searchPapers}" autocomplete="off" spellcheck="false" aria-label="${F.searchPapers}"></label><button type="button" class="sw-search-cancel" id="sw-search-cancel" data-glass="pill">${F.swSearchCancel}</button></form>
      <button class="sw-icon sw-dir" type="button" id="sw-dir" data-glass="round" data-pop-opener aria-haspopup="dialog" aria-expanded="false" aria-label="${F.directions}" title="${F.directions}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><i class="dir-dot" hidden></i></button>
      <button class="sw-icon" type="button" id="sw-menu-btn" data-glass="round" data-pop-opener aria-label="${F.swMore}" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01" stroke="currentColor" stroke-width="3.2" stroke-linecap="square"/></svg></button>
      <div class="sw-menu" id="sw-menu" data-glass="menu" data-pop hidden>
        <div class="sw-sets">
          <div class="sw-set"><span>${I18N[L].langName}</span><div class="lang sw-seg">${LANGS.map((l) => `<button type="button" data-sw-lang="${l}"${l === L ? ' class="is-current" aria-current="true"' : ''} lang="${I18N[l].htmlLang}">${l === 'en' ? 'EN' : '中文'}</button>`).join('')}</div></div>
          <div class="sw-set"><span>${I18N[L].styleLabel}</span>${styleSwitch(L).replace('class="lang style-switch"', 'class="lang style-switch sw-seg"')}</div>
        </div>
        <button type="button" data-sw-menu="refresh">${F.swNewBatch}<kbd>R</kbd></button>
        <button type="button" data-sw-menu="tr">${F.translate}<span class="sw-check" aria-hidden="true"></span></button>
        <button type="button" data-sw-menu="tune">${F.interests}</button>
        <button type="button" data-sw-menu="ai">${F.aiTitle}</button>
        <button type="button" data-sw-menu="usage">${F.usageMenu}</button>
        <button type="button" data-sw-menu="about">${I18N[L].client.about}</button>
        <button type="button" data-sw-menu="grid">${F.view_grid}<kbd>V</kbd></button>
      </div>
    </div>
  </header>
  <div class="sw-stage">
    <div class="sw-track" id="sw-track" tabindex="-1"></div>
    <div class="sw-shelf" id="sw-shelf" hidden><div class="sw-shelf-grid" id="sw-shelf-grid"></div><p class="sw-shelf-empty" id="sw-shelf-empty" hidden></p><div class="sw-shelf-more" id="sw-shelf-more"></div></div>
    <div class="sw-nav" id="sw-nav">
      <button type="button" data-sw-go="-1" data-glass="round" aria-label="${F.swPrev}" title="${F.swPrev} (↑)">${SWI.up}</button>
      <button type="button" data-sw-go="1" data-glass="round" aria-label="${F.swNext}" title="${F.swNext} (↓)">${SWI.down}</button>
    </div>
    <p class="sw-keys" aria-hidden="true">${F.swKeys}</p>
    <p class="sw-hint" id="sw-hint" hidden></p>
    <div class="sw-toast" id="sw-toast" data-glass="banner" role="status" hidden></div>
  </div>
  <div class="sw-actions is-off" id="sw-actions" data-glass="dock" role="toolbar" aria-label="${F.swActions}">
    ${act('like', SWI.heart, F.like, ` aria-pressed="false" title="${F.like} (L)"`)}
    ${act('save', SWI.mark, F.save, ` aria-pressed="false" title="${F.save} (S)"`)}
    ${act('share', SWI.share, F.swShare, ` title="${F.share}"`)}
    ${act('open', SWI.open, F.swOpen, ` title="${F.swOpen} (Enter)"`)}
    ${act('hide', SWI.hide, F.hide, ` aria-pressed="false" title="${F.hide} (X)"`)}
  </div>
</div>`;
  const after = `${swipe}
<div class="sheet" id="sheet" hidden></div>
<script type="application/json" id="feed-strings">${JSON.stringify(strings).replace(/</g, '\\u003c')}</script>`;
  return layout({ L, title: `${F.title} — ${siteTitle}`, bodyClass: 'page-papers', bar, main, after });
}

function redirectPage(start = 'index.html') {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="theme-color" content="#f6f5f1"><title>Research index · 研究索引</title>
<style>html{background:#f6f5f1;font:15px system-ui,sans-serif}a{color:#1f3be6;margin:0 8px}</style>
<script>var l;try{l=localStorage.getItem('ri-lang')}catch(e){}if(l!=='en'&&l!=='zh'){l=/^zh/i.test(navigator.language||'')?'zh':'en'}location.replace(l+'/${start}'+location.hash);</script>
</head><body><noscript><a href="en/index.html">English</a><a href="zh/index.html">中文</a></noscript></body></html>
`;
}

// ---------- build ----------
// read + write (not copyFile) so this also works from inside the packaged app's archive
function copyIfChanged(from, to) {
  const size = fs.statSync(from).size;
  if (fs.existsSync(to) && fs.statSync(to).size === size) return;
  fs.writeFileSync(to, fs.readFileSync(from));
}

// The phone app runs the feed service inside the page: its modules (shared with the desktop app), the
// phone-side glue (mobile/src), and optionally a snapshot of the desktop app's paper cache so the phone
// starts with papers, their Chinese titles and your interests instead of an empty feed.
const MOBILE_FEED = ['store-core.mjs', 'recommend.mjs', 'service.mjs', 'sources.mjs', 'topics.mjs', 'venues.mjs', 'prompts.mjs', 'deepseek.mjs', 'usage.mjs', 'affil.mjs', 'openalex.mjs', 'quality.mjs', 'rating.mjs'];
function copyMobile(dist, seedDir) {
  const out = path.join(dist, 'assets', 'mobile');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'feed'), { recursive: true });
  for (const f of MOBILE_FEED) fs.copyFileSync(path.join(ROOT, 'app', 'feed', f), path.join(out, 'feed', f));
  for (const f of fs.readdirSync(path.join(ROOT, 'mobile', 'src'))) fs.copyFileSync(path.join(ROOT, 'mobile', 'src', f), path.join(out, f));
  if (!seedDir || !fs.existsSync(path.join(seedDir, 'papers.json'))) return;
  fs.mkdirSync(path.join(out, 'seed'), { recursive: true });
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(seedDir, f), 'utf8')); } catch { return d; } };
  fs.writeFileSync(path.join(out, 'seed', 'papers.json'), JSON.stringify(read('papers.json', {})));
  fs.writeFileSync(path.join(out, 'seed', 'translations.json'), JSON.stringify(read('translations.json', {})));
  // nothing of yours goes into the app: no likes, saves, interests, notes or AI settings, only when the
  // papers were last fetched (so the phone does not fetch everything again on its first start)
  const st = read('state.json', {});
  fs.writeFileSync(path.join(out, 'seed', 'state.json'), JSON.stringify({ meta: { lastFetch: st.meta?.lastFetch || 0, lastDeep: st.meta?.lastDeep || 0 } }));
}

export function build({ quiet = false, docsDir = DOCS_DIR, outDir = DIST, mobile = false, seedDir = '' } = {}) {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, mobile ? 'mobile/package.json' : 'package.json'), 'utf8')).version;
  CTX = { docsDir: path.resolve(docsDir), outDir: path.resolve(outDir), mobile, version };
  const DIST = CTX.outDir;
  if (!fs.existsSync(CTX.docsDir)) throw new Error(`Survey folder not found: ${CTX.docsDir}`);
  const config = readConfig();
  const docs = mobile ? [] : discover(config); // the phone app does not carry your surveys

  // Render each survey once per language that exists, then fill the gaps with the other language.
  for (const d of docs) {
    const linkFor = (target) => {
      const m = /^(?:\.\/)?([^/#?]+?)(?:\.(?:zh|zh-cn|cn|en))?\.md(#.*)?$/i.exec(target || '');
      if (!m) return null;
      const hit = docs.find((x) => x.key === m[1].toLowerCase());
      return hit ? hit.href + (m[2] || '') : null;
    };
    const rendered = {};
    for (const [lang, file] of Object.entries(d.files)) rendered[lang] = { ...renderDoc(file, linkFor), file, lang };
    for (const L of LANGS) {
      const own = rendered[L];
      const src = own || rendered[L === 'en' ? 'zh' : 'en'];
      const metaL = d.meta[L] || {};
      d[L] = {
        ...src,
        fallback: !own,
        title: metaL.title || src.title,
        short: metaL.short || d.meta.short || metaL.title || src.title,
        date: parseDate(d.meta.date) || src.date,
      };
    }
  }

  fs.mkdirSync(path.join(DIST, 'assets', 'fonts'), { recursive: true });
  for (const f of ['style.css', 'app.js', 'icon.svg', 'feed.css', 'feed.js', 'swipe.css', 'swipe.js', 'glass.css', 'glass.js', 'update.js', 'share.js', 'usage.js', 'usage.css']) fs.writeFileSync(path.join(DIST, 'assets', f), fs.readFileSync(path.join(SRC, f)));
  if (mobile) copyMobile(DIST, seedDir);

  // KaTeX for formulas (bundled, so math renders offline too)
  // QR codes on the share card (qrcode-generator, MIT)
  const qr = path.join(ROOT, 'node_modules', 'qrcode-generator', 'qrcode.js');
  if (fs.existsSync(qr)) fs.writeFileSync(path.join(DIST, 'assets', 'qrcode.js'), fs.readFileSync(qr));
  const katexDist = path.join(ROOT, 'node_modules', 'katex', 'dist');
  if (fs.existsSync(katexDist)) {
    fs.mkdirSync(path.join(DIST, 'assets', 'katex', 'fonts'), { recursive: true });
    for (const [from, to] of [['katex.min.css', 'katex.min.css'], ['katex.min.js', 'katex.min.js']]) {
      fs.writeFileSync(path.join(DIST, 'assets', 'katex', to), fs.readFileSync(path.join(katexDist, from)));
    }
    for (const f of fs.readdirSync(path.join(katexDist, 'fonts'))) {
      if (f.endsWith('.woff2')) copyIfChanged(path.join(katexDist, 'fonts', f), path.join(DIST, 'assets', 'katex', 'fonts', f));
    }
  }

  // Bundle the fonts so the portal works offline (Latin: Inter / Inter Tight, Chinese: Noto Sans SC).
  let fontCss = '';
  const fontSets = [['inter', ['wght.css', 'wght-italic.css']], ['inter-tight', ['wght.css', 'wght-italic.css']], ['noto-sans-sc', ['wght.css']]];
  for (const [pkg, sheets] of fontSets) {
    const base = path.join(ROOT, 'node_modules', '@fontsource-variable', pkg);
    for (const css of sheets) {
      if (!fs.existsSync(path.join(base, css))) continue;
      fontCss += fs.readFileSync(path.join(base, css), 'utf8').replace(/url\(\.\/files\/([^)]+)\)/g, (_, name) => {
        copyIfChanged(path.join(base, 'files', name), path.join(DIST, 'assets', 'fonts', name));
        return `url(fonts/${name})`;
      }) + '\n';
    }
  }
  fs.writeFileSync(path.join(DIST, 'assets', 'fonts.css'), fontCss);

  for (const L of LANGS) {
    const dir = path.join(DIST, L);
    fs.mkdirSync(dir, { recursive: true });
    const keep = new Set(['index.html', 'papers.html', ...docs.map((d) => d.href)]);
    fs.writeFileSync(path.join(dir, 'papers.html'), papersPage(L, config));
    // the phone app is the paper feed only: your surveys stay on your computer
    if (mobile) keep.clear(), keep.add('papers.html');
    else {
      fs.writeFileSync(path.join(dir, 'index.html'), homePage(L, docs, config));
      docs.forEach((d, i) => fs.writeFileSync(path.join(dir, d.href), docPage(L, docs, i, config)));
    }
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.html') && !keep.has(f)) fs.rmSync(path.join(dir, f));
  }
  for (const f of fs.readdirSync(DIST)) if (f.endsWith('.html') && f !== 'index.html') fs.rmSync(path.join(DIST, f));
  fs.writeFileSync(path.join(DIST, 'index.html'), redirectPage(mobile ? 'papers.html' : 'index.html'));

  if (!quiet && mobile) console.log(`Research index: built the phone app's pages (paper feed only) → ${DIST}`);
  else if (!quiet) {
    console.log(`Research index: built ${docs.length} survey(s) in English and Chinese → ${DIST}`);
    for (const d of docs) {
      const langs = Object.keys(d.files).join(' + ');
      console.log(`  ${d.num}  ${d.en.short}  /  ${d.zh.short}   [${langs}]`);
    }
  }
  return { docs, dist: DIST };
}

// ---------- command line ----------
const isCli = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isCli) {
  const mobile = process.argv.includes('--mobile');
  const seedArg = process.argv.find((a) => a.startsWith('--seed='));
  try {
    if (mobile) {
      const seedDir = seedArg ? seedArg.slice(7) : (process.argv.includes('--no-seed') ? '' : 'D:/Research Index Data/feed');
      build({ mobile: true, outDir: path.join(ROOT, 'mobile', 'www'), seedDir });
    } else build();
  }
  catch (e) { console.error(`Build failed: ${e.message}`); process.exit(1); }
  if (process.argv.includes('--open')) {
    const url = pathToFileURL(path.join(DIST, 'index.html')).href;
    const edge = [
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe'),
    ].find((p) => p && fs.existsSync(p));
    const child = edge
      ? spawn(edge, [`--app=${url}`, '--window-size=1440,940'], { detached: true, stdio: 'ignore' })
      : spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    child.unref();
  }
}
