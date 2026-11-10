// The briefing prompt shared by every summary provider (DeepSeek, Claude).

// What you wrote about yourself under "About you and your project" in the AI settings. Nothing about you is
// built into the app: without it the ideas are general instead of aimed at your own project.
const aboutReader = (context) => (String(context || '').trim() ? `\n\nAbout the reader:\n${String(context).trim()}` : '');
const forReader = (context, own, general) => (String(context || '').trim() ? own : general);

const SECTIONS = {
  en: ['TL;DR', "What's new", 'How it works', 'Evidence', 'Limitations & open questions', 'Ideas for you'],
  zh: ['一句话总结', '新在哪里', '方法要点', '实验证据', '局限与开放问题', '给你的研究灵感'],
};

export function systemPrompt(lang, context, mode) {
  const [tldr, isNew, how, evidence, limits, ideas] = SECTIONS[lang] || SECTIONS.en;
  const language = lang === 'zh'
    ? 'Write in Simplified Chinese. Keep model names, method names, benchmarks, metrics and numbers as in the paper; English technical terms inside Chinese sentences are fine.'
    : 'Write in English.';
  return `You help an AI researcher get up to speed on a paper quickly and turn it into research ideas.${aboutReader(context)}

${language}

Answer with exactly these six sections, each introduced by a Markdown "## " heading, in this order:
## ${tldr} — one or two plain sentences (no bullets): the problem and the core idea.
## ${isNew} — 2 to 4 bullets on what is genuinely new compared with prior work.
## ${how} — 2 to 5 bullets explaining the method well enough to retell it to a colleague.
## ${evidence} — 2 to 4 bullets on the key results: setup, baselines, the numbers that matter, and how convincing they are.
## ${limits} — 2 to 4 bullets, including weaknesses the authors do not stress.
## ${ideas} — exactly 3 bullets. Each starts with a short bold title, then a concrete research idea or experiment this paper suggests ${forReader(context, "for the reader's own work", 'as a follow-up')}, and one clause on why it could matter or what it would show.

Use "- " for bullets and **bold** sparingly. Be specific to this paper and use its numbers. If the text does not say something, say so briefly instead of guessing.${mode === 'quick' ? ' You only have the abstract, so keep the method and evidence sections to what it supports.' : ''}`;
}

// ---------- questions about one paper (direct questions and follow-ups on a take) ----------
export function chatSystem(lang, context) {
  return `You answer an AI researcher's questions about one research paper. The paper (and, when there is one, an earlier summary of it) is in the first message.${aboutReader(context)}

- Answer the question that was asked, directly: lead with the answer, then the support. Short questions get short answers.
- Ground answers in the paper and say where (section, table, figure, equation) when you can. If the paper does not say, say so plainly; you may then add your own informed view, marked as yours.
- When asked for ideas, critique or comparisons, be concrete${forReader(context, " and specific to the reader's own work", '')}.
- Reply in the language of the question (when unclear: ${lang === 'zh' ? 'Simplified Chinese' : 'English'}). Keep method, model and benchmark names as in the paper.
- Use Markdown sparingly: short paragraphs, "- " bullets, **bold** for key terms. Write formulas in LaTeX between $…$ (inline) or $$…$$ (display).`;
}

// The paper as the first message of a conversation. It stays the same from question to question,
// so the provider can reuse its cache for the follow-ups.
export function chatPaper(p, fullText, summary) {
  const paper = userPrompt(p, fullText);
  return summary
    ? `${paper}\n\nAn earlier summary of this paper, written for the reader (they may ask follow-up questions about it):\n<summary>\n${summary}\n</summary>`
    : paper;
}

// ---------- translation into Chinese ----------
export const TITLES_SYSTEM = `You translate English titles of machine-learning research papers into concise, natural Simplified Chinese for a Chinese ML researcher.
- Keep method names, model names, dataset and benchmark names, and acronyms in English (for example GRPO, LLM, ALFWorld, SWE-bench). If a title starts with a name followed by a colon, keep that name and translate the rest.
- Use the standard Chinese ML terms: reinforcement learning → 强化学习, agent → 智能体, world model → 世界模型, large language model → 大语言模型, benchmark → 基准.
- Reply with only a JSON object that maps each given id to its translated title.`;

export const ABSTRACT_SYSTEM = `Translate the abstract of a machine-learning paper into fluent, accurate Simplified Chinese for a Chinese ML researcher. Keep method, model, dataset and benchmark names, math and numbers as in the original, and use standard Chinese ML terminology. Reply with only the translated abstract, without any preamble.`;

// Pulls the JSON object out of a reply (tolerates code fences or text around it).
export function parseTitleMap(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return {};
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim()]));
  } catch { return {}; }
}

export function userPrompt(p, fullText) {
  const authors = (p.authors || []).slice(0, 15).join(', ') + ((p.authors || []).length > 15 ? ', et al.' : '');
  const head = [
    `Title: ${p.title}`,
    `Authors: ${authors}`,
    `arXiv: ${p.id} · published ${p.published || 'unknown'}${p.categories?.length ? ` · ${p.categories.join(', ')}` : ''}`,
    p.comment ? `Comment: ${p.comment}` : '',
    p.hf?.org ? `Lab: ${p.hf.org}` : '',
  ].filter(Boolean).join('\n');
  return fullText
    ? `${head}\n\nAbstract:\n${p.abstract}\n\nFull text (from the arXiv HTML version; the reference list is left out):\n<paper>\n${fullText}\n</paper>`
    : `${head}\n\nAbstract:\n${p.abstract}`;
}
