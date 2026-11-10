// Research directions ("channels"): how to search arXiv for each, how to tag a paper with it,
// and how its generated card cover looks. Edit freely — order here is the order of the chips.

export const CATS = '(cat:cs.CL OR cat:cs.LG OR cat:cs.AI OR cat:cs.CV OR cat:cs.RO OR cat:cs.MA OR cat:cs.SE OR cat:cs.IR)';

// Card cover palette (Swiss): background / ink
export const PALETTE = {
  blue: ['#1f3be6', '#ffffff'],
  ink: ['#0f0f0f', '#f6f5f1'],
  red: ['#e2412b', '#ffffff'],
  yellow: ['#f3c745', '#0f0f0f'],
  green: ['#138a5e', '#ffffff'],
  sand: ['#e7e3d8', '#0f0f0f'],
  sky: ['#bcd3f5', '#0f0f0f'],
  rose: ['#f2c6c0', '#0f0f0f'],
  slate: ['#3b3a36', '#f6f5f1'],
};

export const TOPICS = [
  { id: 'agents', en: 'LLM agents', zh: '智能体', color: 'blue',
    q: '(abs:"LLM agent" OR abs:"LLM agents" OR abs:"language agent" OR abs:agentic OR ti:agent OR ti:agents)',
    kw: [/\bagent(s|ic)?\b/i] },
  { id: 'agentic-rl', en: 'Agentic RL', zh: '智能体强化学习', color: 'ink',
    q: '(abs:"reinforcement learning" OR abs:GRPO OR abs:RLVR) AND (abs:agent OR abs:agentic OR abs:"multi-turn" OR abs:"tool use")',
    kw: [/(reinforcement learning|\bRLVR\b|\bGRPO\b|\bPPO\b|policy optimi[sz]ation)[\s\S]{0,400}(agent|multi-turn|tool)|(agent|multi-turn|tool)[\s\S]{0,400}(reinforcement learning|\bRLVR\b|\bGRPO\b)/i] },
  { id: 'world-models', en: 'World models', zh: '世界模型', color: 'green',
    q: '(abs:"world model" OR abs:"world models" OR abs:"environment model")',
    kw: [/world[- ]models?\b|environment model|simulat(or|ed environment)/i] },
  { id: 'rl-llm', en: 'RL for LLMs', zh: '大模型强化学习', color: 'red',
    q: '(abs:RLVR OR abs:GRPO OR abs:RLHF OR abs:"verifiable rewards" OR abs:"policy optimization") AND (abs:"language model" OR abs:LLM OR abs:LLMs)',
    kw: [/\bRLVR\b|\bGRPO\b|\bRLHF\b|\bDPO\b|verifiable reward|policy optimi[sz]ation|reward model/i] },
  { id: 'reasoning', en: 'Reasoning', zh: '推理', color: 'yellow',
    q: '(abs:reasoning OR abs:"chain-of-thought" OR abs:"test-time scaling") AND (abs:"language model" OR abs:LLM OR abs:LLMs)',
    kw: [/reasoning|chain[- ]of[- ]thought|test[- ]time (scaling|compute)|\bCoT\b/i] },
  { id: 'memory', en: 'Memory & context', zh: '记忆与上下文', color: 'sky',
    q: '(abs:memory OR abs:"long context" OR abs:"long-context" OR abs:"context compression" OR abs:"retrieval-augmented") AND (abs:LLM OR abs:agent OR abs:"language model")',
    kw: [/\bmemory\b|long[- ]context|context (compression|management|engineering)|retrieval[- ]augmented|\bRAG\b/i] },
  { id: 'multi-agent', en: 'Multi-agent', zh: '多智能体', color: 'rose',
    q: '(abs:"multi-agent" OR abs:multiagent) AND (abs:LLM OR abs:LLMs OR abs:"language model")',
    kw: [/multi[- ]?agent/i] },
  { id: 'code', en: 'Code & SWE', zh: '代码与软件工程', color: 'slate',
    q: '(abs:"SWE-bench" OR abs:"code generation" OR abs:"coding agent" OR abs:"software engineering agent" OR abs:"program synthesis")',
    kw: [/SWE-bench|code generation|coding agent|software engineering|program synthesis|\brepository\b/i] },
  { id: 'gui', en: 'GUI & web agents', zh: 'GUI 与网页智能体', color: 'sky',
    q: '(abs:"GUI agent" OR abs:"computer use" OR abs:"computer-use" OR abs:"web agent" OR abs:OSWorld OR abs:WebArena)',
    kw: [/\bGUI\b|computer[- ]use|web agents?|OSWorld|WebArena|mobile agent/i] },
  { id: 'multimodal', en: 'Multimodal', zh: '多模态', color: 'yellow',
    q: '(abs:"vision-language" OR abs:"vision language model" OR abs:multimodal) AND (abs:LLM OR abs:"language model" OR abs:reasoning)',
    kw: [/vision[- ]language|multimodal|\bVLMs?\b|\bMLLMs?\b/i] },
  { id: 'diffusion-lm', en: 'Diffusion LMs', zh: '扩散语言模型', color: 'red',
    q: '(abs:"diffusion language model" OR abs:"diffusion language models" OR abs:"masked diffusion" OR abs:"discrete diffusion")',
    kw: [/diffusion language|masked diffusion|discrete diffusion|\bdLLMs?\b/i] },
  { id: 'efficiency', en: 'Efficiency', zh: '高效训练与推理', color: 'sand',
    q: '(abs:"KV cache" OR abs:quantization OR abs:"speculative decoding" OR abs:"knowledge distillation" OR abs:"efficient inference") AND (abs:LLM OR abs:"language model")',
    kw: [/KV[- ]cache|quantiz|speculative decoding|distillation|pruning|efficient (inference|training)|sparse attention/i] },
  { id: 'safety', en: 'Safety & alignment', zh: '安全与对齐', color: 'ink',
    q: '(abs:"prompt injection" OR abs:jailbreak OR abs:"AI safety" OR abs:"reward hacking" OR abs:misalignment OR abs:"red teaming") AND (abs:LLM OR abs:agent OR abs:"language model")',
    kw: [/safety|alignment|jailbreak|prompt injection|reward hacking|misalign|red[- ]teaming|backdoor/i] },
  { id: 'interp', en: 'Interpretability', zh: '可解释性', color: 'green',
    q: '(abs:"mechanistic interpretability" OR abs:"sparse autoencoder" OR abs:"sparse autoencoders" OR abs:"activation steering" OR abs:probing) AND (abs:LLM OR abs:"language model" OR abs:transformer)',
    kw: [/interpretab|sparse autoencoder|activation (steering|patching)|\bprob(e|ing)\b|circuits?\b/i] },
  { id: 'eval', en: 'Benchmarks', zh: '评测与基准', color: 'sand',
    q: '(ti:benchmark OR ti:benchmarking OR ti:evaluation) AND (abs:LLM OR abs:agent OR abs:"language model")',
    kw: [/\bbenchmark|evaluation|leaderboard/i] },
  { id: 'embodied', en: 'Embodied & robotics', zh: '具身与机器人', color: 'slate',
    q: '(abs:"vision-language-action" OR abs:"embodied agent" OR abs:"robot learning" OR abs:"robotic manipulation")',
    kw: [/embodied|robot|vision[- ]language[- ]action|\bVLA\b|manipulation/i] },
];

export const SURVEY_RE = /\b(survey|surveys|a review|systematic review|literature review|overview|tutorial|primer|roadmap|taxonomy|position paper|state of the art)\b/i;


export function tagTopics(title, abstract) {
  const text = `${title}\n${abstract}`;
  const tags = TOPICS.filter((t) => t.kw.some((re) => re.test(text))).map((t) => t.id);
  return tags;
}
