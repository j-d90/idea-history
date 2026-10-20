# History of Ideas

A public timeline of human ideas. Accuracy matters more than coverage: an entry that isn't sourced must say so, and nothing is marked reviewed except by the fact-checker agent.

## Commands

Everything here, including the site, needs Neo4j running (`npm run kg:up`).

- `npm run dev`: dev server at http://localhost:5173 (reads the graph; reload to see changes)
- `npm run validate`: check all content in the graph (also runs first in `npm run build`)
- `npm run typecheck`, `npm test`
- `npm run kg -- <command>`: read and write the graph: `ideas`, `idea get|put`, `source get|put`, `links`, `embed`, `export`, `restore` (see `kg/README.md`)
- `npm run extract -- <source-key>`, `npm run link -- <idea-id>`, `npm run review -- <idea-id>`: the agents (see `agents/README.md`); each costs API credits, so ask the user before running them
- `npm run review-hash -- <id>`, `npm run pdftext -- <url-or-path>`

## Layout

- `kg/`: the Neo4j knowledge graph, which is the content store (ideas, sources, links, entities, reviews), plus its CLI, embeddings and snapshots
- `agents/`: the extractor, linker and fact-checker agents and their shared core
- `src/`: the site and the content schema and rules (`src/content/`)
- `scripts/`: site build (Vite plugin, rendering), validation

## Content workflow

`candidate` (extractor) → `draft` → `sourced` (author) → `reviewed` (fact-checker only)

1. **Sources:** add bibliography entries with `npm run kg -- source put <file.yaml>`.
2. **Extract:** `npm run extract -- <source-key>` records which ideas a source discusses, their aliases and entities, and proposes new `candidate` ideas. Candidates are hidden from the site.
3. **Author** (you, or any agent writing content): `npm run kg -- idea get <id> > /tmp/x.md`, edit, `npm run kg -- idea put /tmp/x.md`. Cite with `[@key, locator]` and set `status: sourced` once every claim is cited. The format is in `README.md`; the schema is `src/content/schema.ts`.
4. **Link:** `npm run link -- <id>` proposes typed links to earlier ideas, each with verified evidence, and replaces the idea's unverified seed links.
5. **Review:** `npm run review -- <id>`. The fact-checker checks every claim and records a review; only a pass sets `reviewed`.
6. **On fail:** fix what the report lists (`MATCH (r:Review)-[:REVIEWS]->(:Idea {id: $id}) RETURN r.report ORDER BY r.createdAt DESC LIMIT 1`), then review again.

Rules for authors:

- **Never** set `status: reviewed` or write review records; `idea put` refuses, and validation rejects reviews that don't match a passing review record and the current content hash.
- Editing a reviewed idea, or any source it cites, invalidates its review. `idea put` sets it back to `sourced` automatically.
- Cite only what you have read. Quote verbatim from the source, never from memory. If you only verified a reference's metadata, mark it `consulted: false`.
- Prefer scholarship (university presses, peer-reviewed journals, museum and research-institute publications) and primary texts. Never cite Wikipedia, AI output, content farms or exam-prep sites. Use encyclopedias only for uncontroversial facts.
- Avoid textbook simplifications: a single famous inventor, a tidy date, an overstated consequence. Say what a date marks and give the scholarly range.
- Links between ideas come from the linker agent, not from authors.
- After significant changes, refresh the committed snapshot: `npm run kg -- export`.
