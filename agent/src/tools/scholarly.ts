import { z } from "zod/v4";
import { fetchJson, safeFetch } from "./net.ts";
import { defineTool, ToolError, type ToolContext } from "./types.ts";

// Structured lookups against scholarly APIs. Each registers what it returns in
// the evidence ledger under a stable URL, so excerpts quoted from it verify and
// read_source / search_source can page through it.

type Json = Record<string, any>;

export const lookupDoi = defineTool({
  name: "lookup_doi",
  description:
    "Get authoritative bibliographic metadata for a DOI from Crossref (falling back to DataCite): authors, title, journal or book, volume, issue, pages, year, publisher. " +
    "Call this to check a cited source's bibliographic details, especially when the publisher's page is paywalled or blocked.",
  input: z.object({ doi: z.string().describe("Bare DOI, e.g. 10.1017/S1356186300014760") }),
  async run({ doi }, ctx) {
    const bare = doi.replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i, "");
    let data: Json;
    try {
      data = (await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(bare)}`, ctx.signal)) as Json;
    } catch (e) {
      // Not every DOI is Crossref's: arXiv, Zenodo and many datasets register with DataCite.
      if (!(e instanceof ToolError) || !e.message.includes("HTTP 404")) throw e;
      return lookupDataCite(bare, ctx);
    }
    const m = data.message as Json | undefined;
    if (!m) throw new ToolError(`Crossref has no record for ${bare}`);

    const people = (list?: Json[]) => (list ?? []).map((p) => [p.given, p.family].filter(Boolean).join(" ") || p.name).join("; ");
    const year = (m.issued?.["date-parts"]?.[0]?.[0] ?? m.published?.["date-parts"]?.[0]?.[0]) as number | undefined;
    const text = [
      `DOI: ${m.DOI}`,
      `Type: ${m.type}`,
      `Title: ${(m.title ?? []).join(" ")}`,
      m.subtitle?.length ? `Subtitle: ${m.subtitle.join(" ")}` : null,
      `Authors: ${people(m.author)}`,
      m.editor ? `Editors: ${people(m.editor)}` : null,
      `Container: ${(m["container-title"] ?? []).join(" ")}`,
      m.volume ? `Volume: ${m.volume}` : null,
      m.issue ? `Issue: ${m.issue}` : null,
      m.page ? `Pages: ${m.page}` : null,
      year ? `Year: ${year}` : null,
      m.publisher ? `Publisher: ${m.publisher}` : null,
      m.URL ? `URL: ${m.URL}` : null,
      m.abstract ? `Abstract: ${String(m.abstract).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const url = `https://doi.org/${bare}`;
    ctx.evidence.add({ url, finalUrl: url, kind: "crossref", title: (m.title ?? [])[0], text, bytes: text.length });
    return `${text}\n\n(Metadata only; to check claims, read the work itself.)`;
  },
});

async function lookupDataCite(bare: string, ctx: ToolContext): Promise<string> {
  let data: Json;
  try {
    data = (await fetchJson(`https://api.datacite.org/dois/${encodeURIComponent(bare)}`, ctx.signal)) as Json;
  } catch (e) {
    if (e instanceof ToolError && e.message.includes("HTTP 404")) throw new ToolError(`Neither Crossref nor DataCite has a record for ${bare}`);
    throw e;
  }
  const a = (data.data?.attributes ?? {}) as Json;
  const title = (a.titles ?? [])[0]?.title as string | undefined;
  const text = [
    `DOI: ${a.doi ?? bare}`,
    `Registered with: DataCite`,
    `Type: ${a.types?.resourceTypeGeneral ?? "unknown"}`,
    `Title: ${title ?? ""}`,
    `Authors: ${(a.creators ?? []).map((c: Json) => c.name).join("; ")}`,
    a.container?.title ? `Container: ${a.container.title}` : null,
    a.publicationYear ? `Year: ${a.publicationYear}` : null,
    a.publisher ? `Publisher: ${typeof a.publisher === "string" ? a.publisher : a.publisher.name}` : null,
    a.url ? `URL: ${a.url}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const url = `https://doi.org/${bare}`;
  ctx.evidence.add({ url, finalUrl: url, kind: "datacite", title, text, bytes: text.length });
  return `${text}\n\n(Metadata only; to check claims, read the work itself.)`;
}

export const searchEuropePmc = defineTool({
  name: "search_europepmc",
  description:
    "Search Europe PMC for journal articles (life sciences, medicine, history of medicine and science). " +
    "Returns titles, authors, journal, year, DOI, PMCID and open-access status. Use it to find a cited article, " +
    "its open-access full text, or scholarship that disagrees with a claim.",
  input: z.object({ query: z.string().describe("Europe PMC query, e.g. 'DOI:10.3390/biom12040596' or 'Pasteur spontaneous generation'") }),
  async run({ query }, ctx) {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=8&resultType=lite&query=${encodeURIComponent(query)}`;
    const data = (await fetchJson(url, ctx.signal)) as Json;
    const results = (data.resultList?.result ?? []) as Json[];
    if (!results.length) return `No Europe PMC results for: ${query}`;
    return results
      .map((r) =>
        [
          `- ${r.title}`,
          `  ${r.authorString ?? ""} (${r.pubYear ?? "n.d."}). ${r.journalTitle ?? ""}`,
          `  DOI: ${r.doi ?? "-"} | PMCID: ${r.pmcid ?? "-"} | open access: ${r.isOpenAccess === "Y" ? "yes" : "no"}`,
        ].join("\n"),
      )
      .join("\n");
  },
});

export const getEuropePmcFullText = defineTool({
  name: "get_europepmc_fulltext",
  description:
    "Load the open-access full text of an article from Europe PMC by PMCID. Returns a short summary and a URL; " +
    "then use search_source and read_source on that URL to find and read passages.",
  input: z.object({ pmcid: z.string().describe("e.g. PMC9027159") }),
  async run({ pmcid }, ctx) {
    const id = pmcid.toUpperCase();
    if (!/^PMC\d+$/.test(id)) throw new ToolError(`not a PMCID: ${pmcid}`);
    const res = await safeFetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/${id}/fullTextXML`, { signal: ctx.signal, accept: "application/xml" });
    const xml = new TextDecoder().decode(res.body);
    const title = /<article-title[^>]*>([\s\S]*?)<\/article-title>/.exec(xml)?.[1]?.replace(/<[^>]+>/g, "");
    const text = xml
      .replace(/<(xref|ext-link)[^>]*>([\s\S]*?)<\/\1>/g, "$2")
      .replace(/<\/(p|title|sec|td|th|tr|caption|ref)>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .trim();
    if (text.length < 500) throw new ToolError(`Europe PMC has no full text for ${id}`);

    const url = `https://europepmc.org/article/PMC/${id}`;
    ctx.evidence.add({ url, finalUrl: url, kind: "europepmc", title, text, bytes: res.body.byteLength });
    return `Loaded full text of ${id}${title ? ` ("${title.trim()}")` : ""}, ${text.length} characters.\nUse search_source / read_source with url: ${url}`;
  },
});

export const getArxivAbstract = defineTool({
  name: "get_arxiv_abstract",
  description: "Get the title, authors, dates and abstract of an arXiv paper from the arXiv API. Call this to check claims sourced to an arXiv abstract.",
  input: z.object({ id: z.string().describe("arXiv id, e.g. 1706.03762") }),
  async run({ id }, ctx) {
    const bare = id.replace(/^(https?:\/\/arxiv\.org\/abs\/|arxiv:)/i, "");
    const res = await safeFetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(bare)}`, { signal: ctx.signal, accept: "application/atom+xml" });
    const xml = new TextDecoder().decode(res.body);
    const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1];
    const field = (tag: string) =>
      entry ? new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(entry)?.[1]?.replace(/\s+/g, " ").trim() : undefined;
    const title = field("title");
    if (!entry || !title) throw new ToolError(`arXiv has no paper ${bare}`);

    const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => m[1].trim()).join(", ");
    const text = [`Title: ${title}`, `Authors: ${authors}`, `Published: ${field("published")}`, `Updated: ${field("updated")}`, `Abstract: ${field("summary")}`].join("\n");
    const url = `https://arxiv.org/abs/${bare}`;
    ctx.evidence.add({ url, finalUrl: url, kind: "arxiv", title, text, bytes: text.length });
    return text;
  },
});

export const findArchivedCopy = defineTool({
  name: "find_archived_copy",
  description:
    "Find an Internet Archive (Wayback Machine) snapshot of a URL. Call this when a source page is blocked (403/429), " +
    "gone (404), or needs JavaScript; then read the returned snapshot URL with read_source.",
  input: z.object({ url: z.string().describe("The original URL") }),
  async run({ url }, ctx) {
    const data = (await fetchJson(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, ctx.signal)) as Json;
    const snap = data.archived_snapshots?.closest as Json | undefined;
    if (!snap?.available) return `No archived copy of ${url} was found.`;
    return `Archived copy from ${snap.timestamp}: ${snap.url}\nRead it with read_source.`;
  },
});
