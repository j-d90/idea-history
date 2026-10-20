# Knowledge graph

A local Neo4j database that will replace `content/` as the store of ideas, sources and reviews. For now `content/` is still the source of truth, because the site reads it. `kg:import` syncs it into the graph, and the fact-checker can review from either store.

```bash
npm run kg:up        # start Neo4j in Docker (needs NEO4J_PASSWORD in .env)
npm run kg:migrate   # apply constraints and indexes (schema.cypher)
npm run kg:import    # sync content/ into the graph; add -- --prune to delete removed nodes
npm run kg:down      # stop (data persists in a Docker volume)
```

Browse the graph at http://localhost:7474 (user `neo4j`, your `NEO4J_PASSWORD`). Both ports are bound to localhost only.

## Model

```
(:Idea {id, title, category, status, year, marks, earliest, latest, approx, dateNote,
        origin, summary, body, reviewBy, reviewDate, reviewHash})
(:Source {key, type, kind, title, container, series, publisher, volume, issue, pages,
          year, doi, url, accessed, short, etAl, consulted, note})
(:Person {name})
(:Review {runId, by, date, hash, verdict, report})

(:Idea)-[:CITES {order}]->(:Source)
(:Idea)-[:BUILDS_ON {order, why, sources}]->(:Idea)
(:Person)-[:CONTRIBUTED {role: "author" | "editor" | "translator", order}]->(:Source)
(:Review)-[:REVIEWS]->(:Idea)
```

Authors, editors and translators become shared `Person` nodes, so queries like "every source by Christopher Woods" work across the bibliography. Each review run is its own `Review` node, kept as history; the idea carries its current status and review.

`src/mapping.ts` converts between content objects and graph properties. Reading back goes through the same zod schemas as the file loader, so an idea loaded from the graph has the same content hash as the same idea loaded from `content/`.

## Files

| File | |
|---|---|
| `docker-compose.yml` | Neo4j 2026.09 Community, localhost-only, persistent volumes |
| `src/compose.ts` | Runs compose for `kg:up`/`kg:down`, after checking the Docker engine responds |
| `schema.cypher` | Uniqueness constraints and indexes |
| `src/driver.ts` | Connection from environment variables |
| `src/migrate.ts`, `src/import.ts` | Schema and content sync |
| `src/mapping.ts` | Content ↔ graph property mapping |
| `src/graph-store.ts` | `ReviewStore` implementation used by the fact-checker (`--store graph`) |

## While both stores exist

If you review with `--store graph`, the result is recorded only in the graph, and `content/` is unchanged. Until the site reads from the graph, review with the default file store, then run `kg:import` to sync.
