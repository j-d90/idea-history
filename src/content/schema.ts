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

export const statuses = ["draft", "sourced", "reviewed"] as const;

const year = z.number().int().min(-10000).max(2100);

export const sourceSchema = z
  .object({
    /** Short handle so `buildsOn` links can cite this source, e.g. "schmandt-besserat-1996". */
    key: z.string().regex(/^[a-z0-9-]+$/, "use lowercase letters, digits and hyphens"),
    /** primary: the original work. secondary: scholarship about it. reference: encyclopedias and surveys. */
    type: z.enum(["primary", "secondary", "reference"]),
    title: z.string().min(1),
    author: z.string().optional(),
    publisher: z.string().optional(),
    year: z.union([year, z.string()]).optional(),
    url: z
      .string()
      .url()
      .refine((u) => /^https?:\/\//.test(u), "url must be http(s)")
      .optional(),
    /** Page, chapter or section. */
    locator: z.string().optional(),
    /** ISO date the URL was last checked. */
    accessed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD").optional(),
    note: z.string().optional(),
  })
  .strict()
  .refine((s) => s.url || s.publisher, {
    message: "a source needs a url or a publisher so it can be found",
  });

export const dateSchema = z
  .object({
    /** The year used for placement on the timeline. Negative years are BCE. */
    year,
    /** Bounds of scholarly estimates, when they differ from `year`. */
    earliest: year.optional(),
    latest: year.optional(),
    approx: z.boolean().default(false),
    /** Why the date is uncertain or contested. */
    note: z.string().optional(),
  })
  .strict()
  .refine((d) => d.earliest === undefined || d.earliest <= d.year, {
    message: "earliest must be <= year",
  })
  .refine((d) => d.latest === undefined || d.latest >= d.year, {
    message: "latest must be >= year",
  });

export const linkSchema = z
  .object({
    id: z.string(),
    /** One line on how this idea draws on the earlier one. */
    why: z.string().optional(),
    /** Keys into this idea's `sources`. */
    sources: z.array(z.string()).default([]),
  })
  .strict();

export const frontmatterSchema = z
  .object({
    title: z.string().min(1),
    category: z.enum(categories),
    status: z.enum(statuses),
    date: dateSchema,
    /** Who / where, shown as a short byline. */
    origin: z.string().min(1),
    summary: z.string().min(1).max(320),
    buildsOn: z.array(linkSchema).default([]),
    sources: z.array(sourceSchema).default([]),
  })
  .strict();

export type Category = (typeof categories)[number];
export type Status = (typeof statuses)[number];
export type Source = z.infer<typeof sourceSchema>;
export type IdeaDate = z.infer<typeof dateSchema>;
export type Link = z.infer<typeof linkSchema>;

export type Idea = z.infer<typeof frontmatterSchema> & {
  /** From the filename. */
  id: string;
  /** Markdown body: longer-form notes. */
  body: string;
};
