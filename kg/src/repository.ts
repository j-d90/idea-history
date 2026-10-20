import neo4j, { type Driver, type ManagedTransaction } from "neo4j-driver";
import { checkContent, checkIdea, contentHash, ContentError } from "../../src/content/rules.ts";
import {
  ideaLinkSchema,
  linkTypes,
  type Bibliography,
  type Entity,
  type Idea,
  type IdeaLink,
  type ReviewRecord,
  type Source,
} from "../../src/content/schema.ts";
import { compact, ideaToProps, propsToIdea, propsToSource, sourceToProps, type Contributor } from "./mapping.ts";

// The knowledge graph is the content store. Every read and write of ideas,
// sources, links, entities and reviews goes through this module.

type Tx = ManagedTransaction;
const LINK_TYPES = linkTypes.join("|");

export interface Content {
  ideas: Idea[];
  bibliography: Bibliography;
  links: IdeaLink[];
  latestReviews: Map<string, ReviewRecord>;
}

// ---------- Reads ----------

/** Load all content. With `validate`, throws ContentError if any rule is broken. */
export async function loadContent(driver: Driver, opts: { validate?: boolean } = {}): Promise<Content> {
  const session = driver.session();
  try {
    return await session.executeRead(async (tx) => {
      const bibliography = await loadSources(tx);
      const ideaRes = await tx.run(
        `MATCH (i:Idea)
         OPTIONAL MATCH (i)-[c:CITES]->(s:Source)
         WITH i, c, s ORDER BY c.order
         RETURN i {.*, embedding: null, embeddingHash: null} AS p, [k IN collect(s.key) WHERE k IS NOT NULL] AS sources`,
      );
      const ideas = ideaRes.records.map((r) => propsToIdea(r.get("p"), r.get("sources")));
      ideas.sort((a, b) => a.date.year - b.date.year || a.id.localeCompare(b.id));
      const links = await loadLinks(tx);
      const latestReviews = await loadLatestReviews(tx);
      const content = { ideas, bibliography, links, latestReviews };
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

export async function loadIdea(tx: Tx, id: string): Promise<Idea | undefined> {
  const res = await tx.run(
    `MATCH (i:Idea {id: $id})
     OPTIONAL MATCH (i)-[c:CITES]->(s:Source)
     WITH i, c, s ORDER BY c.order
     RETURN i {.*, embedding: null, embeddingHash: null} AS p, [k IN collect(s.key) WHERE k IS NOT NULL] AS sources`,
    { id },
  );
  return res.records.length ? propsToIdea(res.records[0].get("p"), res.records[0].get("sources")) : undefined;
}

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

async function loadLatestReviews(tx: Tx): Promise<Map<string, ReviewRecord>> {
  const res = await tx.run(
    `MATCH (r:Review)-[:REVIEWS]->(i:Idea)
     WITH i, r ORDER BY r.createdAt DESC
     WITH i, head(collect(r)) AS r
     RETURN i.id AS ideaId, r {.runId, .verdict, .by, .date, .hash, .report} AS r`,
  );
  return new Map(res.records.map((rec) => [rec.get("ideaId"), { ideaId: rec.get("ideaId"), ...rec.get("r") } as ReviewRecord]));
}

/** The idea, its cited sources, and the content hash a review would vouch for. */
export async function loadSubject(tx: Tx, id: string) {
  const idea = await loadIdea(tx, id);
  if (!idea) throw new Error(`no such idea: ${id}`);
  const sources = await loadSources(tx, idea.sources);
  return { idea, sources, hash: contentHash(idea, sources) };
}

// ---------- Writes ----------

export interface PutResult {
  created: boolean;
  /** The idea was reviewed and its content changed, so it went back to "sourced". */
  reviewInvalidated: boolean;
}

/**
 * Create or update an idea, validating it against the graph first. Authors can't
 * set "reviewed": that status (and the review record) is kept only while the
 * reviewed content is unchanged; any change sends the idea back to "sourced".
 */
export async function putIdea(tx: Tx, incoming: Idea): Promise<PutResult> {
  const existing = await loadIdea(tx, incoming.id);
  const sources = await loadSources(tx, incoming.sources);
  const idea: Idea = { ...incoming, review: undefined };
  let reviewInvalidated = false;

  if (incoming.status === "reviewed" || incoming.review) {
    const unchanged = existing?.status === "reviewed" && existing.review && existing.review.hash === contentHash(incoming, sources);
    if (!existing || existing.status !== "reviewed") {
      throw new ContentError([`only the fact-checker can mark ${incoming.id} reviewed`]);
    }
    if (unchanged) idea.review = existing.review;
    else {
      idea.status = "sourced";
      reviewInvalidated = true;
    }
  } else if (existing?.status === "reviewed") {
    reviewInvalidated = true;
  }

  const problems = checkIdea(idea, sources);
  if (problems.length) throw new ContentError(problems.map((p) => `idea ${idea.id}: ${p}`));

  await tx.run(
    `MERGE (i:Idea {id: $id})
     WITH i, i {.embedding, .embeddingHash} AS keep
     SET i = $props, i.embedding = keep.embedding, i.embeddingHash = keep.embeddingHash
     WITH i
     OPTIONAL MATCH (i)-[old:CITES]->() DELETE old
     WITH DISTINCT i
     UNWIND range(0, size($sources) - 1) AS n
     MATCH (s:Source {key: $sources[n]})
     CREATE (i)-[:CITES {order: n}]->(s)`,
    { id: idea.id, props: ideaToProps(idea), sources: idea.sources },
  );
  return { created: !existing, reviewInvalidated };
}

/** Create or update a source and its contributors. */
export async function putSource(tx: Tx, key: string, source: Source): Promise<void> {
  const { props, people } = sourceToProps(source);
  await tx.run(
    `MERGE (s:Source {key: $key})
     SET s = $props, s.key = $key
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

export async function addReview(tx: Tx, r: ReviewRecord): Promise<void> {
  await tx.run(
    `MATCH (i:Idea {id: $ideaId})
     CREATE (rev:Review {runId: $runId, by: $by, date: $date, hash: $hash, verdict: $verdict, report: $report, createdAt: datetime()})-[:REVIEWS]->(i)`,
    r,
  );
  if (r.verdict === "pass") {
    await tx.run(`MATCH (i:Idea {id: $ideaId}) SET i.status = "reviewed", i.reviewBy = $by, i.reviewDate = $date, i.reviewHash = $hash`, r);
  } else {
    await tx.run(`MATCH (i:Idea {id: $ideaId}) WHERE i.status = "reviewed" SET i.status = "sourced" REMOVE i.reviewBy, i.reviewDate, i.reviewHash`, r);
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

/** Union new aliases into an idea's (search metadata; doesn't affect its review). */
export async function addIdeaAliases(tx: Tx, id: string, aliases: string[]): Promise<void> {
  await tx.run(
    `MATCH (i:Idea {id: $id})
     SET i.aliases = reduce(acc = coalesce(i.aliases, []), a IN $aliases | CASE WHEN a IN acc OR a = i.title THEN acc ELSE acc + a END)`,
    { id, aliases },
  );
}

export async function linkIdeaEntity(tx: Tx, ideaId: string, entityId: string, role: string, runId: string): Promise<void> {
  await tx.run(
    `MATCH (i:Idea {id: $ideaId}), (e:Entity {id: $entityId})
     MERGE (i)-[r:INVOLVES {role: $role}]->(e)
     ON CREATE SET r.runId = $runId`,
    { ideaId, entityId, role, runId },
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

// ---------- Embeddings and similarity ----------

export type Embeddable = "Idea" | "Entity";

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

/** The stored embedding of an idea, if it has one. */
export async function ideaEmbedding(tx: Tx, id: string): Promise<number[] | undefined> {
  const res = await tx.run(`MATCH (i:Idea {id: $id}) RETURN i.embedding AS v`, { id });
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

/** Ideas and entities whose embedding is missing or stale. */
export async function staleEmbeddings(tx: Tx): Promise<{ label: Embeddable; id: string; text: string; hash: string | null }[]> {
  const res = await tx.run(
    `MATCH (i:Idea) RETURN "Idea" AS label, i.id AS id, i.title AS title, i.summary AS summary, i.aliases AS aliases, null AS kind, i.embeddingHash AS hash
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

/** The text embedded for an idea or entity. */
export function embeddingText(x: { title: string; summary?: string | null; aliases?: string[]; kind?: string | null }): string {
  return [x.kind ? `${x.title} (${x.kind})` : x.title, x.aliases?.length ? `Also known as: ${x.aliases.join("; ")}` : "", x.summary ?? ""]
    .filter(Boolean)
    .join("\n");
}
