import { eventFieldsSchema, ideaFieldsSchema, isIdea, sourceSchema, type Entry, type HistoricalEvent, type Idea, type Source } from "../../src/content/schema.ts";

// Translation between content objects and graph properties. Neo4j properties
// are flat (no nested maps) and can't be null, so an entry's date is flattened
// and absent values are omitted. Reading back goes through the same zod schemas
// as editing, so every path produces identical objects (and content hashes).

type Props = Record<string, string | number | boolean | string[]>;

export const ROLES = ["author", "editor", "translator"] as const;
export type Role = (typeof ROLES)[number];
export interface Contributor {
  name: string;
  role: Role;
  order: number;
}

export function compact(obj: Record<string, unknown>): Props {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)) as Props;
}

/** Idea or event properties, excluding its sources (CITES relationships) and embedding. */
export function entryToProps(entry: Entry): Props {
  return compact({
    id: entry.id,
    title: entry.title,
    ...(isIdea(entry) ? { category: entry.category, origin: entry.origin } : { kind: entry.kind, place: entry.place }),
    status: entry.status,
    summary: entry.summary,
    aliases: entry.aliases,
    body: entry.body,
    year: entry.date.year,
    marks: entry.date.marks,
    earliest: entry.date.earliest,
    latest: entry.date.latest,
    approx: entry.date.approx,
    dateNote: entry.date.note,
    reviewBy: entry.review?.by,
    reviewDate: entry.review?.date,
    reviewHash: entry.review?.hash,
  });
}

function commonFields(p: Record<string, unknown>, sources: string[]) {
  const date = compact({ year: p.year, marks: p.marks, earliest: p.earliest, latest: p.latest, approx: p.approx, note: p.dateNote });
  const review = p.reviewHash ? { by: p.reviewBy, date: p.reviewDate, hash: p.reviewHash } : undefined;
  return compact({ id: p.id, title: p.title, status: p.status, date, summary: p.summary, aliases: p.aliases, sources, review });
}

export function propsToIdea(p: Record<string, unknown>, sources: string[]): Idea {
  const fields = ideaFieldsSchema.parse({ ...commonFields(p, sources), ...compact({ category: p.category, origin: p.origin }) });
  return { ...fields, body: (p.body as string | undefined) ?? "" };
}

export function propsToEvent(p: Record<string, unknown>, sources: string[]): HistoricalEvent {
  const fields = eventFieldsSchema.parse({ ...commonFields(p, sources), ...compact({ kind: p.kind, place: p.place }) });
  return { ...fields, body: (p.body as string | undefined) ?? "" };
}

/** Source properties without the people, who become Person nodes. */
export function sourceToProps(s: Source): { props: Props; people: Contributor[] } {
  const { authors, editors, translators, ...rest } = s;
  const people = [
    ...authors.map((name, order) => ({ name, role: "author" as const, order })),
    ...editors.map((name, order) => ({ name, role: "editor" as const, order })),
    ...translators.map((name, order) => ({ name, role: "translator" as const, order })),
  ];
  return { props: compact(rest), people };
}

export function propsToSource(p: Record<string, unknown>, people: Contributor[]): Source {
  const { key: _key, ...rest } = p;
  const byRole = (role: Role) => people.filter((x) => x.role === role).sort((a, b) => a.order - b.order).map((x) => x.name);
  return sourceSchema.parse({ ...rest, authors: byRole("author"), editors: byRole("editor"), translators: byRole("translator") });
}
