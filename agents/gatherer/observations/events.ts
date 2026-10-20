import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import { eventKinds, type HistoricalEvent } from "../../../src/content/schema.ts";
import { addAliases, loadEvent, putEvent } from "../../../kg/src/repository.ts";
import { checkEntityRefs, EntityRef, writeEntities } from "../../core/entities.ts";
import { uniqueId } from "../../core/slug.ts";
import { Citation, quote } from "../../core/sources.ts";
import type { ObservationType } from "./types.ts";

const ObservedEvent = z.strictObject({
  existing_id: z.string().nullable().describe("Id of the same event already in the graph (from find_similar_events), or null if new"),
  title: z.string(),
  kind: z.enum(eventKinds),
  place: z.string().describe("Short: the site, with its modern location if known, e.g. 'Girsu (modern Tello, Iraq)'"),
  summary: z.string().describe("One or two neutral sentences, at most 320 characters, no citations"),
  aliases: z.array(z.string()).describe("Other names sources use for this event"),
  year: z.number().describe("Placement year within the requested period; negative = BCE"),
  earliest: z.number().nullable().describe("Earliest scholarly estimate, if sources give a range"),
  latest: z.number().nullable().describe("Latest scholarly estimate, if sources give a range"),
  approx: z.boolean(),
  date_marks: z.string().describe("What the year marks, including the chronology it rests on"),
  date_note: z.string().nullable().describe("Chronological disagreement worth telling readers; no citations"),
  citations: z.array(Citation).describe("At least one; excerpts must support the event and its date"),
  entities: z.array(EntityRef),
});

type ObservedEvent = z.infer<typeof ObservedEvent>;

const int = (n: number | null) => n === null || Number.isInteger(n);

export const events: ObservationType<ObservedEvent> = {
  name: "events",
  noun: "event",
  guidance: readFileSync(join(import.meta.dirname, "events.md"), "utf8"),
  item: ObservedEvent,
  describe: (e) => `"${e.title}"`,
  citations: (e) => e.citations,

  check(e, at, ctx) {
    const problems: string[] = [];
    if (e.existing_id && !ctx.exists(e.existing_id)) problems.push(`${at}: no event with id "${e.existing_id}"`);
    if (!e.title.trim() || !e.place.trim() || !e.summary.trim() || !e.date_marks.trim()) problems.push(`${at}: title, place, summary and date_marks are required`);
    if (e.summary.length > 320) problems.push(`${at}: summary is ${e.summary.length} characters; the limit is 320`);
    if (/\[@/.test(e.summary + e.title + (e.date_note ?? ""))) problems.push(`${at}: citations go in citations, not in the title, summary or date_note`);
    if (!int(e.year) || !int(e.earliest) || !int(e.latest)) problems.push(`${at}: years must be integers`);
    if (e.year === 0 || e.earliest === 0 || e.latest === 0) problems.push(`${at}: there is no year 0 (1 BCE is -1, 1 CE is 1)`);
    if (e.year < ctx.from || e.year > ctx.to) problems.push(`${at}: year ${e.year} is outside the requested period (${ctx.from} to ${ctx.to})`);
    if (e.earliest !== null && e.earliest > e.year) problems.push(`${at}: earliest (${e.earliest}) is after year (${e.year})`);
    if (e.latest !== null && e.latest < e.year) problems.push(`${at}: latest (${e.latest}) is before year (${e.year})`);
    if (!e.citations.length) problems.push(`${at}: at least one citation is required`);
    if (e.citations.some((c) => /\[@/.test(c.excerpt))) problems.push(`${at}: an excerpt can't contain "[@"`);
    problems.push(...checkEntityRefs(at, e.entities, ctx.entityExists));
    return problems;
  },

  async write(tx, items, ctx) {
    const created: string[] = [];
    const updated: string[] = [];
    const taken = new Set<string>();
    const seenEntities = new Map<string, string>();
    let entities = 0;

    for (const e of items) {
      let id = e.existing_id;
      if (id) {
        const existing = (await loadEvent(tx, id))!;
        const fresh = e.citations.filter((c) => !existing.sources.includes(c.source_key));
        if (fresh.length) {
          const sources = [...existing.sources, ...new Set(fresh.map((c) => c.source_key))];
          await putEvent(tx, { ...existing, sources, body: [existing.body, ...fresh.map(quote)].filter(Boolean).join("\n\n") });
          updated.push(id);
        }
        if (e.aliases.length) await addAliases(tx, "Event", id, e.aliases);
      } else {
        id = await uniqueId(tx, "Event", e.title, taken);
        taken.add(id);
        const event: HistoricalEvent = {
          id,
          title: e.title.trim(),
          kind: e.kind,
          status: "sourced",
          date: {
            year: e.year,
            marks: e.date_marks.trim(),
            earliest: e.earliest ?? undefined,
            latest: e.latest ?? undefined,
            approx: e.approx,
            note: e.date_note?.trim() || undefined,
          },
          place: e.place.trim(),
          summary: e.summary.trim(),
          aliases: e.aliases,
          sources: [...new Set(e.citations.map((c) => c.source_key))],
          body: e.citations.map(quote).join("\n\n"),
        };
        await putEvent(tx, event);
        created.push(id);
      }
      entities += await writeEntities(tx, "Event", id, e.entities, ctx.runId, seenEntities);
    }
    return { created, updated, entities };
  },
};
