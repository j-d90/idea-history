import type { Driver } from "neo4j-driver";
import type { Bibliography, Entity, Idea, IdeaLink, ReviewRecord } from "../../src/content/schema.ts";
import { compact, ideaToProps } from "./mapping.ts";
import { loadContent, putSource, replaceLinks, upsertEntity } from "./repository.ts";

/**
 * A portable, diffable copy of the graph's content: the backup for the Docker
 * volume, and how a fresh clone gets its data. Embeddings are left out (they're
 * regenerated from the text on restore).
 */
export interface Snapshot {
  version: 1;
  exportedAt: string;
  sources: Bibliography;
  ideas: Idea[];
  links: IdeaLink[];
  entities: Entity[];
  involves: { idea: string; entity: string; role: string; runId?: string }[];
  discusses: { source: string; idea: string; evidence: string; locator?: string; runId?: string }[];
  reviews: (ReviewRecord & { createdAt: string })[];
  agentRuns: Record<string, unknown>[];
}

export async function exportSnapshot(driver: Driver): Promise<Snapshot> {
  const { ideas, bibliography, links } = await loadContent(driver);
  const q = async (cypher: string) => (await driver.executeQuery(cypher)).records.map((r) => r.toObject());
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    sources: bibliography,
    ideas,
    links,
    entities: (await q(`MATCH (e:Entity) RETURN e.id AS id, e.name AS name, e.kind AS kind, e.description AS description, e.aliases AS aliases ORDER BY id`)).map(
      (e) => compact(e) as unknown as Entity,
    ),
    involves: (await q(`MATCH (i:Idea)-[r:INVOLVES]->(e:Entity) RETURN i.id AS idea, e.id AS entity, r.role AS role, r.runId AS runId ORDER BY idea, entity`)).map(
      (x) => compact(x) as Snapshot["involves"][number],
    ),
    discusses: (await q(`MATCH (s:Source)-[r:DISCUSSES]->(i:Idea) RETURN s.key AS source, i.id AS idea, r.evidence AS evidence, r.locator AS locator, r.runId AS runId ORDER BY source, idea`)).map(
      (x) => compact(x) as Snapshot["discusses"][number],
    ),
    reviews: (await q(
      `MATCH (r:Review)-[:REVIEWS]->(i:Idea)
       RETURN r.runId AS runId, i.id AS ideaId, r.verdict AS verdict, r.by AS by, r.date AS date, r.hash AS hash, r.report AS report, toString(r.createdAt) AS createdAt
       ORDER BY createdAt`,
    )) as Snapshot["reviews"],
    agentRuns: (await q(`MATCH (r:AgentRun) RETURN r {.*, createdAt: toString(r.createdAt)} AS r ORDER BY r.createdAt`)).map((x) => x.r),
  };
}

/** Load a snapshot. Refuses to write into a graph that already has ideas unless `force`. */
export async function restoreSnapshot(driver: Driver, s: Snapshot, opts: { force?: boolean } = {}): Promise<Record<string, number>> {
  if (s.version !== 1) throw new Error(`unsupported snapshot version ${s.version}`);
  const existing = (await driver.executeQuery(`MATCH (i:Idea) RETURN count(i) AS n`)).records[0].get("n") as number;
  if (existing && !opts.force) throw new Error(`the graph already has ${existing} ideas; pass --force to merge the snapshot into it`);

  const session = driver.session();
  try {
    await session.executeWrite(async (tx) => {
      for (const [key, src] of Object.entries(s.sources)) await putSource(tx, key, src);
      // Ideas are written as-is (including reviewed status), not through putIdea's author rules.
      for (const idea of s.ideas) {
        await tx.run(
          `MERGE (i:Idea {id: $id}) SET i = $props
           WITH i OPTIONAL MATCH (i)-[old:CITES]->() DELETE old
           WITH DISTINCT i UNWIND range(0, size($sources) - 1) AS n
           MATCH (src:Source {key: $sources[n]}) CREATE (i)-[:CITES {order: n}]->(src)`,
          { id: idea.id, props: ideaToProps(idea), sources: idea.sources },
        );
      }
      for (const from of new Set(s.links.map((l) => l.from))) {
        await replaceLinks(tx, from, ["seed", "linker"], s.links.filter((l) => l.from === from));
      }
      for (const e of s.entities) await upsertEntity(tx, e);
      for (const x of s.involves) {
        await tx.run(`MATCH (i:Idea {id: $idea}), (e:Entity {id: $entity}) MERGE (i)-[r:INVOLVES {role: $role}]->(e) SET r.runId = $runId`, { ...x, runId: x.runId ?? null });
      }
      for (const x of s.discusses) {
        await tx.run(`MATCH (s:Source {key: $source}), (i:Idea {id: $idea}) MERGE (s)-[r:DISCUSSES]->(i) SET r.evidence = $evidence, r.locator = $locator, r.runId = $runId`, {
          ...x,
          locator: x.locator ?? null,
          runId: x.runId ?? null,
        });
      }
      for (const r of s.reviews) {
        await tx.run(
          `MATCH (i:Idea {id: $ideaId}) MERGE (rev:Review {runId: $runId})
           SET rev.by = $by, rev.date = $date, rev.hash = $hash, rev.verdict = $verdict, rev.report = $report, rev.createdAt = datetime($createdAt)
           MERGE (rev)-[:REVIEWS]->(i)`,
          r,
        );
      }
      for (const run of s.agentRuns) {
        const { runId, createdAt, ...props } = run as { runId: string; createdAt: string };
        await tx.run(`MERGE (r:AgentRun {runId: $runId}) SET r += $props, r.createdAt = datetime($createdAt)`, { runId, createdAt, props });
      }
    });
  } finally {
    await session.close();
  }
  return { sources: Object.keys(s.sources).length, ideas: s.ideas.length, links: s.links.length, entities: s.entities.length, reviews: s.reviews.length };
}
