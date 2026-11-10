// Institutions behind a paper: read from the author block of its arXiv HTML page (the same request that finds
// its cover figure), from the authors' e-mail domains when no affiliation is written, and later from OpenAlex
// (openalex.mjs), whose records are tidier but arrive about a week after the paper. Shared by both apps.

// Well-known institutions: [name, Chinese name, pattern for how it is written, e-mail domains]. A match here
// gives the tidy name (and the Chinese one); anything else is kept as written, shortened to its main part.
const KNOWN = [
  // companies and labs
  ['Google DeepMind', '谷歌 DeepMind', /\bDeep\s?Mind\b/i, ['deepmind.com']],
  ['Google', '谷歌', /\bGoogle\b(?!\s*Scholar)/i, ['google.com']],
  ['OpenAI', 'OpenAI', /\bOpen\s?AI\b/i, ['openai.com']],
  ['Anthropic', 'Anthropic', /\bAnthropic\b/i, ['anthropic.com']],
  ['Meta', 'Meta', /\bMeta\b(?:\s*(?:AI|FAIR|Platforms|Superintelligence))?|\bFAIR\b|Facebook AI/, ['meta.com', 'fb.com']],
  ['Microsoft', '微软', /\bMicrosoft\b/i, ['microsoft.com']],
  ['NVIDIA', '英伟达', /\bNVIDIA\b/i, ['nvidia.com']],
  ['Apple', '苹果', /\bApple\b(?=\s*(?:Inc|ML|Machine|Research|$|,))/i, ['apple.com']],
  ['Amazon', '亚马逊', /\bAmazon\b|\bAWS\b/i, ['amazon.com', 'amazon.science']],
  ['IBM Research', 'IBM 研究院', /\bIBM\b/i, ['ibm.com']],
  ['Salesforce', 'Salesforce', /\bSalesforce\b/i, ['salesforce.com']],
  ['Adobe', 'Adobe', /\bAdobe\b/i, ['adobe.com']],
  ['xAI', 'xAI', /\bxAI\b/, ['x.ai']],
  ['Mistral AI', 'Mistral AI', /\bMistral\s?AI\b/i, ['mistral.ai']],
  ['Cohere', 'Cohere', /\bCohere\b/i, ['cohere.com']],
  ['Hugging Face', 'Hugging Face', /\bHugging\s?Face\b/i, ['huggingface.co']],
  ['Allen Institute for AI', '艾伦人工智能研究所', /Allen Institute for (?:AI|Artificial)|\bAI2\b/i, ['allenai.org']],
  ['Alibaba', '阿里巴巴', /\bAlibaba\b|\bQwen\b|Tongyi|DAMO Academy/i, ['alibaba-inc.com', 'alibaba.com', 'taobao.com']],
  ['ByteDance', '字节跳动', /\bByte\s?Dance\b|\bSeed\b(?=\s*(?:Team|,|$))/i, ['bytedance.com']],
  ['Tencent', '腾讯', /\bTencent\b/i, ['tencent.com']],
  ['Baidu', '百度', /\bBaidu\b/i, ['baidu.com']],
  ['Huawei', '华为', /\bHuawei\b|Noah'?s Ark/i, ['huawei.com']],
  ['DeepSeek', '深度求索', /\bDeepSeek\b/i, ['deepseek.com']],
  ['Moonshot AI', '月之暗面', /\bMoonshot\b/i, ['moonshot.cn']],
  ['Zhipu AI', '智谱', /\bZhipu\b/i, ['zhipuai.cn']],
  ['MiniMax', 'MiniMax', /\bMiniMax\b/i, ['minimaxi.com']],
  ['Shanghai AI Laboratory', '上海人工智能实验室', /Shanghai (?:AI|Artificial Intelligence) Lab/i, ['pjlab.org.cn']],
  ['BAAI', '北京智源人工智能研究院', /\bBAAI\b|Beijing Academy of Artificial Intelligence/i, ['baai.ac.cn']],
  ['Samsung', '三星', /\bSamsung\b/i, ['samsung.com']],
  ['Sony AI', '索尼 AI', /\bSony\b/i, ['sony.com']],
  ['Kuaishou', '快手', /\bKuaishou\b|\bKling\b/i, ['kuaishou.com']],
  ['Meituan', '美团', /\bMeituan\b/i, ['meituan.com']],
  ['JD', '京东', /\bJD\.com\b|\bJD Explore\b/i, ['jd.com']],
  ['Xiaomi', '小米', /\bXiaomi\b/i, ['xiaomi.com']],
  ['Ant Group', '蚂蚁集团', /\bAnt Group\b/i, ['antgroup.com']],
  // universities and institutes, United States
  ['Stanford University', '斯坦福大学', /\bStanford\b/i, ['stanford.edu']],
  ['MIT', '麻省理工学院', /Massachusetts Institute of Technology|\bMIT\b(?!\s*License)/, ['mit.edu']],
  ['Carnegie Mellon University', '卡内基梅隆大学', /Carnegie Mellon|\bCMU\b/i, ['cmu.edu']],
  ['UC Berkeley', '加州大学伯克利分校', /\bBerkeley\b/i, ['berkeley.edu']],
  ['Harvard University', '哈佛大学', /\bHarvard\b/i, ['harvard.edu']],
  ['Princeton University', '普林斯顿大学', /\bPrinceton\b/i, ['princeton.edu']],
  ['Yale University', '耶鲁大学', /\bYale\b/i, ['yale.edu']],
  ['Columbia University', '哥伦比亚大学', /\bColumbia University\b/i, ['columbia.edu']],
  ['Cornell University', '康奈尔大学', /\bCornell\b/i, ['cornell.edu']],
  ['New York University', '纽约大学', /New York University|\bNYU\b/i, ['nyu.edu']],
  ['University of Washington', '华盛顿大学', /University of Washington/i, ['washington.edu', 'uw.edu']],
  ['UCLA', '加州大学洛杉矶分校', /\bUCLA\b|University of California,? Los Angeles/i, ['ucla.edu']],
  ['UC San Diego', '加州大学圣地亚哥分校', /\bUCSD\b|UC San Diego|University of California,? San Diego/i, ['ucsd.edu']],
  ['UIUC', '伊利诺伊大学厄巴纳-香槟分校', /Urbana[- ]Champaign|\bUIUC\b/i, ['illinois.edu']],
  ['University of Michigan', '密歇根大学', /University of Michigan/i, ['umich.edu']],
  ['Georgia Tech', '佐治亚理工学院', /Georgia (?:Institute of )?Tech/i, ['gatech.edu']],
  ['UT Austin', '得克萨斯大学奥斯汀分校', /University of Texas at Austin|\bUT Austin\b/i, ['utexas.edu']],
  ['University of Maryland', '马里兰大学', /University of Maryland/i, ['umd.edu']],
  ['Johns Hopkins University', '约翰斯·霍普金斯大学', /Johns Hopkins/i, ['jhu.edu']],
  ['University of Pennsylvania', '宾夕法尼亚大学', /University of Pennsylvania|\bUPenn\b/i, ['upenn.edu']],
  ['USC', '南加州大学', /University of Southern California|\bUSC\b/, ['usc.edu']],
  ['Caltech', '加州理工学院', /California Institute of Technology|\bCaltech\b/i, ['caltech.edu']],
  ['UW–Madison', '威斯康星大学麦迪逊分校', /Wisconsin[- ]Madison/i, ['wisc.edu']],
  ['Northwestern University', '西北大学', /Northwestern University/i, ['northwestern.edu']],
  ['Duke University', '杜克大学', /\bDuke University\b/i, ['duke.edu']],
  ['UNC Chapel Hill', '北卡罗来纳大学教堂山分校', /Chapel Hill/i, ['unc.edu']],
  ['Ohio State University', '俄亥俄州立大学', /Ohio State/i, ['osu.edu']],
  ['Purdue University', '普渡大学', /\bPurdue\b/i, ['purdue.edu']],
  ['UMass Amherst', '马萨诸塞大学阿默斯特分校', /Massachusetts Amherst/i, ['umass.edu']],
  ['Rice University', '莱斯大学', /\bRice University\b/i, ['rice.edu']],
  ['University of Chicago', '芝加哥大学', /University of Chicago/i, ['uchicago.edu']],
  ['TTIC', '芝加哥丰田技术学院', /Toyota Technological Institute|\bTTIC\b/i, ['ttic.edu']],
  ['Brown University', '布朗大学', /\bBrown University\b/i, ['brown.edu']],
  ['UC Santa Barbara', '加州大学圣塔芭芭拉分校', /Santa Barbara|\bUCSB\b/i, ['ucsb.edu']],
  ['UC Irvine', '加州大学尔湾分校', /\bUC Irvine\b|University of California,? Irvine/i, ['uci.edu']],
  ['UC Davis', '加州大学戴维斯分校', /\bUC Davis\b|University of California,? Davis/i, ['ucdavis.edu']],
  ['Virginia Tech', '弗吉尼亚理工大学', /Virginia Tech/i, ['vt.edu']],
  ['Stony Brook University', '石溪大学', /Stony Brook/i, ['stonybrook.edu']],
  // Canada, Europe, Middle East
  ['University of Toronto', '多伦多大学', /University of Toronto/i, ['utoronto.ca', 'toronto.edu']],
  ['Mila', 'Mila', /\bMila\b/, ['mila.quebec']],
  ['Vector Institute', 'Vector 研究所', /Vector Institute/i, ['vectorinstitute.ai']],
  ['McGill University', '麦吉尔大学', /\bMcGill\b/i, ['mcgill.ca']],
  ['Université de Montréal', '蒙特利尔大学', /Montr[ée]al/i, ['umontreal.ca']],
  ['University of Waterloo', '滑铁卢大学', /University of Waterloo/i, ['uwaterloo.ca']],
  ['University of Alberta', '阿尔伯塔大学', /University of Alberta/i, ['ualberta.ca']],
  ['University of Oxford', '牛津大学', /\bOxford\b/i, ['ox.ac.uk']],
  ['University of Cambridge', '剑桥大学', /University of Cambridge/i, ['cam.ac.uk']],
  ['Imperial College London', '帝国理工学院', /Imperial College/i, ['imperial.ac.uk']],
  ['UCL', '伦敦大学学院', /University College London|\bUCL\b/, ['ucl.ac.uk']],
  ['University of Edinburgh', '爱丁堡大学', /University of Edinburgh/i, ['ed.ac.uk']],
  ['ETH Zurich', '苏黎世联邦理工学院', /\bETH\b|Eidgen/i, ['ethz.ch']],
  ['EPFL', '洛桑联邦理工学院', /\bEPFL\b|[ÉE]cole Polytechnique F[ée]d[ée]rale de Lausanne/i, ['epfl.ch']],
  ['Max Planck Institute', '马克斯·普朗克研究所', /Max Planck/i, ['mpg.de']],
  ['TU Munich', '慕尼黑工业大学', /Technical University of Munich|\bTUM\b|Technische Universit[äa]t M[üu]nchen/i, ['tum.de']],
  ['LMU Munich', '慕尼黑大学', /\bLMU\b|Ludwig[- ]Maximilian/i, ['lmu.de']],
  ['University of Tübingen', '图宾根大学', /T[üu]bingen/i, ['uni-tuebingen.de']],
  ['University of Amsterdam', '阿姆斯特丹大学', /University of Amsterdam/i, ['uva.nl']],
  ['Inria', '法国国家信息与自动化研究所', /\bInria\b/i, ['inria.fr']],
  ['KAUST', '阿卜杜拉国王科技大学', /\bKAUST\b|King Abdullah University/i, ['kaust.edu.sa']],
  ['MBZUAI', '穆罕默德·本·扎耶德人工智能大学', /\bMBZUAI\b|Mohamed bin Zayed/i, ['mbzuai.ac.ae']],
  ['Weizmann Institute', '魏茨曼科学研究所', /Weizmann/i, ['weizmann.ac.il']],
  ['Technion', '以色列理工学院', /\bTechnion\b/i, ['technion.ac.il']],
  ['Tel Aviv University', '特拉维夫大学', /Tel Aviv University/i, ['tau.ac.il']],
  // Asia and Oceania
  ['Tsinghua University', '清华大学', /\bTsinghua\b/i, ['tsinghua.edu.cn']],
  ['Peking University', '北京大学', /Peking University|\bPKU\b/i, ['pku.edu.cn']],
  ['Shanghai Jiao Tong University', '上海交通大学', /Shanghai Jiao ?Tong|\bSJTU\b/i, ['sjtu.edu.cn']],
  ['Zhejiang University', '浙江大学', /Zhejiang University|\bZJU\b/i, ['zju.edu.cn']],
  ['Fudan University', '复旦大学', /\bFudan\b/i, ['fudan.edu.cn']],
  ['USTC', '中国科学技术大学', /University of Science and Technology of China|\bUSTC\b/i, ['ustc.edu.cn']],
  ['Nanjing University', '南京大学', /\bNanjing University\b(?! of)/i, ['nju.edu.cn']],
  ['Renmin University of China', '中国人民大学', /Renmin University/i, ['ruc.edu.cn']],
  ['Harbin Institute of Technology', '哈尔滨工业大学', /Harbin Institute of Technology|\bHIT\b/, ['hit.edu.cn']],
  ['Beihang University', '北京航空航天大学', /\bBeihang\b/i, ['buaa.edu.cn']],
  ['Beijing Institute of Technology', '北京理工大学', /Beijing Institute of Technology|\bBIT\b/, ['bit.edu.cn']],
  ['Sun Yat-sen University', '中山大学', /Sun Yat[- ]?sen/i, ['sysu.edu.cn', 'mail.sysu.edu.cn']],
  ['Wuhan University', '武汉大学', /\bWuhan University\b/i, ['whu.edu.cn']],
  ['Huazhong University of Science and Technology', '华中科技大学', /Huazhong University|\bHUST\b/i, ['hust.edu.cn']],
  ['Xi’an Jiaotong University', '西安交通大学', /Xi'?an Jiao ?tong/i, ['xjtu.edu.cn']],
  ['Southern University of Science and Technology', '南方科技大学', /Southern University of Science and Technology|\bSUSTech\b/i, ['sustech.edu.cn']],
  ['Westlake University', '西湖大学', /\bWestlake\b/i, ['westlake.edu.cn']],
  ['ShanghaiTech University', '上海科技大学', /\bShanghaiTech\b/i, ['shanghaitech.edu.cn']],
  ['Tongji University', '同济大学', /\bTongji\b/i, ['tongji.edu.cn']],
  ['University of Chinese Academy of Sciences', '中国科学院大学', /University of (?:the )?Chinese Academy of Sciences|\bUCAS\b/i, ['ucas.ac.cn', 'ucas.edu.cn']],
  ['Institute of Automation, CAS', '中国科学院自动化研究所', /Institute of Automation/i, ['ia.ac.cn']],
  ['Institute of Computing Technology, CAS', '中国科学院计算技术研究所', /Institute of Computing Technology/i, ['ict.ac.cn']],
  ['Chinese Academy of Sciences', '中国科学院', /Chinese Academy of Sciences|\bCAS\b/, ['cas.cn']],
  ['Hong Kong University of Science and Technology', '香港科技大学', /Hong Kong University of Science and Technology|\bHKUST\b/i, ['ust.hk', 'connect.ust.hk']],
  ['The University of Hong Kong', '香港大学', /University of Hong Kong|\bHKU\b/i, ['hku.hk', 'connect.hku.hk']],
  ['The Chinese University of Hong Kong', '香港中文大学', /Chinese University of Hong Kong|\bCUHK\b/i, ['cuhk.edu.hk', 'link.cuhk.edu.hk']],
  ['City University of Hong Kong', '香港城市大学', /City University of Hong Kong|\bCityU\b/i, ['cityu.edu.hk']],
  ['Hong Kong Polytechnic University', '香港理工大学', /Hong Kong Polytechnic|\bPolyU\b/i, ['polyu.edu.hk']],
  ['National University of Singapore', '新加坡国立大学', /National University of Singapore|\bNUS\b/, ['nus.edu.sg', 'u.nus.edu']],
  ['Nanyang Technological University', '南洋理工大学', /Nanyang Technological|\bNTU\b(?!\s*Taiwan)/, ['ntu.edu.sg', 'e.ntu.edu.sg']],
  ['KAIST', '韩国科学技术院', /\bKAIST\b/i, ['kaist.ac.kr', 'kaist.edu']],
  ['Seoul National University', '首尔大学', /Seoul National University|\bSNU\b/i, ['snu.ac.kr']],
  ['University of Tokyo', '东京大学', /University of Tokyo/i, ['u-tokyo.ac.jp']],
  ['RIKEN', '日本理化学研究所', /\bRIKEN\b/i, ['riken.jp']],
  ['National Taiwan University', '台湾大学', /National Taiwan University/i, ['ntu.edu.tw']],
  ['University of Melbourne', '墨尔本大学', /University of Melbourne/i, ['unimelb.edu.au']],
  ['University of Sydney', '悉尼大学', /University of Sydney/i, ['sydney.edu.au']],
  ['Monash University', '莫纳什大学', /\bMonash\b/i, ['monash.edu']],
  ['IIT', '印度理工学院', /Indian Institute of Technology|\bIIT\b/, ['iitb.ac.in', 'iitd.ac.in', 'iitm.ac.in', 'iitk.ac.in']],
  ['IISc', '印度科学理工学院', /Indian Institute of Science|\bIISc\b/i, ['iisc.ac.in']],
];
// e-mail services that say nothing about where someone works
const PERSONAL = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|mac|qq|163|126|foxmail|proton(mail)?|pm|yandex|mail|gmx|aol|sina|sohu|aliyun|naver|hanmail)\./i;

// The tidy institution for one written affiliation (or e-mail domain), or null.
function known(text) {
  for (const k of KNOWN) if (k[2].test(text)) return { n: k[0], zh: k[1], k: 1 };
  return null;
}
function fromDomain(domain) {
  const d = domain.toLowerCase();
  if (PERSONAL.test(d)) return null;
  for (const k of KNOWN) if (k[3].some((x) => d === x || d.endsWith(`.${x}`))) return { n: k[0], zh: k[1], k: 1 };
  return null;
}
// An affiliation not in the list: its main part ("Dept. of CS, Some University, City, Country" -> "Some University")
const MAIN = /(Universit|Institute|Instituto|Institut|College|Academy|Laborator|\bLab\b|Research|School|Center|Centre|Inc\b|Corp|Company|Technologies|大学|学院|研究院|研究所|实验室)/i;
function generic(text) {
  const parts = text.split(/\s*[,;]\s*/).map((s) => s.trim()).filter(Boolean);
  const pick = parts.find((s) => /Universit|大学/i.test(s)) || parts.find((s) => MAIN.test(s) && !/^(Department|Dept|School of|Faculty|Division|Center for|Centre for)\b/i.test(s)) || parts.find((s) => MAIN.test(s));
  if (!pick || pick.length < 4 || pick.length > 80 || /@|https?:|orcid|\d{4}-\d{4}/i.test(pick)) return null;
  return { n: pick.replace(/^the\s+/i, '').replace(/\s+/g, ' '), zh: '', k: 0 };
}
export function canonical(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return known(s) || generic(s);
}
// An OpenAlex institution name: tidy already; the list adds the Chinese name and "well known"
export function fromOpenAlex(name) {
  return known(String(name || '')) || { n: String(name || ''), zh: '', k: 0 };
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
const text = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// From an arXiv HTML page (or its first part): the institutions in its author block, in the order written.
export function affiliationsFromHtml(html) {
  if (!html) return null;
  const a = html.indexOf('class="ltx_authors"');
  if (a < 0) return null;
  let b = html.indexOf('class="ltx_abstract"', a);
  if (b < 0 || b - a > 30000) b = a + 30000;
  const block = html.slice(a, b);
  const out = [], seen = new Set();
  const add = (x) => { if (x && !seen.has(x.n.toLowerCase())) { seen.add(x.n.toLowerCase()); out.push(x); } };
  // written affiliations ("Affiliation: …", or a note marked as one)
  for (const m of block.matchAll(/class="[^"]*ltx_role_(?:affiliation|address)[^"]*"[^>]*>([\s\S]*?)<\/span>\s*(?=<|$)/g)) {
    const t = text(m[1]).replace(/^(?:Affiliation|Address)\s*:\s*/i, '').replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '').replace(/ORCID:?\s*[\d-X]+/gi, '').replace(/^[†‡*§¶\d\s,]+/, '').trim();
    if (t.length >= 3) for (const piece of t.split(/\s*(?:;|\band\b(?= [A-Z][a-z]+ (?:University|Institute)))\s*/)) add(canonical(piece));
  }
  // e-mail domains, for papers that give only addresses
  for (const m of block.matchAll(/[\w.+-]+@((?:[\w-]+\.)+[a-z]{2,})/gi)) add(fromDomain(m[1]));
  return out.slice(0, 8);
}
