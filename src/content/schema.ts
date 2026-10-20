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
 * candidate: proposed by an agent (extractor, interpreter); not curated, not shown on the site.
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
export const eventId = slug;

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

// Ideas and events are both "entries": dated, sourced records with the same
// status workflow, citation rules and review. They differ only in their
// classification (an idea's category and origin, an event's kind and place).

const entryFields = {
  title: z.string().min(1),
  status: z.enum(statuses),
  date: dateSchema,
  /** Shown on the card. No citations; the body carries them. */
  summary: z.string().min(1).max(320),
  /** Other names; used for search and matching, not shown or reviewed. */
  aliases: z.array(z.string()).default([]),
  /** Keys of the sources the entry cites. */
  sources: z.array(sourceKey).default([]),
  review: reviewSchema.optional(),
};

/** An idea as authors edit it (`npm run kg -- idea get|put`), minus the body. */
export const ideaFieldsSchema = z
  .object({
    id: ideaId,
    title: entryFields.title,
    category: z.enum(categories),
    status: entryFields.status,
    date: entryFields.date,
    /** Who / where, shown as a short byline. */
    origin: z.string().min(1),
    summary: entryFields.summary,
    aliases: entryFields.aliases,
    sources: entryFields.sources,
    review: entryFields.review,
  })
  .strict();

export type Idea = z.infer<typeof ideaFieldsSchema> & {
  /** Markdown body with [@key, locator] citations. */
  body: string;
};

// ---------- Events ----------

/**
 * Events are the raw observations of history: things that happened at a time and
 * place, as recorded by sources. Ideas are identified from them (see emergences).
 */
export const eventKinds = [
  "political",
  "military",
  "legal",
  "religious",
  "cultural",
  "economic",
  "technological",
  "scientific",
  "construction",
  "migration",
  "environmental",
] as const;

/** An event as authors edit it (`npm run kg -- event get|put`), minus the body. */
export const eventFieldsSchema = z
  .object({
    id: eventId,
    title: entryFields.title,
    kind: z.enum(eventKinds),
    status: entryFields.status,
    date: entryFields.date,
    /** Where it happened, shown as a short byline. */
    place: z.string().min(1),
    summary: entryFields.summary,
    aliases: entryFields.aliases,
    sources: entryFields.sources,
    review: entryFields.review,
  })
  .strict();

export type HistoricalEvent = z.infer<typeof eventFieldsSchema> & {
  /** Markdown body with [@key, locator] citations. */
  body: string;
};

export type Entry = Idea | HistoricalEvent;
export type EntryLabel = "Idea" | "Event";

export const isIdea = (e: Entry): e is Idea => "category" in e;
export const labelOf = (e: Entry): EntryLabel => (isIdea(e) ? "Idea" : "Event");

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

// ---------- Emergences: ideas identified from events ----------

/**
 * How an event shows an idea emerging:
 * earliest-evidence: among the earliest surviving evidence of the idea.
 * articulation: the idea is explicitly stated or formulated.
 * institutionalization: the idea is adopted, codified or enforced by an institution.
 * spread: the idea reaches a new region, people or domain.
 */
export const emergenceStages = ["earliest-evidence", "articulation", "institutionalization", "spread"] as const;

export const emergenceSchema = z
  .object({
    idea: ideaId,
    event: eventId,
    stage: z.enum(emergenceStages),
    why: z.string().min(1),
    status: z.enum(linkStatuses),
    /** Verbatim excerpt connecting the event to the idea, from the document at evidenceUrl. */
    evidence: z.string().min(1),
    evidenceUrl: z.string().min(1),
    sourceKey: sourceKey.optional(),
    locator: z.string().optional(),
    confidence: z.enum(["low", "medium", "high"]),
    runId: z.string().optional(),
    model: z.string().optional(),
  })
  .strict();

export type EmergenceStage = (typeof emergenceStages)[number];
export type Emergence = z.infer<typeof emergenceSchema>;

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
  label: EntryLabel;
  /** The reviewed idea or event. */
  id: string;
  verdict: "pass" | "fail";
  by: string;
  date: string;
  hash: string;
  report: string;
  createdAt?: string;
}

export type Category = (typeof categories)[number];
export type Status = (typeof statuses)[number];
export type Source = z.infer<typeof sourceSchema>;
export type Bibliography = Record<string, Source>;
export type IdeaDate = z.infer<typeof dateSchema>;
export type Review = z.infer<typeof reviewSchema>;

export type EventKind = (typeof eventKinds)[number];

/** What the browser receives: content pre-rendered at build time. */
interface Rendered {
  bodyHtml: string;
  /** Plain-text description of the date, citations resolved. */
  dateText: string;
  references: { key: string; html: string }[];
}

export type RenderedEvent = Omit<HistoricalEvent, "body" | "sources" | "aliases"> & Rendered;
