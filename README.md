# History of Ideas

A visual, scrollable timeline of how human ideas have evolved and shaped history, from the invention of writing to the present.

## Getting started

```bash
npm install
cp .env.example .env               # fill in ANTHROPIC_API_KEY, OPENAI_API_KEY, NEO4J_PASSWORD
npm run kg:up                      # start Neo4j in Docker
npm run kg:migrate                 # schema and vector indexes
npm run kg -- restore kg/seed/snapshot.json   # load the content (first time only)
npm run dev                        # http://localhost:5173
```

Requires Node 23.6+ (scripts run TypeScript directly via Node's type stripping) and Docker.

| Script | What it does |
|---|---|
| `npm run dev` | Dev server; reads the graph on each page load |
| `npm run build` | Validate, type-check and build to `dist/` (needs Neo4j running) |
| `npm run validate` | Check all content in the graph |
| `npm run kg -- <command>` | Read and write the graph ([kg/README.md](kg/README.md)) |
| `npm run kg:up` / `kg:down` / `kg:migrate` | Start or stop Neo4j; apply the schema |
| `npm run extract -- <source>` | Extractor agent: ideas, aliases and entities from a source ([agents/README.md](agents/README.md)) |
| `npm run link -- <idea>` | Linker agent: typed, evidenced links to earlier ideas |
| `npm run review -- <idea>` | Fact-checker agent: independent review of a sourced idea |
| `npm test`, `npm run typecheck` | Unit tests, TypeScript |
| `npm run review-hash -- <id>`, `npm run pdftext -- <src>` | Content hash for reviews; read a PDF source |

## Stack

- **Site:** Vite + TypeScript, no framework, plain CSS with design tokens and automatic light and dark mode. It's static; content is queried from Neo4j, validated with `zod` and rendered at build time.
- **Content store:** Neo4j 2026.09 in Docker, with vector indexes over OpenAI `text-embedding-3-large` embeddings (512 dimensions).
- **Agents:** the Anthropic API (Claude Sonnet 5.5 by default), with a shared harness that verifies every quoted excerpt against the documents the agent actually read.

## Layout

```
src/                    the site; src/content/ holds the content schema and rules
scripts/                site build (Vite plugin, rendering), validation
kg/                     Neo4j: schema, repository, embeddings, CLI, snapshots (kg/seed/snapshot.json)
agents/                 extractor, linker, fact-checker, and their shared core
```

## Content model

Content lives in the graph. Authors edit it through `npm run kg`, which validates before writing.

**Ideas** are edited as Markdown with YAML frontmatter (`npm run kg -- idea get <id>` / `idea put <file>`):

```markdown
---
id: alphabet
title: The Alphabet
category: technology        # technology | philosophy | religion | politics | science | mathematics | economics
status: sourced             # candidate | draft | sourced | reviewed (reviewed is set only by the fact-checker)
date:
  year: -1850               # placement on the timeline; negative = BCE
  marks: The earliest known alphabetic inscriptions   # what the year marks (required once sourced)
  earliest: -1900           # optional bounds of scholarly estimates
  approx: true              # shows "c."
  note: Dates are uncertain [@lam-2010, p. 189].       # may cite
origin: Semitic-speaking workers in Egypt and Sinai
summary: One or two sentences for the card. Max 320 characters, no citations.
aliases: [linear West Semitic alphabet]   # search metadata; not shown or reviewed
sources: [lam-2010, herrmann-2023]
---

The body is Markdown, shown under "Notes & sources". Cite as [@lam-2010, p. 190],
or several at once as [@lam-2010, p. 189; @herrmann-2023].
```

**Sources** are bibliography entries (`npm run kg -- source get|put`), with fields for each kind of work:

```yaml
lam-2010:
  type: secondary            # primary | secondary | reference
  kind: chapter              # book | chapter | article | preprint | web | text
  authors: [Joseph Lam]
  title: The Invention and Development of the Alphabet
  container: "Visible Language: Inventions of Writing in the Ancient Middle East and Beyond"
  editors: [Christopher Woods]
  publisher: The Oriental Institute of the University of Chicago
  year: 2010
  pages: pp. 189–195
  url: https://...            # and/or doi: 10.xxxx/...
  # optional: translators, series, volume, issue, etAl, short (in-text label),
  #           accessed, consulted: false (metadata only), note
```

**Links** between ideas (`BUILDS_ON`, `REACTS_AGAINST`, `PARALLELS`) are proposed by the linker agent with a verified excerpt as evidence. They point from the later idea to the earlier one. Links left from the original placeholder content are marked `seed` and shown as unverified.

**Entities** (people, places, works, groups, institutions, traditions, languages, concepts, periods) and **synonyms** are recorded by the extractor agent, and feed vector search.

### Status and review

- **candidate:** proposed by the extractor from a source, not yet curated. Hidden from the site.
- **draft:** unverified. Shown with an "Unverified" badge.
- **sourced:** the author has cited every claim. Requires `date.marks`, a body with citations, and every listed source cited.
- **reviewed:** the fact-checker agent has independently checked every claim and passed it. The review record's hash must match the current content, including the cited sources. Editing the idea sends it back to `sourced`.

### Rules the validator enforces

- Schemas: ids are kebab-case; unknown fields are rejected; `earliest <= year <= latest`; bibliography entries have the fields their `kind` needs.
- Citations are well formed and refer to the idea's own sources; summaries carry no citations.
- Links point to existing, non-candidate ideas; `BUILDS_ON` and `REACTS_AGAINST` can't point forward in time; linker links carry evidence.
- Reviewed ideas match a passing review record and the current content hash.

Breaking any rule fails `npm run build`, and shows Vite's error overlay in dev.

See [CLAUDE.md](CLAUDE.md) for the authoring workflow.
