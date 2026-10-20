# History of Ideas

A public timeline of historical events. Events are the raw observations, and the site shows only them; the graph also holds ideas identified from events, which are off the site for now. Accuracy matters more than coverage: an entry that isn't sourced must say so, and nothing is marked reviewed except by the fact-checker agent.

## Commands

Everything here, including the site, needs Neo4j running (`npm run kg:up`).

- `npm run dev`: dev server at http://localhost:5173 (reads the graph; reload to see changes)
- `npm run validate`: check all content in the graph (also runs first in `npm run build`)
- `npm run typecheck`, `npm test`
- `npm run kg -- <command>`: read and write the graph: `ideas`, `idea get|put`, `events`, `event get|put`, `source get|put`, `links`, `emergences`, `embed`, `export`, `restore` (see `kg/README.md`)
- The agents (see `agents/README.md`); each costs API credits, so ask the user before running them:
  - `npm run find -- --from <year> --to <year>` then `npm run harvest` (the cheap way to add events: about $0.001 each)
  - `npm run gather -- events --from <year> --to <year>` (the older agent gatherer, about 100× the cost)
  - `npm run interpret -- --from <year> --to <year>`
  - `npm run author -- <id>`
  - `npm run link -- <idea-id>`
  - `npm run check -- --from <year> --to <year>` (the fact-checker's cheap batch check of events)
  - `npm run review -- <id>` (the full review)
  - `npm run extract -- <source-key>`

  Events are addressed as `event:<id>`; years are negative for BCE or written like `2500bce`.
- `npm run pipeline`: show what events need next, with cost estimates (free); `--ideas` adds idea work. `--run --budget <usd>` runs it, which costs credits.
- `npm run check-tools`: confirm the API accepts every agent's tool schemas (a fraction of a cent); run it after changing a submission schema
- `npm run review-hash -- <id>`, `npm run pdftext -- <url-or-path>`

## Layout

- `kg/`: the Neo4j knowledge graph, which is the content store (events, ideas, sources, links, emergences, entities, reviews), plus its CLI, embeddings and snapshots
- `agents/`: the gatherer, interpreter, author, linker, fact-checker and extractor agents, their shared core, and the pipeline
- `src/`: the site and the content schema and rules (`src/content/`)
- `scripts/`: site build (Vite plugin, rendering), validation

## Content workflow

Statuses, for ideas and events alike: `candidate` (proposed by an agent) → `draft` → `sourced` → `checked` or `reviewed` (fact-checker only). `checked` means the claims match the entry's quoted excerpts, re-verified against the sources; `reviewed` means every claim was independently re-researched.

1. **Find and harvest:** `npm run find -- --from <year> --to <year>` stores documents that list many dated events as sources to harvest; `npm run harvest` extracts every dated event from them, each quoting its source verbatim. Harvested events are `sourced`.
2. **Interpret:** `npm run interpret -- --from <year> --to <year>` decides which events show an idea emerging (`EMERGES_IN`, with a stage and evidence), matching existing ideas or proposing `candidate` ideas. Candidates are hidden from the site.
3. **Author:** `npm run author -- <id>` curates a candidate (writes or declines it), sources a draft, or revises an entry after a failed review. To edit by hand instead: `npm run kg -- idea get <id> > /tmp/x.md` (or `event get`), edit, then `idea put` / `event put`. Cite with `[@key, locator]` and set `status: sourced` once every claim is cited. The format is in `README.md`; the schema is `src/content/schema.ts`.
4. **Link:** `npm run link -- <id>` proposes typed links to earlier ideas, each with verified evidence, and replaces the idea's unverified seed links.
5. **Check / review:** `npm run check` batch-checks events against their quoted excerpts; a pass sets `checked`. `npm run review -- <id>` (or `event:<id>`) is the full review; a pass sets `reviewed`. The pipeline gives a 5% sample of checked events a full review too.
6. **On fail:** the author revises from the report (`--light` after a failed check) (`MATCH (r:Review)-[:REVIEWS]->({id: $id}) RETURN r.report ORDER BY r.createdAt DESC LIMIT 1`), then it's reviewed again.

`npm run pipeline` plans all of this from the graph's state; see `agents/README.md`. `npm run extract -- <source-key>` is the older, source-driven way in: it records which ideas a document discusses, with their aliases and entities.

Rules for authors:

- **Never** set `status: checked` or `reviewed`, or write review records; `idea put` refuses, and validation rejects them unless they match a passing record of that mode and the current content hash.
- Quote evidence in an entry's body as `> verbatim excerpt [@key, locator]` lines: the batch check works only from those.
- Editing a reviewed entry, or any source it cites, invalidates its review. `idea put` / `event put` sets it back to `sourced` automatically.
- Cite only what you have read. Quote verbatim from the source, never from memory. If you only verified a reference's metadata, mark it `consulted: false`.
- Prefer scholarship (university presses, peer-reviewed journals, museum and research-institute publications) and primary texts. Never cite Wikipedia, AI output, content farms or exam-prep sites. Use encyclopedias only for uncontroversial facts.
- Avoid textbook simplifications: a single famous inventor, a tidy date, an overstated consequence. Say what a date marks and give the scholarly range.
- Links between ideas come from the linker agent, and emergences from the interpreter, not from authors.
- After significant changes, refresh the committed snapshot: `npm run kg -- export`.
