# Knowledge graph

Neo4j is the content store. Ideas, sources, links, entities, reviews and agent runs live here. The site is built from it, and authors and agents write to it.

```bash
npm run kg:up                      # start Neo4j 2026.09 in Docker (needs NEO4J_PASSWORD in .env)
npm run kg:migrate                 # constraints, indexes and vector indexes (schema.cypher)
npm run kg -- restore kg/seed/snapshot.json   # load the committed snapshot into an empty graph
npm run kg:down                    # stop (data persists in a Docker volume)
```

Browse the graph at http://localhost:7474 (user `neo4j`, your `NEO4J_PASSWORD`). Both ports are bound to localhost only.

## Reading and writing

Everything goes through `npm run kg -- <command>`, which validates before writing:

| Command | |
|---|---|
| `ideas [--status <s>]` | List ideas |
| `idea get <id>` | Print an idea in the editing format (YAML frontmatter + Markdown body) |
| `idea put <file.md>...` | Validate and create or update ideas |
| `source get <key>` / `source put <file.yaml>` | Read or write bibliography entries (`{key: entry}`) |
| `links [<id>]` | List links between ideas |
| `embed` | Embed ideas and entities whose text changed (put does this automatically) |
| `export [<file>]` | Write a JSON snapshot (default `kg/seed/snapshot.json`) |
| `restore <file> [--force]` | Load a snapshot |

To edit an idea: `npm run kg -- idea get writing > /tmp/writing.md`, edit the file, then `npm run kg -- idea put /tmp/writing.md`. Authors can't set `reviewed`. If you edit a reviewed idea, the put sends it back to `sourced` and keeps the old review in its history.

## Model

```
(:Idea {id, title, category, status, year, marks, earliest, latest, approx, dateNote,
        origin, summary, aliases, body, reviewBy, reviewDate, reviewHash, embedding})
(:Source {key, type, kind, title, container, publisher, volume, issue, pages, year, doi, url, ...})
(:Person {name})                         contributors to sources
(:Entity {id, name, kind, description, aliases, embedding})
(:Review {runId, by, date, hash, verdict, report, createdAt})
(:AgentRun {runId, agent, date, model, servedBy, turns, costUsd, outcome, summary, createdAt})

(:Idea)-[:CITES {order}]->(:Source)
(:Idea)-[:BUILDS_ON | REACTS_AGAINST | PARALLELS {why, origin, status, evidence, evidenceUrl,
                                               sourceKey, locator, confidence, runId, model}]->(:Idea)
(:Person)-[:CONTRIBUTED {role: author | editor | translator, order}]->(:Source)
(:Idea)-[:INVOLVES {role}]->(:Entity)
(:Source)-[:DISCUSSES {evidence, locator, runId}]->(:Idea)
(:Review)-[:REVIEWS]->(:Idea)
(:AgentRun)-[:ABOUT]->(:Idea | :Source)
```

- **Idea status:** `candidate` ideas are extractor proposals, hidden from the site until a curator promotes them to `draft` or `sourced`.
- **Link origin and status:** links point from the later idea to the earlier one. `seed` links come from the original placeholder content and are unverified. `linker` links carry a verified excerpt. Reviewed links are planned but not built yet.
- **Aliases** are search metadata. They feed the embeddings, but they're not shown on the site and not covered by reviews.

## Vector search

Ideas and entities are embedded with OpenAI `text-embedding-3-large` at 512 dimensions (`EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`). The embedded text is the title, kind, aliases and summary. The vectors are held in the `idea_embedding` and `entity_embedding` cosine vector indexes. Each node stores a hash of the text and settings it was embedded from, so `embed` only re-embeds what changed.

To change the dimensions, drop both indexes (`DROP INDEX idea_embedding`, `DROP INDEX entity_embedding`), set `EMBEDDING_DIMENSIONS`, then run `kg:migrate` and `npm run kg -- embed`.

## Snapshots

The data lives in a Docker volume, so `kg/seed/snapshot.json` is committed as the backup, and as the way a fresh clone gets its data. It holds sources, ideas, links, entities, reviews and agent runs, but not embeddings, which `restore` regenerates. Re-export it after significant changes: `npm run kg -- export`.

## Files

| File | |
|---|---|
| `docker-compose.yml` | Neo4j 2026.09 Community, localhost-only, persistent volumes |
| `schema.cypher` | Constraints, indexes, vector indexes |
| `src/repository.ts` | All graph reads and writes |
| `src/mapping.ts` | Content ↔ graph property mapping |
| `src/embeddings.ts` | OpenAI embeddings and refresh |
| `src/snapshot.ts` | Export and restore |
| `src/cli.ts` | `npm run kg` |
| `src/compose.ts`, `src/migrate.ts`, `src/driver.ts` | Docker, schema, connection |
