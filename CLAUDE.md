# History of Ideas

A public timeline of human ideas. Accuracy matters more than coverage: an entry that isn't sourced must say so, and nothing is marked reviewed except by the fact-checker agent.

## Commands

- `npm run dev`: dev server at http://localhost:5173
- `npm run validate`: check all content (also runs first in `npm run build`)
- `npm run typecheck`
- `npm run review-hash -- <id>`: the hash a review of an idea must record
- `npm run pdftext -- <url-or-path> [first] [last]`: read a PDF source

## Content workflow

`draft` → `sourced` (author) → `reviewed` (fact-checker only)

1. **Author** (you, or any agent writing content): research the idea, add sources to `content/sources.yaml`, write the idea in `content/ideas/<id>.md` with `[@key, locator]` citations, and set `status: sourced` once every claim is cited. The format is in `README.md`; the schema is `src/content/schema.ts`.
2. **Review**: hand the idea to the `fact-checker` subagent (`.claude/agents/fact-checker.md`). It checks every claim against its sources, writes `content/reviews/<id>.md`, and sets `status: reviewed` only on a pass.
3. **On fail**: fix what the report lists, then send it back for review. Don't argue a verdict by editing the report.

Rules for authors:

- **Never** set `status: reviewed`, write a `review` block, or edit `content/reviews/`. The validator rejects reviews that don't match a passing report and the current content hash.
- Editing a reviewed idea, or any source it cites, invalidates its review. Set it back to `sourced` and re-review it.
- Cite only what you have read. Quote verbatim from the source, never from memory. If you only verified a reference's metadata, mark it `consulted: false`.
- Prefer scholarship (university presses, peer-reviewed journals, museum and research-institute publications) and primary texts. Never cite Wikipedia, AI output, content farms or exam-prep sites. Use encyclopedias only for uncontroversial facts.
- Avoid textbook simplifications: a single famous inventor, a tidy date, an overstated consequence. Say what a date marks and give the scholarly range.
- Drop a `buildsOn` link rather than keep one you can't source.
