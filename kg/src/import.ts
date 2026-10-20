// Sync the prototype content (content/) into the knowledge graph.
// Usage: npm run kg:import [-- --prune]
// Idempotent: re-running replaces each idea's and source's properties and
// relationships with what's in the files. --prune also deletes graph nodes
// that no longer exist in the files.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contentRoot, loadContent } from "../../scripts/content.ts";
import { connect, neo4jConfigFromEnv } from "./driver.ts";
import { ideaToProps, sourceToProps } from "./mapping.ts";

const prune = process.argv.includes("--prune");
const { ideas, bibliography } = loadContent();

const sources = Object.entries(bibliography).map(([key, s]) => ({ key, ...sourceToProps(s) }));
const ideaRows = ideas.map((i) => ({ id: i.id, props: ideaToProps(i) }));
const cites = ideas.flatMap((i) => i.sources.map((key, order) => ({ id: i.id, key, order })));
const links = ideas.flatMap((i) => i.buildsOn.map((l, order) => ({ id: i.id, target: l.id, order, why: l.why ?? null, sources: l.sources })));

// Current reviews, with their reports, become Review nodes.
const reviews = ideas
  .filter((i) => i.status === "reviewed" && i.review)
  .map((i) => {
    const path = join(contentRoot, "reviews", `${i.id}.md`);
    const report = existsSync(path) ? readFileSync(path, "utf8") : "";
    const runId = /^run_id:\s*(\S+)/m.exec(report)?.[1] ?? `${i.id}@${i.review!.hash}`;
    return { id: i.id, runId, by: i.review!.by, date: i.review!.date, hash: i.review!.hash, report };
  });

const driver = await connect(neo4jConfigFromEnv());
const session = driver.session();
try {
  await session.executeWrite(async (tx) => {
    await tx.run(
      `UNWIND $rows AS row
       MERGE (s:Source {key: row.key})
       SET s = row.props, s.key = row.key
       WITH s, row
       OPTIONAL MATCH (s)<-[old:CONTRIBUTED]-()
       DELETE old
       WITH DISTINCT s, row
       UNWIND row.people AS p
       MERGE (person:Person {name: p.name})
       CREATE (person)-[:CONTRIBUTED {role: p.role, order: p.order}]->(s)`,
      { rows: sources },
    );

    await tx.run(
      `UNWIND $rows AS row
       MERGE (i:Idea {id: row.id})
       SET i = row.props, i.id = row.id
       WITH i
       OPTIONAL MATCH (i)-[old:CITES|BUILDS_ON]->()
       DELETE old`,
      { rows: ideaRows },
    );

    await tx.run(
      `UNWIND $rows AS row
       MATCH (i:Idea {id: row.id}), (s:Source {key: row.key})
       CREATE (i)-[:CITES {order: row.order}]->(s)`,
      { rows: cites },
    );

    await tx.run(
      `UNWIND $rows AS row
       MATCH (i:Idea {id: row.id}), (t:Idea {id: row.target})
       CREATE (i)-[l:BUILDS_ON {order: row.order, sources: row.sources}]->(t)
       SET l.why = row.why`,
      { rows: links },
    );

    await tx.run(
      `UNWIND $rows AS row
       MATCH (i:Idea {id: row.id})
       MERGE (r:Review {runId: row.runId})
       SET r.by = row.by, r.date = row.date, r.hash = row.hash, r.verdict = "pass", r.report = row.report
       MERGE (r)-[:REVIEWS]->(i)`,
      { rows: reviews },
    );

    if (prune) {
      await tx.run(`MATCH (i:Idea) WHERE NOT i.id IN $ids DETACH DELETE i`, { ids: ideas.map((i) => i.id) });
      await tx.run(`MATCH (s:Source) WHERE NOT s.key IN $keys DETACH DELETE s`, { keys: Object.keys(bibliography) });
      await tx.run(`MATCH (p:Person) WHERE NOT (p)--() DELETE p`);
    }
  });
  console.log(`✓ imported ${ideas.length} ideas, ${sources.length} sources, ${cites.length} citations, ${links.length} links, ${reviews.length} reviews${prune ? " (pruned)" : ""}`);
} finally {
  await session.close();
  await driver.close();
}
