import neo4j, { type Driver, type ManagedTransaction } from "neo4j-driver";
import { checkContent, checkEntry, contentHash, ContentError, entryKey, isVerified } from "../../src/content/rules.ts";
import {
  emergenceSchema,
  ideaLinkSchema,
  labelOf,
  linkTypes,
  statusFor,
  type Bibliography,
  type Emergence,
  type Entity,
  type Entry,
  type EntryLabel,
  type HistoricalEvent,
  type Idea,
  type IdeaLink,
  type ReviewRecord,
  type Source,
} from "../../src/content/schema.ts";
import { compact, entryToProps, HARVEST_PROPS, propsToEvent, propsToIdea, propsToSource, sourceToProps, type Contributor } from "./mapping.ts";

// The knowledge graph is the content store. Every read and write of ideas,
// events, sources, links, entities and reviews goes through this module.

type Tx = ManagedTransaction;
const LINK_TYPES = linkTypes.join("|");

export interface Content {
  ideas: Idea[];
  events: HistoricalEvent[];
  bibliography: Bibliography;
  links: IdeaLink[];
  emergences: Emergence[];
  /** Keyed by entryKey(label, id). */
  latestReviews: Map<string, ReviewRecord>;
}

// ---------- Reads ----------

/** Load all content. With `validate`, throws ContentError if any rule is broken. */
export async function loadContent(driver: Driver, opts: { validate?: boolean } = {}): Promise<Content> {
  const session = driver.session();
  try {
    return await session.executeRead(async (tx) => {
      const bibliography = await loadSources(tx);
      const ideas = await loadEntries(tx, "Idea");
      const events = await loadEntries(tx, "Event");
      const links = await loadLinks(tx);
      const emergences = await loadEmergences(tx);
      const latestReviews = await loadLatestReviews(tx);
      const content = { ideas, events, bibliography, links, emergences, latestReviews };
      if (opts.validate) {
        const problems = checkContent(content);
        if (problems.length) throw new ContentError(problems);
      }
      return content;
    });
  } finally {
    await session.close();
  }
}

type EntryOf<L extends EntryLabel> = L extends "Idea" ? Idea : HistoricalEvent;

/** Ideas or events, sorted by year, optionally filtered by id or year range. */
export async function loadEntries<L extends EntryLabel>(tx: Tx, label: L, f: { ids?: string[]; from?: number; to?: number } = {}): Promise<EntryOf<L>[]> {
  const res = await tx.run(
    `MATCH (n:${label})
     WHERE ($ids IS NULL OR n.id IN $ids) AND ($from IS NULL OR n.year >= $from) AND ($to IS NULL OR n.year <= $to)
     OPTIONAL MATCH (n)-[c:CITES]->(s:Source)
     WITH n, c, s ORDER BY c.order
     RETURN n {.*, embedding: null, embeddingHash: null} AS p, [k IN collect(s.key) WHERE k IS NOT NULL] AS sources`,
    { ids: f.ids ?? null, from: f.from ?? null, to: f.to ?? null },
  );
  const toEntry = label === "Idea" ? propsToIdea : propsToEvent;
  const entries = res.records.map((r) => toEntry(r.get("p"), r.get("sources")) as EntryOf<L>);
  return entries.sort((a, b) => a.date.year - b.date.year || a.id.localeCompare(b.id));
}

export async function loadEntry<L extends EntryLabel>(tx: Tx, label: L, id: string): Promise<EntryOf<L> | undefined> {
  return (await loadEntries(tx, label, { ids: [id] }))[0];
}

export const loadIdea = (tx: Tx, id: string) => loadEntry(tx, "Idea", id);
export const loadEvent = (tx: Tx, id: string) => loadEntry(tx, "Event", id);

/** Sources by key (all of them if `keys` is omitted). */
export async function loadSources(tx: Tx, keys?: string[]): Promise<Bibliography> {
  const res = await tx.run(
    `MATCH (s:Source) WHERE $keys IS NULL OR s.key IN $keys
     OPTIONAL MATCH (p:Person)-[r:CONTRIBUTED]->(s)
     WITH s, collect(CASE WHEN p IS NULL THEN NULL ELSE {name: p.name, role: r.role, order: r.order} END) AS people
     RETURN s.key AS key, properties(s) AS props, people ORDER BY key`,
    { keys: keys ?? null },
  );
  const bib: Bibliography = {};
  for (const r of res.records) bib[r.get("key")] = propsToSource(r.get("props"), r.get("people") as Contributor[]);
  return bib;
}

export async function loadLinks(tx: Tx, from?: string): Promise<IdeaLink[]> {
  const res = await tx.run(
    `MATCH (a:Idea)-[l:${LINK_TYPES}]->(b:Idea) WHERE $from IS NULL OR a.id = $from
     RETURN a.id AS from, b.id AS to, type(l) AS type, properties(l) AS props ORDER BY from, to`,
    { from: from ?? null },
  );
  return res.records.map((r) => {
    const { createdAt: _c, ...props } = r.get("props") as Record<string, unknown>;
    return ideaLinkSchema.parse(compact({ ...props, from: r.get("from"), to: r.get("to"), type: r.get("type") }));
  });
}

/** Emergences, optionally only those of one idea or into the given events. */
export async function loadEmergences(tx: Tx, f: { idea?: string; events?: string[] } = {}): Promise<Emergence[]> {
  const res = await tx.run(
    `MATCH (i:Idea)-[r:EMERGES_IN]->(e:Event)
     WHERE ($idea IS NULL OR i.id = $idea) AND ($events IS NULL OR e.id IN $events)
     RETURN i.id AS idea, e.id AS event, properties(r) AS props ORDER BY e.year, idea`,
    { idea: f.idea ?? null, events: f.events ?? null },
  );
  return res.records.map((r) => {
    const { createdAt: _c, ...props } = r.get("props") as Record<string, unknown>;
    return emergenceSchema.parse(compact({ ...props, idea: r.get("idea"), event: r.get("event") }));
  });
}

/** The latest review of every reviewed entry, keyed by entryKey(label, id). */
export async function loadLatestReviews(tx: Tx): Promise<Map<string, ReviewRecord>> {
  const res = await tx.run(
    `MATCH (r:Review)-[:REVIEWS]->(n)
     WITH n, r ORDER BY r.createdAt DESC
     WITH n, head(collect(r)) AS r
     RETURN head(labels(n)) AS label, n.id AS id, r {.runId, .verdict, mode: coalesce(r.mode, "full"), .by, .date, .hash, .report, createdAt: toString(r.createdAt)} AS r`,
  );
  return new Map(
    res.records.map((rec) => [entryKey(rec.get("label"), rec.get("id")), { label: rec.get("label"), id: rec.get("id"), ...rec.get("r") } as ReviewRecord]),
  );
}

/** An entry, its cited sources, and the content hash a review would vouch for. */
export async function loadSubject(tx: Tx, label: EntryLabel, id: string) {
  const entry = await loadEntry(tx, label, id);
  if (!entry) throw new Error(`no such ${label.toLowerCase()}: ${id}`);
  const sources = await loadSources(tx, entry.sources);
  return { label, entry, sources, hash: contentHash(entry, sources) };
}

// ---------- Writes ----------

export interface PutResult {
  created: boolean;
  /** The idea was reviewed and its content changed, so it went back to "sourced". */
  reviewInvalidated: boolean;
}

/**
 * Create or update an idea or event, validating it against the graph first.
 * Authors can't set "checked" or "reviewed": those statuses (and the review
 * record) are kept only while the verified content is unchanged; any change sends
 * the entry back to "sourced". `updatedAt` moves only when the content or status changes.
 */
export async function putEntry(tx: Tx, incoming: Entry): Promise<PutResult> {
  const label = labelOf(incoming);
  const existing = await loadEntry(tx, label, incoming.id);
  const sources = await loadSources(tx, [...new Set([...incoming.sources, ...(existing?.sources ?? [])])]);
  const entry: Entry = { ...incoming, review: undefined };
  let reviewInvalidated = false;

  if (isVerified(incoming.status) || incoming.review) {
    const unchanged = existing?.status === incoming.status && existing.review && existing.review.hash === contentHash(incoming, sources);
    if (!existing || existing.status !== incoming.status) {
      throw new ContentError([`only the fact-checker can mark ${incoming.id} ${isVerified(incoming.status) ? incoming.status : "checked or reviewed"}`]);
    }
    if (unchanged) entry.review = existing.review;
    else {
      entry.status = "sourced";
      reviewInvalidated = true;
    }
  } else if (existing && isVerified(existing.status)) {
    reviewInvalidated = true;
  }

  const problems = checkEntry(entry, sources);
  if (problems.length) throw new ContentError(problems.map((p) => `${label.toLowerCase()} ${entry.id}: ${p}`));
  const changed = !existing || existing.status !== entry.status || contentHash(existing, sources) !== contentHash(entry, sources);

  await tx.run(
    `MERGE (n:${label} {id: $id})
     WITH n, n {.embedding, .embeddingHash, .createdAt, .updatedAt} AS keep
     SET n = $props, n.embedding = keep.embedding, n.embeddingHash = keep.embeddingHash,
         n.createdAt = coalesce(keep.createdAt, datetime()),
         n.updatedAt = CASE WHEN $changed OR keep.updatedAt IS NULL THEN datetime() ELSE keep.updatedAt END
     WITH n
     OPTIONAL MATCH (n)-[old:CITES]->() DELETE old
     WITH DISTINCT n
     UNWIND range(0, size($sources) - 1) AS i
     MATCH (s:Source {key: $sources[i]})
     CREATE (n)-[:CITES {order: i}]->(s)`,
    { id: entry.id, props: entryToProps(entry), sources: entry.sources, changed },
  );
  return { created: !existing, reviewInvalidated };
}

export const putIdea = (tx: Tx, idea: Idea) => putEntry(tx, idea);
export const putEvent = (tx: Tx, event: HistoricalEvent) => putEntry(tx, event);

/** Create or update a source and its contributors. Its harvest bookkeeping is kept. */
export async function putSource(tx: Tx, key: string, source: Source): Promise<void> {
  const { props, people } = sourceToProps(source);
  await tx.run(
    `MERGE (s:Source {key: $key})
     WITH s, s {${HARVEST_PROPS.map((p) => `.${p}`).join(", ")}} AS keep
     SET s = $props, s.key = $key, s += keep
     WITH s
     OPTIONAL MATCH (s)<-[old:CONTRIBUTED]-() DELETE old
     WITH DISTINCT s
     UNWIND $people AS p
     MERGE (person:Person {name: p.name})
     CREATE (person)-[:CONTRIBUTED {role: p.role, order: p.order}]->(s)`,
    { key, props, people },
  );
}

/**
 * Replace an idea's outgoing links of the given origins with `links`. Reviewed
 * links are kept unless replaced by a link to the same idea.
 */
export async function replaceLinks(tx: Tx, from: string, origins: IdeaLink["origin"][], links: IdeaLink[]): Promise<void> {
  const targets = links.map((l) => l.to);
  await tx.run(
    `MATCH (:Idea {id: $from})-[l:${LINK_TYPES}]->(b:Idea)
     WHERE (l.origin IN $origins AND l.status <> "reviewed") OR b.id IN $targets
     DELETE l`,
    { from, origins, targets },
  );
  for (const link of links) {
    const { from: _f, to, type, ...props } = ideaLinkSchema.parse(link);
    await tx.run(
      `MATCH (a:Idea {id: $from}), (b:Idea {id: $to})
       CREATE (a)-[l:${type}]->(b)
       SET l = $props, l.createdAt = datetime()`,
      { from, to, props: compact(props) },
    );
  }
}

/**
 * Replace the unreviewed emergences into the given events with `emergences`
 * (each of which must point into one of those events).
 */
export async function replaceEmergences(tx: Tx, eventIds: string[], emergences: Emergence[]): Promise<void> {
  await tx.run(`MATCH (:Idea)-[r:EMERGES_IN]->(e:Event) WHERE e.id IN $eventIds AND r.status <> "reviewed" DELETE r`, { eventIds });
  for (const em of emergences) {
    const { idea, event, ...props } = emergenceSchema.parse(em);
    if (!eventIds.includes(event)) throw new Error(`emergence into ${event}, which is outside the events being replaced`);
    await tx.run(
      `MATCH (i:Idea {id: $idea}), (e:Event {id: $event})
       MERGE (i)-[r:EMERGES_IN]->(e)
       SET r = $props, r.createdAt = datetime()`,
      { idea, event, props: compact(props) },
    );
  }
}

export async function addReview(tx: Tx, r: Omit<ReviewRecord, "createdAt">): Promise<void> {
  const params = { runId: r.runId, id: r.id, by: r.by, date: r.date, hash: r.hash, verdict: r.verdict, mode: r.mode, report: r.report, status: statusFor[r.mode] };
  await tx.run(
    `MATCH (n:${r.label} {id: $id})
     CREATE (rev:Review {runId: $runId, mode: $mode, by: $by, date: $date, hash: $hash, verdict: $verdict, report: $report, createdAt: datetime()})-[:REVIEWS]->(n)`,
    params,
  );
  if (r.verdict === "pass") {
    await tx.run(`MATCH (n:${r.label} {id: $id}) SET n.status = $status, n.reviewBy = $by, n.reviewDate = $date, n.reviewHash = $hash`, params);
  } else {
    // A failed check or review leaves the entry sourced, whatever it was before.
    await tx.run(`MATCH (n:${r.label} {id: $id}) WHERE n.status IN ["checked", "reviewed"] SET n.status = "sourced" REMOVE n.reviewBy, n.reviewDate, n.reviewHash`, params);
  }
}

export async function upsertEntity(tx: Tx, e: Entity, runId?: string): Promise<void> {
  await tx.run(
    `MERGE (n:Entity {id: $id})
     ON CREATE SET n.name = $name, n.kind = $kind, n.aliases = [], n.createdBy = $runId
     SET n.description = coalesce(n.description, $description),
         n.aliases = reduce(acc = coalesce(n.aliases, []), a IN $aliases | CASE WHEN a IN acc OR a = n.name THEN acc ELSE acc + a END)`,
    { id: e.id, name: e.name, kind: e.kind, description: e.description ?? null, aliases: e.aliases, runId: runId ?? null },
  );
}

/** Union new aliases into an entry's (search metadata; doesn't affect its review). */
export async function addAliases(tx: Tx, label: EntryLabel, id: string, aliases: string[]): Promise<void> {
  await tx.run(
    `MATCH (n:${label} {id: $id})
     SET n.aliases = reduce(acc = coalesce(n.aliases, []), a IN $aliases | CASE WHEN a IN acc OR a = n.title THEN acc ELSE acc + a END)`,
    { id, aliases },
  );
}

export async function linkEntity(tx: Tx, label: EntryLabel, id: string, entityId: string, role: string, runId: string): Promise<void> {
  await tx.run(
    `MATCH (n:${label} {id: $id}), (e:Entity {id: $entityId})
     MERGE (n)-[r:INVOLVES {role: $role}]->(e)
     ON CREATE SET r.runId = $runId`,
    { id, entityId, role, runId },
  );
}

/** Record that a source discusses an idea, with the supporting excerpt. */
export async function addDiscusses(tx: Tx, sourceKey: string, ideaId: string, d: { evidence: string; locator?: string; runId: string }): Promise<void> {
  await tx.run(
    `MATCH (s:Source {key: $sourceKey}), (i:Idea {id: $ideaId})
     MERGE (s)-[r:DISCUSSES]->(i)
     SET r.evidence = $evidence, r.locator = $locator, r.runId = $runId`,
    { sourceKey, ideaId, evidence: d.evidence, locator: d.locator ?? null, runId: d.runId },
  );
}

// ---------- Harvesting sources ----------

export type HarvestStatus = "pending" | "done" | "failed";

export interface HarvestState {
  status: HarvestStatus;
  events?: number;
  note?: string;
  foundBy?: string;
  foundFor?: string;
}

export async function setHarvest(tx: Tx, key: string, h: HarvestState): Promise<void> {
  await tx.run(
    `MATCH (s:Source {key: $key})
     SET s.harvestStatus = $status, s.harvestEvents = $events, s.harvestNote = $note,
         s.harvestedAt = CASE WHEN $status = "pending" THEN null ELSE datetime() END,
         s.foundBy = coalesce($foundBy, s.foundBy), s.foundFor = coalesce($foundFor, s.foundFor)`,
    { key, status: h.status, events: h.events ?? null, note: h.note ?? null, foundBy: h.foundBy ?? null, foundFor: h.foundFor ?? null },
  );
}

/** Sources waiting to be harvested, oldest first. */
export async function pendingHarvests(tx: Tx, limit?: number): Promise<string[]> {
  const res = await tx.run(
    `MATCH (s:Source {harvestStatus: "pending"}) RETURN s.key AS key ORDER BY coalesce(s.foundFor, ""), s.key` + (limit ? ` LIMIT $limit` : ""),
    { limit: neo4j.int(limit ?? 0) },
  );
  return res.records.map((r) => r.get("key"));
}

/** Harvest bookkeeping for every source that has any. */
export async function harvestStates(tx: Tx): Promise<Record<string, HarvestState & { harvestedAt?: string }>> {
  const res = await tx.run(
    `MATCH (s:Source) WHERE s.harvestStatus IS NOT NULL
     RETURN s.key AS key, s {status: s.harvestStatus, events: s.harvestEvents, note: s.harvestNote, foundBy: s.foundBy, foundFor: s.foundFor, harvestedAt: toString(s.harvestedAt)} AS h`,
  );
  return Object.fromEntries(res.records.map((r) => [r.get("key"), compact(r.get("h")) as unknown as HarvestState]));
}

/** Every source URL in the graph, so finders don't propose a document twice. */
export async function sourceUrls(tx: Tx): Promise<Map<string, string>> {
  const res = await tx.run(`MATCH (s:Source) WHERE s.url IS NOT NULL RETURN s.url AS url, s.key AS key`);
  return new Map(res.records.map((r) => [r.get("url") as string, r.get("key") as string]));
}

// ---------- Embeddings and similarity ----------

export type Embeddable = "Idea" | "Event" | "Entity";

export async function setEmbedding(tx: Tx, label: Embeddable, id: string, vector: number[], hash: string): Promise<void> {
  await tx.run(`MATCH (n:${label} {id: $id}) SET n.embedding = $vector, n.embeddingHash = $hash`, { id, vector, hash });
}

export interface Similar {
  id: string;
  score: number;
  title: string;
  year?: number;
  status?: string;
  kind?: string;
}

/** Nearest ideas by vector, optionally only those dated at or before `maxYear`. */
export async function similarIdeas(
  tx: Tx,
  vector: number[],
  opts: { k: number; maxYear?: number; exclude?: string[]; includeCandidates?: boolean },
): Promise<Similar[]> {
  const res = await tx.run(
    `CALL db.index.vector.queryNodes('idea_embedding', $fetch, $vector) YIELD node, score
     WHERE ($maxYear IS NULL OR node.year <= $maxYear)
       AND NOT node.id IN $exclude
       AND ($includeCandidates OR node.status <> "candidate")
     RETURN node.id AS id, score, node.title AS title, node.year AS year, node.status AS status
     LIMIT $k`,
    // LIMIT and the index's k must be integers; plain JS numbers are sent as floats.
    { vector, fetch: neo4j.int(opts.k * 4), k: neo4j.int(opts.k), maxYear: opts.maxYear ?? null, exclude: opts.exclude ?? [], includeCandidates: !!opts.includeCandidates },
  );
  return res.records.map((r) => r.toObject() as Similar);
}

/** Nearest events by vector, optionally within a year range. */
export async function similarEvents(tx: Tx, vector: number[], opts: { k: number; from?: number; to?: number; exclude?: string[] }): Promise<Similar[]> {
  const res = await tx.run(
    `CALL db.index.vector.queryNodes('event_embedding', $fetch, $vector) YIELD node, score
     WHERE ($from IS NULL OR node.year >= $from) AND ($to IS NULL OR node.year <= $to) AND NOT node.id IN $exclude
     RETURN node.id AS id, score, node.title AS title, node.year AS year, node.status AS status, node.kind AS kind
     LIMIT $k`,
    { vector, fetch: neo4j.int(opts.k * 4), k: neo4j.int(opts.k), from: opts.from ?? null, to: opts.to ?? null, exclude: opts.exclude ?? [] },
  );
  return res.records.map((r) => r.toObject() as Similar);
}

/** The stored embedding of a node, if it has one. */
export async function nodeEmbedding(tx: Tx, label: Embeddable, id: string): Promise<number[] | undefined> {
  const res = await tx.run(`MATCH (n:${label} {id: $id}) RETURN n.embedding AS v`, { id });
  return (res.records[0]?.get("v") as number[] | null) ?? undefined;
}

export async function similarEntities(tx: Tx, vector: number[], k: number): Promise<Similar[]> {
  const res = await tx.run(
    `CALL db.index.vector.queryNodes('entity_embedding', $k, $vector) YIELD node, score
     RETURN node.id AS id, score, node.name AS title, node.kind AS kind`,
    { vector, k: neo4j.int(k) },
  );
  return res.records.map((r) => r.toObject() as Similar);
}

/** Every embeddable node with the text it should be embedded from and the hash of what it was embedded from. */
export async function staleEmbeddings(tx: Tx): Promise<{ label: Embeddable; id: string; text: string; hash: string | null }[]> {
  const res = await tx.run(
    `MATCH (i:Idea) RETURN "Idea" AS label, i.id AS id, i.title AS title, i.summary AS summary, i.aliases AS aliases, null AS kind, i.embeddingHash AS hash
     UNION ALL
     MATCH (e:Event) RETURN "Event" AS label, e.id AS id, e.title AS title, e.summary AS summary, e.aliases AS aliases, e.kind + " event, " + e.place AS kind, e.embeddingHash AS hash
     UNION ALL
     MATCH (e:Entity) RETURN "Entity" AS label, e.id AS id, e.name AS title, e.description AS summary, e.aliases AS aliases, e.kind AS kind, e.embeddingHash AS hash`,
  );
  return res.records.map((r) => ({
    label: r.get("label"),
    id: r.get("id"),
    text: embeddingText({ title: r.get("title"), summary: r.get("summary"), aliases: r.get("aliases") ?? [], kind: r.get("kind") }),
    hash: r.get("hash"),
  }));
}

/** The text embedded for an idea, event or entity. */
export function embeddingText(x: { title: string; summary?: string | null; aliases?: string[]; kind?: string | null }): string {
  return [x.kind ? `${x.title} (${x.kind})` : x.title, x.aliases?.length ? `Also known as: ${x.aliases.join("; ")}` : "", x.summary ?? ""]
    .filter(Boolean)
    .join("\n");
}
