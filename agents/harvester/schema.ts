import { toJSONSchema, z } from "zod/v4";
import { eventKinds } from "../../src/content/schema.ts";
import type { EvidenceLedger } from "../core/evidence.ts";

// The harvester's structured output (one response per document chunk) and the
// per-event checks the harness applies. Invalid events are dropped one by one;
// there are no retries, because a re-ask costs more than the event is worth.

const Excerpt = z.strictObject({
  text: z.string().describe("Verbatim passage from the document, at most 40 words"),
  locator: z.string().nullable().describe("Where it is: 'PDF p. 4', 'Table 2', or a section heading"),
});

export const HarvestedEvent = z.strictObject({
  title: z.string(),
  kind: z.enum(eventKinds),
  place: z.string(),
  summary: z.string(),
  year: z.number(),
  earliest: z.number().nullable(),
  latest: z.number().nullable(),
  approx: z.boolean(),
  date_marks: z.string(),
  date_note: z.string().nullable(),
  excerpts: z.array(Excerpt),
});

export const HarvestOutput = z.strictObject({ events: z.array(HarvestedEvent) });

export type HarvestedEvent = z.infer<typeof HarvestedEvent>;

/** The JSON schema for output_config.format. */
export function harvestJsonSchema(): Record<string, unknown> {
  const { $schema: _s, ...schema } = toJSONSchema(HarvestOutput, { target: "draft-7" }) as Record<string, unknown>;
  return schema;
}

const MIN_YEAR = -4_000_000;
const MAX_YEAR = 2100;
const isYear = (y: number | null) => y === null || (Number.isInteger(y) && y !== 0 && y >= MIN_YEAR && y <= MAX_YEAR);

/** Why an extracted event can't be used, or [] if it can. */
export function checkHarvested(e: HarvestedEvent, url: string, evidence: EvidenceLedger): string[] {
  const problems: string[] = [];
  if (!e.title.trim() || !e.place.trim() || !e.summary.trim() || !e.date_marks.trim()) problems.push("missing title, place, summary or date_marks");
  if (e.summary.length > 320) problems.push("summary over 320 characters");
  if (!isYear(e.year) || !isYear(e.earliest) || !isYear(e.latest)) problems.push("years must be whole numbers, not 0, within range");
  if (e.earliest !== null && e.earliest > e.year) problems.push("earliest after year");
  if (e.latest !== null && e.latest < e.year) problems.push("latest before year");
  if (/\[@/.test(e.title + e.summary + e.place + e.date_marks + (e.date_note ?? ""))) problems.push("citation syntax in a field");
  if (!e.excerpts.length) problems.push("no excerpts");
  for (const x of e.excerpts) {
    if (x.text.split(/\s+/).length > 45) problems.push(`excerpt over 40 words: "${x.text.slice(0, 60)}…"`);
    else if (/\[@|\n/.test(x.text)) problems.push("excerpt contains citation syntax or a line break");
    else if (!evidence.locateIn(x.text, url)) problems.push(`excerpt not verbatim: "${x.text.slice(0, 60)}…"`);
  }
  return problems;
}
