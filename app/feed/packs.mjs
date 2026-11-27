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

// ---------- life sciences and medicine (Europe PMC: PubMed, PMC and bioRxiv/medRxiv preprints) ----------
// q: a Europe PMC query (TITLE_ABS: title and abstract); kw: how a paper is tagged with the direction
const TA = (...terms) => `TITLE_ABS:(${terms.map((x) => (/\s|-/.test(x) ? `"${x}"` : x)).join(' OR ')})`;
const LIFE_TOPICS = [
  { id: 'genomics', en: 'Genomics & sequencing', zh: '基因组与测序', color: 'blue',
    q: TA('genome sequencing', 'whole-genome', 'GWAS', 'genome-wide association', 'long-read sequencing', 'epigenome', 'epigenomic', 'genome assembly', 'chromatin accessibility'),
    kw: [/genom(e|ic|ics)\b|sequencing|\bGWAS\b|genome[- ]wide|epigen|chromatin|methylation/i] },
  { id: 'single-cell', en: 'Single-cell & spatial omics', zh: '单细胞与空间组学', color: 'sky',
    q: TA('single-cell', 'single cell', 'scRNA-seq', 'spatial transcriptomics', 'spatial omics', 'single-nucleus'),
    kw: [/single[- ](cell|nucleus)|scRNA|snRNA|spatial (transcriptom|omics|proteom)/i] },
  { id: 'gene-editing', en: 'Gene editing', zh: '基因编辑', color: 'red',
    q: TA('CRISPR', 'base editing', 'prime editing', 'gene editing', 'genome editing', 'Cas9', 'Cas12', 'Cas13'),
    kw: [/CRISPR|\bCas(9|12|13)\b|base edit|prime edit|gene editing|genome editing/i] },
  { id: 'protein', en: 'Proteins & structural biology', zh: '蛋白质与结构生物学', color: 'yellow',
    q: TA('protein structure', 'cryo-EM', 'cryo-electron', 'AlphaFold', 'protein design', 'structural biology', 'protein folding', 'crystal structure'),
    kw: [/protein (structure|design|folding)|cryo-?EM|cryo-electron|AlphaFold|structural biology|crystal structure|de novo protein/i] },
  { id: 'cell-dev', en: 'Cells & development', zh: '细胞与发育', color: 'sand',
    q: TA('organoid', 'organoids', 'stem cell', 'stem cells', 'cell fate', 'embryo', 'embryonic', 'developmental biology', 'autophagy', 'cell division'),
    kw: [/organoid|stem cells?|cell fate|embryo|developmental|autophagy|cell (division|cycle|migration)|differentiation/i] },
  { id: 'neuro', en: 'Neuroscience', zh: '神经科学', color: 'ink',
    q: TA('neuron', 'neurons', 'neural circuit', 'neural circuits', 'synapse', 'synaptic', 'cortex', 'hippocampus', 'neural activity'),
    kw: [/neuron|neural circuit|synap|cortex|cortical|hippocamp|neurotransmit|brain/i] },
  { id: 'immunology', en: 'Immunology', zh: '免疫学', color: 'rose',
    q: TA('T cell', 'T cells', 'B cell', 'immune response', 'innate immunity', 'adaptive immunity', 'antibody', 'antibodies', 'macrophage', 'cytokine'),
    kw: [/\b[TB][- ]cells?\b|immun|antibod|macrophage|cytokine|inflammat|lymphocyte/i] },
  { id: 'microbes', en: 'Microbes & viruses', zh: '微生物与病毒', color: 'green',
    q: TA('microbiome', 'microbiota', 'bacteria', 'bacterial', 'virus', 'viral', 'bacteriophage', 'phage', 'pathogen'),
    kw: [/microbio(me|ta)|bacteri|\bviru(s|ses)\b|viral|phage|pathogen|fung(i|al)/i] },
  { id: 'synbio', en: 'Synthetic biology', zh: '合成生物学', color: 'slate',
    q: TA('synthetic biology', 'metabolic engineering', 'genetic circuit', 'directed evolution', 'biosynthesis', 'cell-free'),
    kw: [/synthetic biology|metabolic engineering|genetic circuit|directed evolution|biosynth|cell-free/i] },
  { id: 'ai-bio', en: 'Computational biology & AI', zh: '计算生物学与 AI', color: 'ink',
    q: `${TA('deep learning', 'machine learning', 'language model', 'foundation model', 'neural network', 'bioinformatics', 'computational biology')} AND ${TA('protein', 'gene', 'genomic', 'cell', 'sequence', 'molecular')}`,
    kw: [/deep learning|machine learning|language model|foundation model|neural network|bioinformatic|computational biology|in silico/i] },
];
const MED_TOPICS = [
  { id: 'oncology', en: 'Oncology', zh: '肿瘤', color: 'red',
    q: TA('cancer', 'tumor', 'tumour', 'carcinoma', 'oncology', 'leukemia', 'lymphoma', 'melanoma'),
    kw: [/cancer|tumou?r|carcinoma|oncolog|leuk(a)?emia|lymphoma|melanoma|metasta/i] },
  { id: 'cardiometabolic', en: 'Cardiovascular & metabolic', zh: '心血管与代谢', color: 'rose',
    q: TA('cardiovascular', 'heart failure', 'hypertension', 'atherosclerosis', 'myocardial infarction', 'atrial fibrillation', 'diabetes', 'obesity'),
    kw: [/cardiovascular|heart failure|hypertension|atheroscler|myocardial|atrial fibrillation|diabet|obesity|metabolic/i] },
  { id: 'infection', en: 'Infection & vaccines', zh: '感染与疫苗', color: 'green',
    q: TA('vaccine', 'vaccination', 'infection', 'antimicrobial resistance', 'antibiotic', 'COVID-19', 'SARS-CoV-2', 'HIV', 'tuberculosis', 'malaria'),
    kw: [/vaccin|infection|antimicrobial|antibiotic|COVID|SARS-CoV-2|\bHIV\b|tubercul|malaria|sepsis/i] },
  { id: 'neuropsych', en: 'Neurology & psychiatry', zh: '神经精神疾病', color: 'ink',
    q: TA("Alzheimer's", 'Alzheimer', 'Parkinson', 'dementia', 'stroke', 'epilepsy', 'depression', 'schizophrenia', 'autism'),
    kw: [/alzheimer|parkinson|dementia|stroke|epilep|depress|schizophren|autism|bipolar|psychiatr/i] },
  { id: 'drugs', en: 'Drug discovery & pharmacology', zh: '药物发现与药理', color: 'yellow',
    q: TA('drug discovery', 'drug design', 'pharmacology', 'pharmacokinetics', 'small molecule', 'drug repurposing', 'drug target', 'drug development'),
    kw: [/drug (discovery|design|repurpos|target|development)|pharmacolog|pharmacokinetic|small[- ]molecule|inhibitor/i] },
  { id: 'cell-gene-therapy', en: 'Cell & gene therapy', zh: '细胞与基因治疗', color: 'sky',
    q: TA('CAR-T', 'CAR T', 'gene therapy', 'cell therapy', 'AAV', 'adeno-associated', 'mRNA therapeutics', 'antisense oligonucleotide'),
    kw: [/CAR[- ]?T\b|gene therap|cell therap|\bAAV\b|adeno-associated|antisense|mRNA (therap|vaccine)/i] },
  { id: 'trials', en: 'Clinical trials & evidence', zh: '临床试验与循证', color: 'blue',
    q: '(PUB_TYPE:"Randomized Controlled Trial" OR PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Systematic Review" OR TITLE_ABS:"randomized controlled trial" OR TITLE_ABS:"randomised controlled trial")',
    kw: [/randomi[sz]ed|controlled trial|meta-analys|systematic review|phase (I{1,3}|[123])\b/i] },
  { id: 'epidemiology', en: 'Epidemiology & public health', zh: '流行病与公共卫生', color: 'sand',
    q: TA('epidemiology', 'epidemiological', 'public health', 'cohort study', 'prevalence', 'incidence', 'mortality', 'population-based'),
    kw: [/epidemiolog|public health|cohort|prevalence|incidence|mortality|population-based/i] },
  { id: 'imaging-ai', en: 'Medical imaging & AI diagnosis', zh: '医学影像与 AI 诊断', color: 'slate',
    q: `${TA('radiology', 'medical imaging', 'MRI', 'computed tomography', 'ultrasound', 'pathology slides', 'deep learning', 'artificial intelligence')} AND ${TA('diagnosis', 'diagnostic', 'detection', 'segmentation', 'classification', 'prognosis')}`,
    kw: [/radiolog|medical imag|\bMRI\b|computed tomography|\bCT\b|ultrasound|histopatholog|deep learning|artificial intelligence/i] },
];
// leading journals: Europe PMC gives a journal's full title ("Nature medicine", "The New England journal of medicine")
const J = (label, re) => [label, re];
const BIO_JOURNALS = [
  J('Nature Medicine', /^Nature medicine$/i), J('Nature Biotechnology', /^Nature biotechnology$/i), J('Nature Methods', /^Nature methods$/i),
  J('Nature Genetics', /^Nature genetics$/i), J('Nature Neuroscience', /^Nature neuroscience$/i), J('Nature Immunology', /^Nature immunology$/i),
  J('Nature Cell Biology', /^Nature cell biology$/i), J('Nature Microbiology', /^Nature microbiology$/i), J('Nature Struct. Mol. Biol.', /^Nature structural (?:&|and) molecular biology$/i),
  J('Nature Chemical Biology', /^Nature chemical biology$/i), J('Nature Cancer', /^Nature cancer$/i), J('Nature Metabolism', /^Nature metabolism$/i),
  J('Nature Communications', /^Nature communications$/i), J('Nature', /^Nature$/i),
  J('Cell Stem Cell', /^Cell stem cell$/i), J('Cancer Cell', /^Cancer cell$/i), J('Molecular Cell', /^Molecular cell$/i), J('Cell Metabolism', /^Cell metabolism$/i),
  J('Cell Host & Microbe', /^Cell host (?:&|and) microbe$/i), J('Cell', /^Cell$/i), J('Immunity', /^Immunity$/i), J('Neuron', /^Neuron$/i),
  J('Science Translational Medicine', /^Science translational medicine$/i), J('Science Advances', /^Science advances$/i), J('Science', /^Science(?: \(New York, N\.Y\.\))?$/i),
  J('NEJM', /^(?:The )?New England journal of medicine$/i), J('Lancet Oncology', /^(?:The )?Lancet\.? Oncology$/i), J('Lancet Infectious Diseases', /^(?:The )?Lancet\.? Infectious diseases$/i),
  J('Lancet', /^(?:The )?Lancet(?: \(London, England\))?$/i), J('JAMA Oncology', /^JAMA oncology$/i), J('JAMA', /^JAMA$/i), J('BMJ', /^BMJ(?: \(Clinical research ed\.\))?$/i),
  J('J Clin Oncol', /^Journal of clinical oncology/i), J('Circulation', /^Circulation$/i), J('European Heart Journal', /^European heart journal$/i),
  J('PNAS', /^Proceedings of the National Academy of Sciences of the United States of America$/i), J('eLife', /^eLife$/i),
  J('Nucleic Acids Research', /^Nucleic acids research$/i), J('Genome Research', /^Genome research$/i), J('Genome Biology', /^Genome biology$/i),
];
const BIO_VENUE_QUERY = ['Nature', 'Science', 'Cell', 'Nature medicine', 'Nature biotechnology', 'Nature methods', 'Nature genetics', 'Nature neuroscience', 'Nature immunology',
  'Nature communications', 'Science translational medicine', 'Cell stem cell', 'Cancer cell', 'Molecular cell', 'Immunity', 'Neuron',
  'The New England journal of medicine', 'Lancet', 'JAMA', 'BMJ', 'Journal of clinical oncology', 'Circulation', 'European heart journal',
  'Proceedings of the National Academy of Sciences of the United States of America', 'eLife', 'Nucleic acids research', 'Genome research', 'Genome biology']
  .map((v) => `JOURNAL:"${v}"`).join(' OR ');
const BIO_COMMON = {
  source: 'epmc', hf: false, venuesLabel: { en: 'Top journals', zh: '顶刊' }, venues: BIO_JOURNALS, venueQuery: BIO_VENUE_QUERY,
  categories: 'Europe PMC fields: TITLE_ABS: (title and abstract), MESH: (MeSH heading), PUB_TYPE: ("Randomized Controlled Trial", "Meta-Analysis", "Review", "Preprint"), AUTH: (author), JOURNAL:',
};

export const PACKS = {
  ai: {
    id: 'ai', en: 'AI & machine learning', zh: '人工智能', short: { en: 'AI', zh: 'AI' },
    source: 'arxiv', reader: 'an AI researcher', field: 'machine-learning', hf: true,
    terms: 'model names, method names, benchmarks, metrics and numbers',
    glossary: 'reinforcement learning → 强化学习, agent → 智能体, world model → 世界模型, large language model → 大语言模型, benchmark → 基准',
    keep: 'method names, model names, dataset and benchmark names, and acronyms (for example GRPO, LLM, ALFWorld, SWE-bench)',
    rateBar: 'a strong main-track paper at NeurIPS, ICML or ICLR',
    categories: 'cs.CL, cs.LG, cs.AI, cs.CV, cs.RO, cs.MA, cs.SE, cs.IR, stat.ML',
    venuesLabel: null, // "Top venues" / 顶会顶刊
  },
  materials: {
    id: 'materials', en: 'Materials science', zh: '材料科学', short: { en: 'Materials', zh: '材料' },
    source: 'arxiv', reader: 'a materials scientist', field: 'materials-science', hf: false,
    terms: 'material names, chemical formulas, methods, units and numbers',
    glossary: 'perovskite → 钙钛矿, electrocatalyst → 电催化剂, high-entropy alloy → 高熵合金, first-principles → 第一性原理, density functional theory → 密度泛函理论, metal-organic framework → 金属有机框架, solid-state electrolyte → 固态电解质, cathode → 正极, anode → 负极, thin film → 薄膜, grain boundary → 晶界, dislocation → 位错, superconductivity → 超导, topological → 拓扑, van der Waals → 范德华, moiré → 莫尔, interatomic potential → 原子间势',
    keep: 'chemical formulas, material and compound names, method names (DFT, MD, XRD, TEM) and acronyms (MOF, COF, OER, HER)',
    rateBar: 'publishable in a leading journal such as Nature Materials, Advanced Materials or JACS',
    categories: 'cond-mat.mtrl-sci, cond-mat.soft, cond-mat.mes-hall, cond-mat.str-el, cond-mat.supr-con, physics.chem-ph, physics.app-ph, physics.comp-ph (and cs.LG for machine learning on materials)',
    venuesLabel: { en: 'Top journals', zh: '顶刊' },
    topics: MAT_TOPICS, cats: MAT_CATS, venues: MAT_VENUES, venueQuery: MAT_VENUE_QUERY,
  },
  lifesci: {
    ...BIO_COMMON, id: 'lifesci', en: 'Life sciences', zh: '生命科学', short: { en: 'Life', zh: '生命' },
    reader: 'a life scientist', field: 'life-science',
    terms: 'gene and protein names, species, cell types, methods, units and numbers',
    glossary: 'single-cell → 单细胞, spatial transcriptomics → 空间转录组, gene editing → 基因编辑, base editing → 碱基编辑, prime editing → 先导编辑, organoid → 类器官, stem cell → 干细胞, cryo-EM → 冷冻电镜, T cell → T 细胞, macrophage → 巨噬细胞, microbiome → 微生物组, bacteriophage → 噬菌体, synthetic biology → 合成生物学, knockout → 敲除, sequencing → 测序, chromatin → 染色质',
    keep: 'gene and protein symbols (TP53, Cas9), species names, cell lines, method names (scRNA-seq, CRISPR, cryo-EM) and acronyms',
    rateBar: 'publishable in Cell, Nature or Science, or a leading journal of its field (Nature Genetics, Nature Methods, Neuron, Immunity)',
    topics: LIFE_TOPICS,
  },
  medicine: {
    ...BIO_COMMON, id: 'medicine', en: 'Medicine & pharma', zh: '医药', short: { en: 'Med', zh: '医药' },
    reader: 'a physician-scientist', field: 'biomedical and clinical',
    terms: 'drug, gene and disease names, trial names, doses, units and numbers',
    glossary: 'randomized controlled trial → 随机对照试验, meta-analysis → 荟萃分析, cohort study → 队列研究, hazard ratio → 风险比, confidence interval → 置信区间, overall survival → 总生存期, progression-free survival → 无进展生存期, placebo → 安慰剂, adverse event → 不良事件, efficacy → 疗效, CAR-T → CAR-T 细胞疗法, gene therapy → 基因治疗, vaccine → 疫苗, pharmacokinetics → 药代动力学',
    keep: 'drug names, gene symbols, trial acronyms, statistics (HR, CI, OR) and doses',
    rateBar: 'publishable in NEJM, The Lancet, JAMA, BMJ or Nature Medicine',
    // the AI judge weighs how strong the evidence is
    rateNote: 'Weigh the level of evidence in r (rigour): randomized controlled trials and meta-analyses of them above prospective cohorts, above retrospective or case-control studies, above case series, case reports and expert opinion; for laboratory and animal work, judge rigour and how directly it bears on patients. The type, when given, says what kind of study it is.',
    topics: MED_TOPICS,
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
