import { createHash } from "node:crypto";

/** A document the agent actually read during a run. */
export interface SourceDocument {
  /** The URL the agent asked for (the cache key). */
  url: string;
  /** Where it ended up after redirects. */
  finalUrl: string;
  fetchedAt: string;
  /** "html", "pdf", "text", or an API name such as "crossref". */
  kind: string;
  title?: string;
  /** Full text; for PDFs, the pages joined with page markers. */
  text: string;
  /** PDF pages, when known, for page-aware reading and search. */
  pages?: string[];
  sha256: string;
  bytes: number;
}

/**
 * Records every document fetched during a review. The ledger is the harness's
 * ground truth: the report's "documents read" table comes from here, not from the
 * model, and every quoted excerpt in the model's verdict is checked against it.
 */
export class EvidenceLedger {
  private docs = new Map<string, SourceDocument>();
  private pending = new Map<string, Promise<SourceDocument>>();

  /** Return a cached document, or fetch it once even if requested concurrently. */
  async getOrAdd(url: string, fetcher: () => Promise<Omit<SourceDocument, "sha256" | "fetchedAt">>): Promise<SourceDocument> {
    const cached = this.docs.get(url);
    if (cached) return cached;
    let inflight = this.pending.get(url);
    if (!inflight) {
      inflight = fetcher().then((d) => this.add(d));
      this.pending.set(url, inflight);
      inflight.finally(() => this.pending.delete(url)).catch(() => {});
    }
    return inflight;
  }

  add(d: Omit<SourceDocument, "sha256" | "fetchedAt">): SourceDocument {
    const doc: SourceDocument = {
      ...d,
      fetchedAt: new Date().toISOString(),
      sha256: createHash("sha256").update(d.text).digest("hex"),
    };
    this.docs.set(d.url, doc);
    if (d.finalUrl !== d.url) this.docs.set(d.finalUrl, doc);
    return doc;
  }

  get(url: string): SourceDocument | undefined {
    return this.docs.get(url);
  }

  all(): SourceDocument[] {
    return [...new Set(this.docs.values())];
  }

  /**
   * Find which document contains a quoted excerpt, comparing normalized text.
   * "…" or "..." in the excerpt may stand for omitted text; each piece must then
   * appear in order. Searches `preferUrl` first, then every document.
   */
  locate(excerpt: string, preferUrl?: string | null): SourceDocument | undefined {
    const pieces = normalize(excerpt)
      .split(/\s*(?:…|\.\.\.)\s*/)
      .filter((p) => p.length > 0);
    if (!pieces.length) return undefined;

    const candidates = this.all();
    const preferred = preferUrl ? this.docs.get(preferUrl) : undefined;
    if (preferred) candidates.unshift(preferred);

    return candidates.find((doc) => {
      const hay = normalize(doc.text);
      let from = 0;
      for (const piece of pieces) {
        const at = hay.indexOf(piece, from);
        if (at < 0) return false;
        from = at + piece.length;
      }
      return true;
    });
  }
}

/**
 * Normalize text for comparison. Removes all whitespace, hyphens and dashes, so
 * PDF extraction quirks ("eng lund", "arguably , the", "hiero-\nglyphs") don't
 * defeat genuine quotes; also folds Unicode forms, case and quote styles.
 */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[­\-‐‑‒–—―\s]/g, "")
    .toLowerCase();
}
