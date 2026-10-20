import type { Idea, Source } from "../../src/content/schema.ts";

// Translation between content objects and graph properties. Neo4j properties
// are flat (no nested maps) and can't be null, so the idea's date is flattened
// and absent values are omitted. Reading back goes through the same zod schemas
// the file loader uses, so both stores produce identical objects and hashes.

type Props = Record<string, string | number | boolean | string[]>;

export const ROLES = ["author", "editor", "translator"] as const;
export type Role = (typeof ROLES)[number];

export function compact(obj: Record<string, unknown>): Props {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)) as Props;
}

export function ideaToProps(idea: Idea): Props {
  return compact({
    title: idea.title,
    category: idea.category,
    status: idea.status,
    origin: idea.origin,
    summary: idea.summary,
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

/** Raw frontmatter-shaped object from graph properties, ready for frontmatterSchema.parse. */
export function propsToFrontmatter(p: Record<string, unknown>, links: unknown[], sources: string[]): Record<string, unknown> {
  const date = compact({ year: p.year, marks: p.marks, earliest: p.earliest, latest: p.latest, approx: p.approx, note: p.dateNote });
  const review = p.reviewHash ? { by: p.reviewBy, date: p.reviewDate, hash: p.reviewHash } : undefined;
  return compact({ title: p.title, category: p.category, status: p.status, date, origin: p.origin, summary: p.summary, buildsOn: links, sources, review });
}

/** Source properties without the people, who become Person nodes. */
export function sourceToProps(s: Source): { props: Props; people: { name: string; role: Role; order: number }[] } {
  const { authors, editors, translators, ...rest } = s;
  const people = [
    ...authors.map((name, order) => ({ name, role: "author" as const, order })),
    ...editors.map((name, order) => ({ name, role: "editor" as const, order })),
    ...translators.map((name, order) => ({ name, role: "translator" as const, order })),
  ];
  return { props: compact(rest), people };
}

export function propsToSource(p: Record<string, unknown>, people: { name: string; role: Role; order: number }[]): Record<string, unknown> {
  const { key: _key, ...rest } = p;
  const byRole = (role: Role) => people.filter((x) => x.role === role).sort((a, b) => a.order - b.order).map((x) => x.name);
  return { ...rest, authors: byRole("author"), editors: byRole("editor"), translators: byRole("translator") };
}
