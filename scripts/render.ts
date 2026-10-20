import MarkdownIt from "markdown-it";
import { CITATION, parseCitation, type Citation } from "../src/content/rules.ts";
import type { Bibliography, Idea, IdeaLink, RenderedIdea, Source } from "../src/content/schema.ts";
import { escapeHtml as esc, formatYear } from "../src/format.ts";

// Raw HTML in content is escaped, and markdown-it refuses javascript: links.
const md = new MarkdownIt({ html: false, linkify: false, typographer: true });

const surname = (name: string) => name.trim().split(/\s+/).pop()!;

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/** In-text label: "Lam 2010", "Cavaillon and Legout 2022", "Vaswani et al. 2017". */
export function shortLabel(s: Source): string {
  if (s.short) return s.short;
  const names = s.authors.length ? s.authors : s.editors;
  let who: string;
  if (!names.length) who = s.title.length > 40 ? `${s.title.slice(0, 40)}…` : s.title;
  else if (names.length >= 3 || s.etAl) who = `${surname(names[0])} et al.`;
  else who = names.map(surname).join(" and ");
  return `${who} ${s.year}`;
}

function citationText(cites: Citation[], bib: Bibliography): string {
  return cites
    .map((c) => `${shortLabel(bib[c.key])}${c.locator ? `, ${c.locator}` : ""}`)
    .join("; ");
}

/** Replace [@...] groups in already-escaped HTML with linked author-date citations. */
function linkCitations(html: string, ideaId: string, bib: Bibliography): string {
  return html.replace(CITATION, (_whole, inner: string) => {
    const cites = parseCitation(inner)!;
    const parts = cites.map(
      (c) =>
        `<a class="cite" href="#ref-${ideaId}-${c.key}">${esc(shortLabel(bib[c.key]))}</a>` +
        (c.locator ? `, ${c.locator}` : ""),
    );
    return `<span class="cite-group">(${parts.join("; ")})</span>`;
  });
}

/** Replace [@...] groups in plain text with "(Author Year, locator)". */
function plainCitations(text: string, bib: Bibliography): string {
  return text.replace(CITATION, (_w, inner: string) => `(${citationText(parseCitation(inner)!, bib)})`);
}

/** Author-date reference, loosely Chicago style. */
export function formatReference(s: Source): string {
  const out: string[] = [];
  const authors = s.authors.length ? joinNames(s.authors) + (s.etAl ? " et al." : "") : "";
  const editorsLead = !authors && s.editors.length ? `${joinNames(s.editors)}, ed${s.editors.length > 1 ? "s" : ""}.` : "";

  if (authors || editorsLead) out.push(`${esc(authors || editorsLead)} ${esc(String(s.year))}.`);

  const quoted = s.kind === "book" ? `<cite>${esc(s.title)}</cite>.` : `“${esc(s.title)}.”`;
  out.push(quoted);
  if (!authors && !editorsLead) out.push(`${esc(String(s.year))}.`);

  if (s.translators.length) out.push(`Translated by ${esc(joinNames(s.translators))}.`);

  if (s.kind === "chapter") {
    const eds = s.editors.length ? `, edited by ${esc(joinNames(s.editors))}` : "";
    out.push(`In <cite>${esc(s.container!)}</cite>${eds}${s.pages ? `, ${esc(s.pages)}` : ""}.`);
  } else if (s.kind === "article") {
    const vol = s.volume !== undefined ? ` ${esc(String(s.volume))}` : "";
    const iss = s.issue !== undefined ? ` (${esc(String(s.issue))})` : "";
    const pages = s.pages ? `: ${esc(s.pages)}` : "";
    out.push(`<cite>${esc(s.container!)}</cite>${vol}${iss}${pages}.`);
  } else if (s.container) {
    out.push(`${esc(s.container)}.`);
  }

  if (s.series) out.push(`${esc(s.series)}.`);
  if (s.publisher) out.push(`${esc(s.publisher)}.`);

  const href = s.doi ? `https://doi.org/${s.doi}` : s.url;
  if (href) out.push(`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(s.doi ? `doi:${s.doi}` : href)}</a>`);
  if (!s.consulted) out.push(`<span class="ref-note">(Bibliographic record only; not consulted.)</span>`);
  if (s.note) out.push(`<span class="ref-note">${esc(s.note)}</span>`);

  return out.join(" ");
}

function describeDate(idea: Idea, bib: Bibliography): string {
  const d = idea.date;
  const parts: string[] = [formatYear(d.year, d.approx) + (d.marks ? `: ${d.marks}.` : ".")];
  if (d.earliest !== undefined || d.latest !== undefined) {
    parts.push(`Estimates range ${formatYear(d.earliest ?? d.year)} – ${formatYear(d.latest ?? d.year)}.`);
  }
  if (d.note) parts.push(plainCitations(d.note, bib));
  return parts.join(" ");
}

export function renderIdea(idea: Idea, bib: Bibliography, links: IdeaLink[]): RenderedIdea {
  const { body, sources, aliases: _aliases, ...rest } = idea;
  return {
    ...rest,
    links: links.filter((l) => l.from === idea.id).map(({ to, type, why, origin, status }) => ({ to, type, why, origin, status })),
    bodyHtml: body ? linkCitations(md.render(body), idea.id, bib) : "",
    dateText: describeDate(idea, bib),
    references: sources
      .map((key) => ({ key, source: bib[key] }))
      .sort((a, b) => shortLabel(a.source).localeCompare(shortLabel(b.source)))
      .map(({ key, source }) => ({ key, html: formatReference(source) })),
  };
}
