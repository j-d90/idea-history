# History of Ideas

A visual, scrollable timeline of how human ideas have evolved and shaped history, from the invention of writing to the present.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script              | What it does                      |
| ------------------- | --------------------------------- |
| `npm run dev`       | Start the Vite dev server         |
| `npm run build`     | Type-check and build to `dist/`   |
| `npm run preview`   | Serve the production build        |
| `npm run typecheck` | Run the TypeScript compiler only  |

## Stack

Vite + TypeScript, no framework. Styles are plain CSS with design tokens and automatic light/dark mode.

## Layout

```
src/
  data/ideas.ts   # the ideas: year, title, origin, summary, category, buildsOn
  data/eras.ts    # era boundaries and descriptions
  types.ts        # Idea / Era / Category types
  timeline.ts     # rendering, scroll reveal, current-year tracking
  format.ts       # year formatting (BCE/CE) and category labels
  main.ts         # page shell and filters
  style.css
```

## Adding an idea

Add an entry to `src/data/ideas.ts`. Use negative years for BCE and `approx: true` for approximate dates. List earlier ideas it builds on in `buildsOn` (by `id`); these show up as links on the card.
