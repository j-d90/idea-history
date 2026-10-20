import type { Driver, ManagedTransaction } from "neo4j-driver";
import { REVIEWER, frontmatterSchema, sourceSchema, type Bibliography, type Idea } from "../../src/content/schema.ts";
import { contentHash } from "../../scripts/content.ts";
import { StaleContentError, type ReviewOutcome, type ReviewStore, type ReviewSubject } from "../../agent/src/store/types.ts";
import { connect, type Neo4jConfig } from "./driver.ts";
import { propsToFrontmatter, propsToSource, type Role } from "./mapping.ts";

/**
 * ReviewStore backed by the Neo4j knowledge graph. Reconstructs ideas and
 * sources through the same zod schemas as the file loader, so a faithful import
 * yields the same content hash in both stores. Reviews become (:Review) nodes,
 * kept as history; the idea's status and current review live on the (:Idea).
 */
export class GraphReviewStore implements ReviewStore {
  readonly name = "graph";
  private driver: Driver;

  private constructor(driver: Driver) {
    this.driver = driver;
  }

  static async connect(cfg: Neo4jConfig): Promise<GraphReviewStore> {
    return new GraphReviewStore(await connect(cfg));
  }

  async load(id: string): Promise<ReviewSubject> {
    const session = this.driver.session();
    try {
      return await session.executeRead((tx) => loadSubject(tx, id));
    } finally {
      await session.close();
    }
  }

  async save(outcome: ReviewOutcome): Promise<void> {
    const session = this.driver.session();
    try {
      await session.executeWrite(async (tx) => {
        // Re-read inside the write transaction so the check and the write are atomic.
        const current = await loadSubject(tx, outcome.ideaId);
        if (current.hash !== outcome.hash) throw new StaleContentError(outcome.ideaId, outcome.hash, current.hash);

        await tx.run(
          `MATCH (i:Idea {id: $id})
           CREATE (r:Review {runId: $runId, by: $by, date: $date, hash: $hash, verdict: $verdict, report: $report})-[:REVIEWS]->(i)`,
          { id: outcome.ideaId, runId: outcome.runId, by: REVIEWER, date: outcome.date, hash: outcome.hash, verdict: outcome.verdict, report: outcome.report },
        );
        if (outcome.verdict === "pass") {
          await tx.run(
            `MATCH (i:Idea {id: $id}) SET i.status = "reviewed", i.reviewBy = $by, i.reviewDate = $date, i.reviewHash = $hash`,
            { id: outcome.ideaId, by: REVIEWER, date: outcome.date, hash: outcome.hash },
          );
        } else {
          await tx.run(
            `MATCH (i:Idea {id: $id}) WHERE i.status = "reviewed"
             SET i.status = "sourced" REMOVE i.reviewBy, i.reviewDate, i.reviewHash`,
            { id: outcome.ideaId },
          );
        }
      });
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

async function loadSubject(tx: ManagedTransaction, id: string): Promise<ReviewSubject> {
  const ideaRes = await tx.run(`MATCH (i:Idea {id: $id}) RETURN properties(i) AS p`, { id });
  if (!ideaRes.records.length) throw new Error(`no such idea in the graph: ${id} (run npm run kg:import?)`);
  const props = ideaRes.records[0].get("p") as Record<string, unknown>;

  const linkRes = await tx.run(
    `MATCH (:Idea {id: $id})-[l:BUILDS_ON]->(t:Idea) RETURN t.id AS id, l.why AS why, l.sources AS sources ORDER BY l.order`,
    { id },
  );
  const links = linkRes.records.map((r) => ({ id: r.get("id"), ...(r.get("why") ? { why: r.get("why") } : {}), sources: r.get("sources") ?? [] }));

  const srcRes = await tx.run(
    `MATCH (:Idea {id: $id})-[c:CITES]->(s:Source)
     OPTIONAL MATCH (p:Person)-[r:CONTRIBUTED]->(s)
     WITH c, s, collect({name: p.name, role: r.role, order: r.order}) AS people
     RETURN s.key AS key, properties(s) AS props, people ORDER BY c.order`,
    { id },
  );

  const sources: Bibliography = {};
  for (const r of srcRes.records) {
    const people = (r.get("people") as { name: string | null; role: Role; order: number }[]).filter((x) => x.name) as {
      name: string;
      role: Role;
      order: number;
    }[];
    sources[r.get("key")] = sourceSchema.parse(propsToSource(r.get("props"), people));
  }

  const frontmatter = frontmatterSchema.parse(propsToFrontmatter(props, links, Object.keys(sources)));
  const idea: Idea = { id, body: (props.body as string) ?? "", ...frontmatter };
  return { idea, sources, hash: contentHash(idea, sources) };
}
