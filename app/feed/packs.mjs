// Discipline packs: which part of research the app follows. Each pack has its own directions (the chips), arXiv
// categories, top journals and conferences, terminology for translation, and how the AI is told whom it is
// helping. Each pack also keeps its own library (the desktop app: feed/ for AI, feed-<id>/ for the others; the
// phone and web: files named <id>/...); AI settings and the key are shared.
// Shared by the desktop app, the phone app and the web version. usePack(id) switches everything at start-up.

import { setTopics, AI_TOPICS, AI_CATS } from './topics.mjs';
import { setVenues } from './venues.mjs';

// ---------- materials science ----------
const MAT_CATS = '(cat:cond-mat.mtrl-sci OR cat:cond-mat.soft OR cat:cond-mat.mes-hall OR cat:cond-mat.str-el OR cat:cond-mat.supr-con OR cat:physics.chem-ph OR cat:physics.app-ph OR cat:physics.comp-ph)';
const MAT_TOPICS = [
  { id: 'energy-storage', en: 'Batteries & storage', zh: '电池与储能', color: 'blue',
    q: '(abs:battery OR abs:batteries OR abs:"lithium-ion" OR abs:"sodium-ion" OR abs:"solid-state electrolyte" OR abs:"solid electrolyte" OR abs:cathode OR abs:anode OR abs:supercapacitor)',
    kw: [/batter(y|ies)|lithium[- ]ion|sodium[- ]ion|solid[- ]state electrolyte|solid electrolyte|\bcathodes?\b|\banodes?\b|supercapacitor|energy storage/i] },
  { id: 'catalysis', en: 'Catalysis & electrochemistry', zh: '催化与电化学', color: 'green',
    q: '(abs:catalyst OR abs:catalysis OR abs:electrocatalyst OR abs:electrocatalysis OR abs:photocatalyst OR abs:photocatalysis OR abs:"oxygen evolution" OR abs:"hydrogen evolution" OR abs:"CO2 reduction")',
    kw: [/cataly|oxygen evolution|hydrogen evolution|\bOER\b|\bHER\b|\bORR\b|CO2 reduction|nitrogen reduction|electrochemi/i] },
  { id: 'photovoltaics', en: 'Photovoltaics & optoelectronics', zh: '光伏与光电', color: 'yellow',
    q: '(abs:perovskite OR abs:photovoltaic OR abs:"solar cell" OR abs:"solar cells" OR abs:"light-emitting" OR abs:photodetector)',
    kw: [/perovskite|photovoltai|solar cells?|light[- ]emitting|\bLEDs?\b|photodetector|optoelectronic/i] },
  { id: '2d', en: '2D materials', zh: '二维材料', color: 'sky',
    q: '(abs:graphene OR abs:"two-dimensional" OR abs:"2D material" OR abs:"2D materials" OR abs:"transition metal dichalcogenide" OR abs:MoS2 OR abs:"van der Waals" OR abs:moire)',
    kw: [/graphene|two[- ]dimensional|\b2D (materials?|semiconductors?|magnets?)|dichalcogenide|\bMoS2\b|\bWSe2\b|van der Waals|moir[eé]|\bhBN\b/i] },
  { id: 'quantum', en: 'Quantum & topological', zh: '量子与拓扑材料', color: 'ink',
    q: '(abs:topological OR abs:superconductor OR abs:superconductivity OR abs:"quantum material" OR abs:"quantum materials" OR abs:"spin liquid" OR abs:Weyl OR abs:"strongly correlated")',
    kw: [/topolog|superconduct|quantum materials?|spin liquid|\bWeyl\b|Dirac semimetal|strongly correlated|kagome|heavy fermion/i] },
  { id: 'magnetic', en: 'Magnetism & spintronics', zh: '磁性与自旋电子', color: 'rose',
    q: '(abs:ferromagnet OR abs:ferromagnetic OR abs:antiferromagnet OR abs:antiferromagnetic OR abs:spintronic OR abs:spintronics OR abs:skyrmion OR abs:magnon OR abs:multiferroic)',
    kw: [/ferromagne|antiferromagne|spintronic|skyrmion|magnon|multiferroic|magnetic (order|anisotropy|materials?)/i] },
  { id: 'electronic', en: 'Semiconductors & electronic', zh: '半导体与电子材料', color: 'slate',
    q: '(abs:semiconductor OR abs:"thin film" OR abs:"thin films" OR abs:dielectric OR abs:transistor OR abs:ferroelectric OR abs:piezoelectric OR abs:thermoelectric)',
    kw: [/semiconductor|thin[- ]films?|dielectric|transistor|ferroelectric|piezoelectric|thermoelectric/i] },
  { id: 'soft', en: 'Polymers & soft matter', zh: '高分子与软物质', color: 'red',
    q: '(abs:polymer OR abs:polymers OR abs:hydrogel OR abs:elastomer OR abs:"soft matter" OR abs:colloid OR abs:colloidal OR abs:"liquid crystal")',
    kw: [/polymer|hydrogel|elastomer|soft matter|colloid|liquid crystal|copolymer/i] },
  { id: 'structural', en: 'Metals, alloys & structural', zh: '金属、合金与结构材料', color: 'sand',
    q: '(abs:alloy OR abs:alloys OR abs:"high-entropy" OR abs:steel OR abs:"grain boundary" OR abs:dislocation OR abs:"mechanical properties" OR abs:"additive manufacturing")',
    kw: [/alloys?\b|high[- ]entropy|\bsteels?\b|grain boundar|dislocation|mechanical propert|additive manufactur|fracture|plasticity/i] },
  { id: 'porous', en: 'Porous materials (MOF/COF)', zh: '多孔材料', color: 'yellow',
    q: '(abs:"metal-organic framework" OR abs:"metal-organic frameworks" OR abs:"covalent organic framework" OR abs:"covalent organic frameworks" OR abs:zeolite OR abs:zeolites OR abs:porous)',
    kw: [/metal[- ]organic frameworks?|\bMOFs?\b|covalent organic frameworks?|\bCOFs?\b|zeolite|porous/i] },
  { id: 'ceramics', en: 'Ceramics, oxides & glasses', zh: '陶瓷、氧化物与玻璃', color: 'sand',
    q: '(abs:ceramic OR abs:ceramics OR abs:"oxide" OR abs:glass OR abs:glasses OR abs:composite OR abs:composites)',
    kw: [/ceramic|\boxides?\b|\bglass(es|y)?\b|composites?\b|sintering/i] },
  { id: 'computational', en: 'Computational materials', zh: '计算材料（第一性原理/分子动力学）', color: 'blue',
    q: '(abs:"density functional theory" OR abs:"first-principles" OR abs:"first principles" OR abs:"ab initio" OR abs:"molecular dynamics")',
    cats: '(cat:cond-mat.mtrl-sci OR cat:physics.comp-ph)', // not quantum chemistry of single molecules
    kw: [/density functional|first[- ]principles|ab initio|molecular dynamics|\bDFT\b|phonon/i] },
  // the bridge to AI: machine learning for materials (also from cs.LG, when the abstract is about materials)
  { id: 'ai4mat', en: 'AI for materials', zh: 'AI 材料发现', color: 'ink',
    q: '(abs:"machine learning" OR abs:"deep learning" OR abs:"neural network" OR abs:"graph neural network" OR abs:"generative model" OR abs:"interatomic potential" OR abs:"foundation model" OR abs:"large language model")',
    cats: '(cat:cond-mat.mtrl-sci OR cat:physics.comp-ph OR cat:physics.chem-ph OR (cat:cs.LG AND (abs:materials OR abs:crystal OR abs:crystals OR abs:"interatomic potential")))',
    kw: [/machine[- ]learning|deep learning|neural network|interatomic potential|generative model|foundation model|\bLLMs?\b|active learning|high[- ]throughput|materials discovery|inverse design/i] },
];
// leading journals (and the abbreviations a journal reference uses); more specific names first
const j = (label, re) => [label, re];
const MAT_VENUES = [
  j('Nature Materials', /Nature Materials|\bNat\.?\s*Mater\b/i),
  j('Nature Nanotechnology', /Nature Nanotechnology|\bNat\.?\s*Nanotechnol/i),
  j('Nature Energy', /Nature Energy|\bNat\.?\s*Energy\b/i),
  j('Nature Catalysis', /Nature Catalysis|\bNat\.?\s*Catal/i),
  j('Nature Chemistry', /Nature Chemistry|\bNat\.?\s*Chem\b/i),
  j('Nature Physics', /Nature Physics|\bNat\.?\s*Phys\b/i),
  j('Nature Communications', /Nature Communications|\bNat\.?\s*Commun/i),
  j('Science Advances', /Science Advances|\bSci\.?\s*Adv\b/i),
  j('Joule', /\bJoule\b/),
  j('Matter', /\bin\s+Matter\b|^Matter\b/),
  j('Adv. Energy Mater.', /Advanced Energy Materials|\bAdv\.?\s*Energy\s*Mater/i),
  j('Adv. Funct. Mater.', /Advanced Functional Materials|\bAdv\.?\s*Funct\.?\s*Mater/i),
  j('Adv. Mater.', /Advanced Materials(?!\s*(?:Interfaces|Technologies))|\bAdv\.?\s*Mater\b(?!\.?\s*(?:Interfaces|Technol))/i),
  j('Energy Environ. Sci.', /Energy (?:&|and) Environmental Science|\bEnergy\s*Environ\.?\s*Sci/i),
  j('JACS', /Journal of the American Chemical Society|\bJ\.?\s*Am\.?\s*Chem\.?\s*Soc\b|\bJACS\b/i),
  j('Angew. Chem.', /Angewandte Chemie|\bAngew\.?\s*Chem/i),
  j('Nano Letters', /Nano Letters|\bNano\s*Lett\b/i),
  j('ACS Nano', /\bACS\s*Nano\b/i),
  j('ACS Energy Lett.', /ACS Energy Letters|\bACS\s*Energy\s*Lett/i),
  j('Chem. Mater.', /Chemistry of Materials|\bChem\.?\s*Mater\b/i),
  j('PRL', /Physical Review Letters|\bPhys\.?\s*Rev\.?\s*Lett\b|\bPRL\b/i),
  j('PRX', /Physical Review X\b|\bPhys\.?\s*Rev\.?\s*X\b|\bPRX\b/i),
  j('Phys. Rev. Materials', /Physical Review Materials|\bPhys\.?\s*Rev\.?\s*Mater/i),
  j('npj Comput. Mater.', /npj Computational Materials|\bnpj\s*Comput/i),
  j('Acta Materialia', /Acta Materialia|\bActa\s*Mater\b/i),
  j('Materials Today', /Materials Today|\bMater\.?\s*Today\b/i),
  j('Nature', /\b(?:in|by|at)\s+(?:the\s+journal\s+)?Nature(?=\s*(?:[,.;)]|\d|$))|^Nature\s+\d/),
  j('Science', /\b(?:in|by|at)\s+(?:the\s+journal\s+)?Science(?=\s*(?:[,.;)]|\d|$))|^Science\s+\d/),
];
// arXiv's journal-reference field (jr:), for the "Top journals" feed
const MAT_VENUE_QUERY = '(' + ['"Nature Materials"', '"Nat. Mater."', '"Nature Communications"', '"Nat. Commun."', '"Adv. Mater."', '"Advanced Materials"', '"Phys. Rev. Lett."', '"Physical Review Letters"', '"Nano Lett."', '"ACS Nano"', '"J. Am. Chem. Soc."', 'Joule', '"Energy Environ. Sci."', '"Sci. Adv."', '"npj Comput. Mater."', '"Phys. Rev. X"', '"Nature Energy"', '"Nature Nanotechnology"']
  .map((v) => `jr:${v}`).join(' OR ') + ')';

export const PACKS = {
  ai: {
    id: 'ai', en: 'AI & machine learning', zh: '人工智能', short: { en: 'AI', zh: 'AI' },
    reader: 'an AI researcher', field: 'machine-learning', hf: true,
    terms: 'model names, method names, benchmarks, metrics and numbers',
    glossary: 'reinforcement learning → 强化学习, agent → 智能体, world model → 世界模型, large language model → 大语言模型, benchmark → 基准',
    keep: 'method names, model names, dataset and benchmark names, and acronyms (for example GRPO, LLM, ALFWorld, SWE-bench)',
    rateBar: 'a strong main-track paper at NeurIPS, ICML or ICLR',
    categories: 'cs.CL, cs.LG, cs.AI, cs.CV, cs.RO, cs.MA, cs.SE, cs.IR, stat.ML',
    venuesLabel: null, // "Top venues" / 顶会顶刊
  },
  materials: {
    id: 'materials', en: 'Materials science', zh: '材料科学', short: { en: 'Materials', zh: '材料' },
    reader: 'a materials scientist', field: 'materials-science', hf: false,
    terms: 'material names, chemical formulas, methods, units and numbers',
    glossary: 'perovskite → 钙钛矿, electrocatalyst → 电催化剂, high-entropy alloy → 高熵合金, first-principles → 第一性原理, density functional theory → 密度泛函理论, metal-organic framework → 金属有机框架, solid-state electrolyte → 固态电解质, cathode → 正极, anode → 负极, thin film → 薄膜, grain boundary → 晶界, dislocation → 位错, superconductivity → 超导, topological → 拓扑, van der Waals → 范德华, moiré → 莫尔, interatomic potential → 原子间势',
    keep: 'chemical formulas, material and compound names, method names (DFT, MD, XRD, TEM) and acronyms (MOF, COF, OER, HER)',
    rateBar: 'publishable in a leading journal such as Nature Materials, Advanced Materials or JACS',
    categories: 'cond-mat.mtrl-sci, cond-mat.soft, cond-mat.mes-hall, cond-mat.str-el, cond-mat.supr-con, physics.chem-ph, physics.app-ph, physics.comp-ph (and cs.LG for machine learning on materials)',
    venuesLabel: { en: 'Top journals', zh: '顶刊' },
    topics: MAT_TOPICS, cats: MAT_CATS, venues: MAT_VENUES, venueQuery: MAT_VENUE_QUERY,
  },
};
export const PACK_LIST = Object.values(PACKS).map(({ id, en, zh, short }) => ({ id, en, zh, short }));

let current = PACKS.ai;
export const pack = () => current;
export function usePack(id) {
  current = PACKS[id] || PACKS.ai;
  setTopics(current.topics || AI_TOPICS, current.cats || AI_CATS);
  setVenues(current.venues || null);
  return current;
}
// the folder (desktop) or file prefix (phone, web) of a pack's library
export const packDir = (id) => (!PACKS[id] || id === 'ai' ? 'feed' : `feed-${id}`);
