# History of Ideas

A visual, scrollable timeline of how human ideas have evolved and shaped history, from the invention of writing to the present.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script              | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Start the Vite dev server                       |
| `npm run validate`  | Check all content against the schema and rules  |
| `npm run build`     | Validate, type-check and build to `dist/`       |
| `npm run preview`   | Serve the production build                      |
| `npm run typecheck` | Run the TypeScript compiler only                |

Requires Node 23.6+ (scripts run TypeScript directly via Node's type stripping).

## Stack

Vite + TypeScript, no framework. Plain CSS with design tokens and automatic light/dark mode. Content is Markdown with YAML frontmatter, validated with `zod` at build time; the browser only receives the resulting JSON.

## Layout

```
content/ideas/*.md            # one file per idea; filename = id
src/content/schema.ts         # zod schema: the source of truth for content and its types
scripts/content.ts            # loads, parses and validates content
scripts/validate.ts           # `npm run validate`
scripts/vite-plugin-content.ts# exposes content to the app as `virtual:ideas`
src/data/eras.ts              # era boundaries and descriptions
src/timeline.ts               # rendering, scroll reveal, current-year tracking
src/format.ts                 # year/source formatting, labels, HTML escaping
src/main.ts                   # page shell and filters
src/style.css
```

## Content format

Each idea is a file in `content/ideas/`, named with its id in kebab-case (e.g. `printing.md`):

```markdown
---
title: The Printing Press
category: technology        # technology | philosophy | religion | politics | science | mathematics | economics
status: sourced             # draft | sourced | reviewed
date:
  year: 1440                # placement on the timeline; negative = BCE
  earliest: 1439            # optional bounds of scholarly estimates
  latest: 1450
  approx: true              # shows "c."
  note: Gutenberg's first experiments are undated; the 42-line Bible was finished by 1455.
origin: Johannes Gutenberg, Mainz
summary: One or two sentences, max 320 characters.
buildsOn:
  - id: paper
    why: Cheap paper made mass printing economical.
    sources: [eisenstein-1979]
sources:
  - key: eisenstein-1979
    type: secondary         # primary | secondary | reference
    author: Elizabeth L. Eisenstein
    title: The Printing Press as an Agent of Change
    publisher: Cambridge University Press
    year: 1979
    locator: vol. 1         # optional page/chapter
    url: https://...        # optional; a source needs a url or a publisher
    accessed: 2026-10-20    # optional; when the url was last checked
---

Optional longer notes in Markdown (not yet shown on the page).
```

### Status

- **draft**: unverified. May have no sources. Shown with an "Unverified" badge.
- **sourced**: every claim is backed by a cited source. Requires at least one source, and every `buildsOn` link needs a `why` and at least one source key.
- **reviewed**: sourced, and checked by a human. Has the same requirements as `sourced`.

### Rules the validator enforces

- Filenames are kebab-case; unknown fields are rejected.
- `earliest <= year <= latest`.
- `buildsOn` ids must exist, cannot point to the idea itself, and cannot point forward in time.
- Source keys are unique within an idea, and `buildsOn[].sources` must reference them.
- Source URLs must be http(s).

Breaking any rule fails `npm run build`, and shows Vite's error overlay in dev.
