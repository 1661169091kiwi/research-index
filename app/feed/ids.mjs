// A paper's id says where it is from: an arXiv id ("2611.06500"), or, for papers from Europe PMC (the
// life-sciences and medicine packs), "doi:10.…", "pmid:…" or "epmc:<source>:<id>". Its links, address and short
// reference follow from that. Shared by both apps.

export const isArxivId = (id) => !/^[a-z]+:/i.test(String(id || ''));

// the links shown with an open paper: [label, url]
export function paperLinks(p) {
  if (isArxivId(p.id)) {
    return [['arXiv', `https://arxiv.org/abs/${p.id}`], ['PDF', `https://arxiv.org/pdf/${p.id}`], ['HTML', `https://arxiv.org/html/${p.id}`], ['Hugging Face', `https://huggingface.co/papers/${p.id}`]];
  }
  const out = [];
  if (p.eid && p.esrc) out.push(['Europe PMC', `https://europepmc.org/article/${p.esrc}/${p.eid}`]);
  if (p.doi) out.push([/^bioRxiv|medRxiv|ChemRxiv$/i.test(p.primary || '') ? p.primary : 'DOI', `https://doi.org/${p.doi}`]);
  if (p.pmcid) out.push(['PMC', `https://europepmc.org/article/PMC/${p.pmcid}`]);
  if (p.pmid) out.push(['PubMed', `https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`]);
  return out;
}
// where a link to the paper goes (the share card's QR code, exported lists)
export function paperUrl(p) {
  if (isArxivId(p.id)) return `https://arxiv.org/abs/${p.id}`;
  if (p.doi) return `https://doi.org/${p.doi}`;
  if (p.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`;
  return p.eid ? `https://europepmc.org/article/${p.esrc}/${p.eid}` : '';
}
// a short reference to print: "arXiv:2611.06500", "PMID 41234567", "doi:10.1101/…"
export function paperRef(p) {
  if (isArxivId(p.id)) return `arXiv:${p.id}`;
  if (p.pmid) return `PMID ${p.pmid}`;
  return p.doi ? `doi:${p.doi}` : p.id;
}
// the DOI OpenAlex knows the paper by (arXiv's own for arXiv papers)
export function doiOf(p) {
  if (isArxivId(p.id)) return `10.48550/arxiv.${p.id}`.toLowerCase();
  return String(p.doi || (p.id.startsWith('doi:') ? p.id.slice(4) : '')).toLowerCase();
}
