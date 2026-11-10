// Top venues: a paper whose authors say (in the arXiv comment, or the journal reference) that it was accepted at
// a top conference or journal of the field, main track. Submissions, workshops and Findings do not count.
// Shared by the desktop app and the phone app.

// [label, how it is written: the short name, or the full name]
const VENUES = [
  ['NeurIPS', /\b(?:NeurIPS|NIPS)\b|Neural Information Processing Systems/i],
  ['ICML', /\bICML\b|International Conference on Machine Learning/i],
  ['ICLR', /\bICLR\b|International Conference on Learning Representations/i],
  ['CVPR', /\bCVPR\b|Computer Vision and Pattern Recognition/i],
  ['ICCV', /\bICCV\b|International Conference on Computer Vision/i],
  ['ECCV', /\bECCV\b|European Conference on Computer Vision/i],
  ['ACL', /(?<![*\w])ACL\b(?![-\s]*(?:Findings|Anthology|Rolling))|Annual Meeting of the Association for Computational Linguistics/],
  ['EMNLP', /\bEMNLP\b|Empirical Methods in Natural Language Processing/i],
  ['NAACL', /\bNAACL\b|North American Chapter of the Association for Computational Linguistics/i],
  ['COLM', /\bCOLM\b|Conference on Language Modeling/],
  ['AAAI', /\bAAAI\b(?!\s*(?:Spring|Fall)\s*Symposium)/],
  ['IJCAI', /\bIJCAI\b/],
  ['KDD', /\bKDD\b|Knowledge Discovery and Data Mining/],
  ['SIGIR', /\bSIGIR\b/],
  ['WWW', /\bThe\s?Web\s?Conf(?:erence)?\b|\bWWW\s?'?\d{2,4}\b/i],
  ['CoRL', /\bCoRL\b|Conference on Robot Learning/],
  ['RSS', /\bRSS\b|Robotics:\s*Science and Systems/],
  ['ICRA', /\bICRA\b|International Conference on Robotics and Automation/],
  ['SIGGRAPH', /\bSIGGRAPH\b/],
  ['CHI', /\bCHI\b\s*'?\d{2,4}|Conference on Human Factors in Computing Systems/],
  ['TPAMI', /\bT-?PAMI\b|Transactions on Pattern Analysis and Machine Intelligence/i],
  ['JMLR', /\bJMLR\b|Journal of Machine Learning Research/i],
  ['TMLR', /\bTMLR\b|Transactions on Machine Learning Research/i],
  ['TACL', /\bTACL\b|Transactions of the Association for Computational Linguistics/i],
  ['IJCV', /\bIJCV\b|International Journal of Computer Vision/i],
  ['Nature Machine Intelligence', /Nature Machine Intelligence/i],
  // the journals themselves: "published in Nature", not a name that has the word in it
  ['Nature', /\b(?:in|by|at)\s+(?:the\s+journal\s+)?Nature(?=\s*(?:[,.;)]|\d|$))/],
  ['Science', /\b(?:in|by|at)\s+(?:the\s+journal\s+)?Science(?=\s*(?:[,.;)]|\d|$))/],
];
// not (yet) a paper of that venue
const NOT = /\b(?:submitted|submission|under (?:review|submission)|in review|rolling review|to be submitted|preprint of a submission|rejected|workshops?|findings|tiny ?papers?|blog ?post|extended abstract|doctoral consortium|student abstract|demo track|competition)\b/i;
// "Agentic SE @ KDD'26": a workshop held at the venue (an e-mail address is not)
const AT = /\w\s*@\s*(?:\*?[A-Z][A-Za-z]*[A-Z]|[A-Z]{2,})\b/;
// what does say it was taken (a bare venue and year counts too: "NeurIPS 2026", "EMNLP 2026 oral")
const TAKEN = /\b(?:accepted|to appear|appear(?:s|ed)? (?:in|at)|published|camera[- ]ready|proceedings|oral|spotlight|poster|main (?:track|conference))\b/i;
const NOTE = /\b(oral|spotlight)\b/i;

const cache = new Map(); // id -> [comment, venue]

function find(text, fallbackYear) {
  if (!text || NOT.test(text) || AT.test(text)) return null;
  for (const [name, re] of VENUES) {
    const m = re.exec(text);
    if (!m) continue;
    // the year written next to it (2026, '26), else the paper's own
    const near = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 40);
    const y = /\b(20\d{2})\b/.exec(near)?.[1] || (/'(\d{2})\b/.exec(near) ? `20${/'(\d{2})\b/.exec(near)[1]}` : '');
    const bare = new RegExp(`^\\W*(?:${m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\W*(?:20\\d{2}|'\\d{2})?\\b`, 'i').test(text);
    if (!TAKEN.test(text) && !y && !bare) continue;
    const year = +(y || fallbackYear) || 0;
    const note = NOTE.exec(text)?.[1];
    return { name, year, label: `${name}${year ? ` ${year}` : ''}`, note: note ? note[0].toUpperCase() + note.slice(1).toLowerCase() : '' };
  }
  return null;
}

export function venueOf(p) {
  if (!p) return null;
  const text = [p.journal || '', p.comment || ''].join(' ').replace(/\s+/g, ' ').trim();
  const hit = cache.get(p.id);
  if (hit && hit[0] === text) return hit[1];
  const v = find(text, String(p.published || '').slice(0, 4));
  cache.set(p.id, [text, v]);
  return v;
}
