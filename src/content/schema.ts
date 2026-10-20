import { z } from "zod";

export const categories = [
  "technology",
  "philosophy",
  "religion",
  "politics",
  "science",
  "mathematics",
  "economics",
] as const;

/**
 * candidate: proposed by the extractor agent from a source; not curated, not shown on the site.
 * draft: written but not sourced. sourced: every claim cited. reviewed: passed the fact-checker.
 */
export const statuses = ["candidate", "draft", "sourced", "reviewed"] as const;

/** The one agent accountable for reviews. See agents/README.md. */
export const REVIEWER = "fact-checker";

const year = z.number().int().min(-10000).max(2100);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//.test(u), "url must be http(s)");

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase letters, digits and hyphens");
export const sourceKey = slug;
export const ideaId = slug;

// ---------- Sources (bibliography) ----------

export const sourceSchema = z
  .object({
    /** primary: the original work or text. secondary: scholarship about it. reference: encyclopedias and surveys. */
    type: z.enum(["primary", "secondary", "reference"]),
    /** Bibliographic form, which decides how it is cited. */
    kind: z.enum(["book", "chapter", "article", "preprint", "web", "text"]),
    authors: z.array(z.string()).default([]),
    /** The author list is truncated; cite as "et al.". */
    etAl: z.boolean().default(false),
    editors: z.array(z.string()).default([]),
    translators: z.array(z.string()).default([]),
    title: z.string().min(1),
    /** Journal, edited book, or website the work appears in. */
    container: z.string().optional(),
    series: z.string().optional(),
    publisher: z.string().optional(),
    volume: z.union([z.number(), z.string()]).optional(),
    issue: z.union([z.number(), z.string()]).optional(),
    pages: z.string().optional(),
    year: z.union([year, z.string()]),
    doi: z.string().regex(/^10\.\d{4,9}\/\S+$/, "bare DOI, e.g. 10.1017/S1356186300014760").optional(),
    url: httpUrl.optional(),
    /** When the url was last checked. */
    accessed: isoDate.optional(),
    /** Override for the in-text label, e.g. "SN 56.11". */
    short: z.string().optional(),
    /** false if only the bibliographic record was checked, not the work itself. */
    consulted: z.boolean().default(true),
    note: z.string().optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const need = (field: keyof typeof s, why: string) => {
      if (s[field] === undefined) ctx.addIssue({ code: "custom", path: [field], message: why });
    };
    if (s.kind === "article") need("container", "an article needs its journal as `container`");
    if (s.kind === "chapter") {
      need("container", "a chapter needs its book as `container`");
      need("publisher", "a chapter needs a publisher");
    }
    if (s.kind === "book") need("publisher", "a book needs a publisher");
    if (s.kind === "web") need("url", "a web source needs a url");
    if ((s.kind === "preprint" || s.kind === "text") && !s.url && !s.doi && !s.publisher) {
      ctx.addIssue({ code: "custom", message: `a ${s.kind} needs a url, doi or publisher` });
    }
  });

export const bibliographySchema = z.record(sourceKey, sourceSchema);

// ---------- Ideas ----------

export const dateSchema = z
  .object({
    /** The year used for placement on the timeline. Negative years are BCE. */
    year,
    /** What the year marks, e.g. "The Buddha's death". Required once sourced. */
    marks: z.string().optional(),
    /** Bounds of scholarly estimates, when they differ from `year`. */
    earliest: year.optional(),
    latest: year.optional(),
    approx: z.boolean().default(false),
    /** Why the date is uncertain or contested. May contain [@citations]. */
    note: z.string().optional(),
  })
  .strict()
  .refine((d) => d.earliest === undefined || d.earliest <= d.year, {
    message: "earliest must be <= year",
  })
  .refine((d) => d.latest === undefined || d.latest >= d.year, {
    message: "latest must be >= year",
  });

export const reviewSchema = z
  .object({
    by: z.literal(REVIEWER),
    date: isoDate,
    /** Content hash at review time (`npm run review-hash -- <id>`). */
    hash: z.string().regex(/^[0-9a-f]{16}$/),
  })
  .strict();

/** An idea as authors edit it (`npm run kg -- idea get|put`), minus the body. */
export const ideaFieldsSchema = z
  .object({
    id: ideaId,
    title: z.string().min(1),
    category: z.enum(categories),
    status: z.enum(statuses),
    date: dateSchema,
    /** Who / where, shown as a short byline. */
    origin: z.string().min(1),
    /** Shown on the card. No citations; the body carries them. */
    summary: z.string().min(1).max(320),
    /** Other names for the idea; used for search and matching, not shown or reviewed. */
    aliases: z.array(z.string()).default([]),
    /** Keys of the sources the idea cites. */
    sources: z.array(sourceKey).default([]),
    review: reviewSchema.optional(),
  })
  .strict();

export type Idea = z.infer<typeof ideaFieldsSchema> & {
  /** Markdown body with [@key, locator] citations. */
  body: string;
};

// ---------- Links between ideas ----------

/**
 * BUILDS_ON: the later idea draws on or develops the earlier one.
 * REACTS_AGAINST: the later idea critiques or rejects the earlier one.
 * PARALLELS: similar ideas that arose independently, with no influence between them.
 */
export const linkTypes = ["BUILDS_ON", "REACTS_AGAINST", "PARALLELS"] as const;

/**
 * seed: from the original placeholder content, unverified.
 * linker: proposed by the linker agent with verified evidence.
 */
export const linkOrigins = ["seed", "linker"] as const;
export const linkStatuses = ["proposed", "reviewed"] as const;

export const ideaLinkSchema = z
  .object({
    /** The later idea. */
    from: ideaId,
    /** The earlier idea it relates to. */
    to: ideaId,
    type: z.enum(linkTypes),
    why: z.string().optional(),
    origin: z.enum(linkOrigins),
    status: z.enum(linkStatuses),
    /** Verbatim excerpt supporting the link, from the document at evidenceUrl. */
    evidence: z.string().optional(),
    evidenceUrl: z.string().optional(),
    sourceKey: sourceKey.optional(),
    locator: z.string().optional(),
    confidence: z.enum(["low", "medium", "high"]).optional(),
    runId: z.string().optional(),
    model: z.string().optional(),
  })
  .strict();

export type LinkType = (typeof linkTypes)[number];
export type IdeaLink = z.infer<typeof ideaLinkSchema>;

// ---------- Entities ----------

export const entityKinds = ["person", "group", "place", "work", "institution", "tradition", "language", "concept", "period"] as const;

export const entitySchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    kind: z.enum(entityKinds),
    description: z.string().optional(),
    aliases: z.array(z.string()).default([]),
  })
  .strict();

export type EntityKind = (typeof entityKinds)[number];
export type Entity = z.infer<typeof entitySchema>;

// ---------- Reviews ----------

export interface ReviewRecord {
  runId: string;
  ideaId: string;
  verdict: "pass" | "fail";
  by: string;
  date: string;
  hash: string;
  report: string;
}

export type Category = (typeof categories)[number];
export type Status = (typeof statuses)[number];
export type Source = z.infer<typeof sourceSchema>;
export type Bibliography = Record<string, Source>;
export type IdeaDate = z.infer<typeof dateSchema>;
export type Review = z.infer<typeof reviewSchema>;

/** What the browser receives: content pre-rendered at build time. */
export type RenderedIdea = Omit<Idea, "body" | "sources" | "aliases"> & {
  bodyHtml: string;
  /** Plain-text description of the date, citations resolved. */
  dateText: string;
  references: { key: string; html: string }[];
  /** Links to earlier ideas. */
  links: Pick<IdeaLink, "to" | "type" | "why" | "origin" | "status">[];
};
