import { ideaFieldsSchema, sourceSchema, type Idea, type Source } from "../../src/content/schema.ts";

// Translation between content objects and graph properties. Neo4j properties
// are flat (no nested maps) and can't be null, so the idea's date is flattened
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

/** Idea properties, excluding its sources (CITES relationships) and embedding. */
export function ideaToProps(idea: Idea): Props {
  return compact({
    id: idea.id,
    title: idea.title,
    category: idea.category,
    status: idea.status,
    origin: idea.origin,
    summary: idea.summary,
    aliases: idea.aliases,
    body: idea.body,
    year: idea.date.year,
    marks: idea.date.marks,
    earliest: idea.date.earliest,
    latest: idea.date.latest,
    approx: idea.date.approx,
    dateNote: idea.date.note,
    reviewBy: idea.review?.by,
    reviewDate: idea.review?.date,
    reviewHash: idea.review?.hash,
  });
}

export function propsToIdea(p: Record<string, unknown>, sources: string[]): Idea {
  const date = compact({ year: p.year, marks: p.marks, earliest: p.earliest, latest: p.latest, approx: p.approx, note: p.dateNote });
  const review = p.reviewHash ? { by: p.reviewBy, date: p.reviewDate, hash: p.reviewHash } : undefined;
  const fields = ideaFieldsSchema.parse(
    compact({ id: p.id, title: p.title, category: p.category, status: p.status, date, origin: p.origin, summary: p.summary, aliases: p.aliases, sources, review }),
  );
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
