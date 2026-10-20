import type { Driver } from "neo4j-driver";
import type { Bibliography, Emergence, Entity, EntryLabel, HistoricalEvent, Idea, IdeaLink, ReviewRecord } from "../../src/content/schema.ts";
import { compact, entryToProps } from "./mapping.ts";
import { loadContent, putSource, replaceEmergences, replaceLinks, upsertEntity } from "./repository.ts";

/**
 * A portable, diffable copy of the graph's content: the backup for the Docker
 * volume, and how a fresh clone gets its data. Embeddings are left out (they're
 * regenerated from the text on restore).
 */
export interface Snapshot {
  version: 2;
  exportedAt: string;
  sources: Bibliography;
  ideas: Idea[];
  events: HistoricalEvent[];
  links: IdeaLink[];
  emergences: Emergence[];
  entities: Entity[];
  involves: { label: EntryLabel; id: string; entity: string; role: string; runId?: string }[];
  discusses: { source: string; idea: string; evidence: string; locator?: string; runId?: string }[];
  reviews: (ReviewRecord & { createdAt: string })[];
  agentRuns: Record<string, unknown>[];
  /** When each entry was created and last changed, keyed by entryKey(label, id); the pipeline relies on these. */
  timestamps: Record<string, { createdAt?: string; updatedAt?: string }>;
}

/** Version 1 had no events or emergences, and keyed reviews and INVOLVES by idea only. */
interface SnapshotV1 extends Omit<Snapshot, "version" | "events" | "emergences" | "involves" | "reviews" | "timestamps"> {
  version: 1;
  involves: { idea: string; entity: string; role: string; runId?: string }[];
  reviews: (Omit<ReviewRecord, "label" | "id" | "mode"> & { ideaId: string; createdAt: string })[];
}

function upgrade(s: Snapshot | SnapshotV1): Snapshot {
  if (s.version === 2) return s;
  if (s.version !== 1) throw new Error(`unsupported snapshot version ${(s as { version: unknown }).version}`);
  return {
    ...s,
    version: 2,
    events: [],
    emergences: [],
    timestamps: {},
    involves: s.involves.map(({ idea, ...x }) => ({ label: "Idea", id: idea, ...x })),
    reviews: s.reviews.map(({ ideaId, ...r }) => ({ label: "Idea", id: ideaId, mode: "full", ...r })),
  };
}

export async function exportSnapshot(driver: Driver): Promise<Snapshot> {
  const { ideas, events, bibliography, links, emergences } = await loadContent(driver);
  const q = async (cypher: string) => (await driver.executeQuery(cypher)).records.map((r) => r.toObject());
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    sources: bibliography,
    ideas,
    events,
    links,
    emergences,
    entities: (await q(`MATCH (e:Entity) RETURN e.id AS id, e.name AS name, e.kind AS kind, e.description AS description, e.aliases AS aliases ORDER BY id`)).map(
      (e) => compact(e) as unknown as Entity,
    ),
    involves: (
      await q(`MATCH (n)-[r:INVOLVES]->(e:Entity) RETURN head(labels(n)) AS label, n.id AS id, e.id AS entity, r.role AS role, r.runId AS runId ORDER BY label, id, entity, role`)
    ).map((x) => compact(x) as Snapshot["involves"][number]),
    discusses: (await q(`MATCH (s:Source)-[r:DISCUSSES]->(i:Idea) RETURN s.key AS source, i.id AS idea, r.evidence AS evidence, r.locator AS locator, r.runId AS runId ORDER BY source, idea`)).map(
      (x) => compact(x) as Snapshot["discusses"][number],
    ),
    reviews: (await q(
      `MATCH (r:Review)-[:REVIEWS]->(n)
       RETURN r.runId AS runId, head(labels(n)) AS label, n.id AS id, r.verdict AS verdict, coalesce(r.mode, "full") AS mode, r.by AS by, r.date AS date, r.hash AS hash, r.report AS report, toString(r.createdAt) AS createdAt
       ORDER BY createdAt`,
    )) as Snapshot["reviews"],
    timestamps: Object.fromEntries(
      (await q(`MATCH (n) WHERE n:Idea OR n:Event RETURN head(labels(n)) + ":" + n.id AS key, toString(n.createdAt) AS createdAt, toString(n.updatedAt) AS updatedAt ORDER BY key`)).map(
        (r) => [r.key, compact({ createdAt: r.createdAt, updatedAt: r.updatedAt })],
      ),
    ),
    agentRuns: (await q(`MATCH (r:AgentRun) OPTIONAL MATCH (r)-[:ABOUT]->(t) RETURN r {.*, createdAt: toString(r.createdAt), aboutLabel: head(labels(t)), aboutKey: coalesce(t.id, t.key)} AS r ORDER BY r.createdAt`)).map((x) =>
      compact(x.r),
    ),
  };
}

/** Load a snapshot. Refuses to write into a graph that already has content unless `force`. */
export async function restoreSnapshot(driver: Driver, input: Snapshot | SnapshotV1, opts: { force?: boolean } = {}): Promise<Record<string, number>> {
  const s = upgrade(input);
  const existing = (await driver.executeQuery(`MATCH (n) WHERE n:Idea OR n:Event RETURN count(n) AS n`)).records[0].get("n") as number;
  if (existing && !opts.force) throw new Error(`the graph already has ${existing} ideas and events; pass --force to merge the snapshot into it`);

  const session = driver.session();
  try {
    await session.executeWrite(async (tx) => {
      for (const [key, src] of Object.entries(s.sources)) await putSource(tx, key, src);
      // Entries are written as-is (including reviewed status), not through putEntry's author rules.
      for (const [label, entries] of [["Idea", s.ideas], ["Event", s.events]] as const) {
        for (const entry of entries) {
          const t = s.timestamps[`${label}:${entry.id}`] ?? {};
          await tx.run(
            `MERGE (n:${label} {id: $id}) SET n = $props,
               n.createdAt = datetime($createdAt), n.updatedAt = datetime($updatedAt)
             WITH n OPTIONAL MATCH (n)-[old:CITES]->() DELETE old
             WITH DISTINCT n UNWIND range(0, size($sources) - 1) AS i
             MATCH (src:Source {key: $sources[i]}) CREATE (n)-[:CITES {order: i}]->(src)`,
            { id: entry.id, props: entryToProps(entry), sources: entry.sources, createdAt: t.createdAt ?? null, updatedAt: t.updatedAt ?? null },
          );
        }
      }
      for (const from of new Set(s.links.map((l) => l.from))) {
        await replaceLinks(tx, from, ["seed", "linker"], s.links.filter((l) => l.from === from));
      }
      const emergenceEvents = [...new Set(s.emergences.map((e) => e.event))];
      if (emergenceEvents.length) await replaceEmergences(tx, emergenceEvents, s.emergences);
      for (const e of s.entities) await upsertEntity(tx, e);
      for (const x of s.involves) {
        await tx.run(`MATCH (n:${x.label} {id: $id}), (e:Entity {id: $entity}) MERGE (n)-[r:INVOLVES {role: $role}]->(e) SET r.runId = $runId`, { ...x, runId: x.runId ?? null });
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
          `MATCH (n:${r.label} {id: $id}) MERGE (rev:Review {runId: $runId})
           SET rev.by = $by, rev.date = $date, rev.hash = $hash, rev.verdict = $verdict, rev.mode = coalesce($mode, "full"), rev.report = $report, rev.createdAt = datetime($createdAt)
           MERGE (rev)-[:REVIEWS]->(n)`,
          r,
        );
      }
      for (const run of s.agentRuns) {
        const { runId, createdAt, aboutLabel, aboutKey, ...props } = run as { runId: string; createdAt: string; aboutLabel?: string; aboutKey?: string };
        await tx.run(`MERGE (r:AgentRun {runId: $runId}) SET r += $props, r.createdAt = datetime($createdAt)`, { runId, createdAt, props });
        if (aboutLabel && ["Idea", "Event", "Source"].includes(aboutLabel)) {
          const keyField = aboutLabel === "Source" ? "key" : "id";
          await tx.run(`MATCH (r:AgentRun {runId: $runId}), (t:${aboutLabel} {${keyField}: $aboutKey}) MERGE (r)-[:ABOUT]->(t)`, { runId, aboutKey });
        }
      }
    });
  } finally {
    await session.close();
  }
  return {
    sources: Object.keys(s.sources).length,
    ideas: s.ideas.length,
    events: s.events.length,
    links: s.links.length,
    emergences: s.emergences.length,
    entities: s.entities.length,
    reviews: s.reviews.length,
  };
}
