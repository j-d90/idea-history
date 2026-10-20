// Sources no agent may use as evidence, enforced by every agent's submission
// checks (not just its prompt). Matches the project rule: never Wikipedia, AI
// output, content farms or exam-prep sites. Archived copies are judged by the
// original URL.

const BLOCKED_HOSTS: RegExp[] = [
  /(^|\.)wikipedia\.org$/,
  /(^|\.)wikimedia\.org$/,
  /(^|\.)wikidata\.org$/,
  /(^|\.)wikiwand\.com$/,
  /(^|\.)(wiki2|everybodywiki|dbpedia)\.org$/,
  /(^|\.)fandom\.com$/,
  /(^|\.)(quora|reddit|brainly)\.com$/,
  /(^|\.)(chegg|coursehero|studocu|sparknotes|gradesaver|enotes|cliffsnotes|shmoop|7sage)\.com$/,
  /(^|\.)(savemyexams|biologynotesonline|microbeonline|preceden)\.(com|co\.uk)$/,
];

/** The URL a Wayback Machine snapshot points at, or the URL itself. */
function originalUrl(url: string): string {
  const m = /^https?:\/\/web\.archive\.org\/web\/[^/]+\/(.+)$/.exec(url);
  return m ? (/^https?:\/\//.test(m[1]) ? m[1] : `http://${m[1]}`) : url;
}

/** Why a document can't serve as evidence, or null if it can. */
export function disallowedEvidence(url: string): string | null {
  let host: string;
  try {
    host = new URL(originalUrl(url)).hostname.toLowerCase();
  } catch {
    return null;
  }
  return BLOCKED_HOSTS.some((re) => re.test(host))
    ? `${host} can't be used as evidence (no Wikipedia or its mirrors, AI output, content farms or exam-prep sites); find the scholarship it relies on and quote that`
    : null;
}

/** The sourcing rule, for agent prompts. */
export const SOURCE_POLICY = `## Sources you may rely on

Evidence must come from scholarship (university presses, peer-reviewed journals, museum and research-institute publications) or primary texts. Encyclopedias are acceptable only for uncontroversial facts. Never use Wikipedia or its mirrors, AI-generated text, content farms, or exam-prep and study-guide sites: the harness rejects excerpts from them. They can point you to real sources, but quote the source itself.`;
