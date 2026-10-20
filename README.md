# History of Ideas

A visual, scrollable timeline of how human ideas have evolved and shaped history, from the invention of writing to the present.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script                       | What it does                                      |
| ---------------------------- | ------------------------------------------------- |
| `npm run dev`                | Start the Vite dev server                         |
| `npm run validate`           | Check all content against the schema and rules    |
| `npm run build`              | Validate, type-check and build to `dist/`         |
| `npm run preview`            | Serve the production build                        |
| `npm run typecheck`          | Run the TypeScript compiler only                  |
| `npm run review-hash -- <id>` | Print the content hash a review must record      |
| `npm run pdftext -- <src>`   | Print a PDF's text page by page, for checking sources |
| `npm run review -- <id>`     | Run the fact-checker agent on an idea ([agent/README.md](agent/README.md)) |
| `npm test`                   | Fact-checker unit tests                           |
| `npm run kg:up` / `kg:migrate` / `kg:import` | Local Neo4j knowledge graph ([kg/README.md](kg/README.md)) |

Copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY` (for reviews) and `NEO4J_PASSWORD` (for the graph).

Requires Node 23.6+ (scripts run TypeScript directly via Node's type stripping).

## Stack

Vite + TypeScript, no framework. Plain CSS with design tokens and automatic light/dark mode. Content is Markdown with YAML frontmatter, validated with `zod` at build time; the browser only receives the resulting JSON.

## Layout

```
content/ideas/*.md              # one file per idea; filename = id
content/sources.yaml            # shared bibliography
content/reviews/*.md            # fact-checker review reports
src/content/schema.ts           # zod schema: the source of truth for content and its types
scripts/content.ts              # loads and validates content; citations; review hashes
scripts/render.ts               # build-time Markdown, citation and reference rendering
scripts/vite-plugin-content.ts  # exposes rendered content to the app as `virtual:ideas`
scripts/validate.ts, review-hash.ts, pdftext.ts
src/data/eras.ts                # era boundaries and descriptions
src/timeline.ts, main.ts, format.ts, style.css
agent/                          # the fact-checker service
kg/                             # Neo4j knowledge graph (replaces content/ after the prototype)
```

## Content format

An idea is a Markdown file in `content/ideas/`, named with its id in kebab-case:

```markdown
---
title: The Alphabet
category: technology        # technology | philosophy | religion | politics | science | mathematics | economics
status: sourced             # draft | sourced | reviewed
date:
  year: -1850               # placement on the timeline; negative = BCE
  marks: The earliest known alphabetic inscriptions   # what the year marks (required once sourced)
  earliest: -1900           # optional bounds of scholarly estimates
  approx: true              # shows "c."
  note: Dates are uncertain [@lam-2010, p. 189].       # may cite
origin: Semitic-speaking workers in Egypt and Sinai
summary: One or two sentences for the card. Max 320 characters, no citations.
buildsOn:
  - id: writing
    why: The earliest alphabetic signs were adapted from Egyptian hieroglyphs.
    sources: [lam-2010]
sources: [lam-2010, herrmann-2023]   # keys into content/sources.yaml
---

The body is Markdown, shown under "Notes & sources". Cite as [@lam-2010, p. 190],
or several at once as [@lam-2010, p. 189; @herrmann-2023].
```

Sources live in `content/sources.yaml`, keyed by a short id:

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
  accessed: 2026-10-20
  # optional: translators, series, volume, issue, etAl, short (in-text label),
  #           consulted: false (metadata only), note
```

### Status and review

- **draft**: unverified, shown with an "Unverified" badge. May have no sources.
- **sourced**: the author has cited every claim. Requires `date.marks`, a body with citations, a `why` and sources for every link, and every listed source cited somewhere.
- **reviewed**: the [fact-checker agent](agent/README.md) has independently checked every claim and passed it. Requires a `review` block whose hash matches the current content, including the cited sources, and a passing report in `content/reviews/<id>.md`. Any later edit to the idea or its sources fails the build until it is re-reviewed or set back to `sourced`.

See [CLAUDE.md](CLAUDE.md) for the authoring workflow.

### Rules the validator enforces

- Filenames are kebab-case; unknown fields are rejected.
- `earliest <= year <= latest`.
- `buildsOn` ids must exist, cannot point to the idea itself, and cannot point forward in time.
- Every citation is well formed and refers to one of the idea's sources; every listed source is in the bibliography.
- Bibliography entries have the fields their `kind` needs; DOIs are bare; URLs are http(s).
- Review records match a passing report and the current content hash.

Breaking any rule fails `npm run build`, and shows Vite's error overlay in dev.
