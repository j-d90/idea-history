# Fact-checker agent

The fact-checker is the single agent accountable for the accuracy of History of Ideas content. It reviews an idea by checking every claim against the sources it cites, and it is the only path by which an idea becomes `reviewed`.

```bash
npm run review -- writing                 # review one idea and record the result
npm run review -- writing alphabet        # several, one after another
npm run review -- writing --dry-run       # write the report to .runs/ only; change nothing
npm run review -- writing --force         # re-review even if already reviewed and unchanged
npm run review -- writing --store graph   # read from and record to Neo4j instead of content/
```

Exit code: 0 if everything passed (or was skipped), 2 if any review failed, 1 if a run errored or stopped before producing a verdict.

Configuration comes from `.env` (see `.env.example`): the API key, model (default `claude-sonnet-5-5`), effort (default `high`), per-review turn and spend limits, and which store to use.

## Architecture

```
cli.ts ─► reviewer.ts ───────────────────────────────────────────────┐
            │ 1. store.load(id) ─────────────► ReviewStore            │
            │                                  ├ FileReviewStore      │
            │                                  │   (content/)         │
            │                                  └ GraphReviewStore     │
            │                                      (kg/, Neo4j)       │
            │ 2. runAgentLoop ──► Claude (Messages API, streaming)    │
            │      │  ▲              │                                │
            │      │  └─ results ◄── tool calls                       │
            │      ▼                                                  │
            │    tools/ ── read_source, search_source ──► net.ts ──► web
            │      │       lookup_doi, europepmc, arxiv, archive      │
            │      │            │                                     │
            │      │            └──► EvidenceLedger (every document read)
            │      └── submit_review ──► verdict.ts checks ◄──┘       │
            │ 3. decide(): pass/fail computed by code                 │
            │ 4. renderReport()                                       │
            │ 5. store.save() ─────────────────────────────────────────┘
            └─► RunLog: .runs/<run-id>.jsonl (full transcript)
```

| File | Responsibility |
|---|---|
| `src/cli.ts` | Arguments, Ctrl-C handling, store selection, summary output |
| `src/config.ts` | Environment validation (zod), price table for the budget guard |
| `src/reviewer.ts` | One review end to end: load → eligibility → loop → decide → report → save |
| `src/loop.ts` | The agent loop: requests, stop-reason handling, tool dispatch, limits |
| `src/prompt.ts`, `prompts/fact-checker.md` | System prompt (the agent's charter and method) and the task message |
| `src/tools/` | The toolset: one file per concern, all through `net.ts` |
| `src/evidence.ts` | Ledger of documents read; verbatim-excerpt matching |
| `src/verdict.ts` | Verdict schema, submission checks, the final decision rule |
| `src/report.ts` | The Markdown review report |
| `src/store/` | `ReviewStore` interface and the file implementation |
| `src/log.ts` | Per-run JSONL transcript |
| `test/` | Unit tests (`npm test`) |

## Design decisions

**The agent can only read and submit.** Its tools fetch and search sources and submit a verdict. It has no file system, shell or database access, so it can't edit content, its own report or the review record. The harness decides what gets persisted.

**Structured verdict, deterministic decision.** The agent's output is a JSON verdict submitted through `submit_review`, which uses a strict schema, so arguments always match it. The verdict holds per-source assessments, a per-claim table and entry-level checks. Code then decides pass or fail (`decide()` in `verdict.ts`): the agent's "pass" is required but never sufficient, and code never upgrades a fail.

**Evidence is checked against what was actually read.** Every document the agent fetches goes into the `EvidenceLedger`, with a SHA-256 hash of its text. For each claim marked supported, the quoted excerpt must appear verbatim in one of those documents. Matching ignores the whitespace and hyphenation quirks of PDF extraction. If any check fails (a fabricated or misremembered quote, a missing claim location, a source left unassessed, a pass that contradicts its own claims), the submission is rejected with the list of problems so the agent can fix them. After three rejections it is accepted as a fail. The report's "Documents read" table comes from the ledger, not from the model.

**Reviews are bound to content.** The store returns a content hash at load time, and `save` refuses to record a review if the content changed during the run. The validator then rejects any review whose hash no longer matches.

**A manual agent loop.** `loop.ts` owns the request/tool cycle rather than using the SDK's beta tool runner. Every stop reason is explicit:

- `tool_use`: run the tools.
- `pause_turn`: a server tool paused; resend to resume.
- `end_turn` without a verdict: nudge, then give up.
- `max_tokens` and `refusal`: stop, rather than act on a truncated or declined turn.

The loop also enforces turn and spend limits, with a wrap-up warning at 80%. History is append-only, with assistant turns and thinking blocks sent back unchanged, which keeps prompt caching and thinking continuity intact.

**One schema per tool.** Each tool is a zod schema plus a `run` function (`tools/types.ts`). The schema generates the JSON Schema sent to the API and also validates what comes back. Tool inputs are streamed (`eager_input_streaming`), which means the API doesn't validate them, so the loop does before running anything. Expected failures throw `ToolError` and go back to the agent as error results, so it can adapt, for example by trying an archived copy.

**Untrusted input is handled as untrusted.**
- URLs come from the model, so `net.ts` allows only http(s), resolves each redirect hop and refuses private, loopback and link-local addresses (it can't reach Neo4j or cloud metadata endpoints), and caps time and size.
- Fetched text is wrapped and labelled as data, and the system prompt tells the agent never to follow instructions in sources.

**Model settings.** Claude Sonnet 5.5 by default, for cost (set `FACT_CHECKER_MODEL=claude-opus-5-5` for the strongest reviewer). Adaptive thinking (`display: "summarized"`, so the reasoning summary is in the transcript) at effort `high`, which suits intelligence-sensitive work. The system prompt and tools are fixed across runs, so they cache.

Server-side refusal fallback (`fallbacks: "default"`) is on by default. If a safety classifier declines a turn, the API retries it on Anthropic's recommended fallback model. The report records which models actually served the review. Set `FACT_CHECKER_FALLBACK=off` to fail such runs instead.

**Every run is auditable.** `.runs/<run-id>.jsonl` holds the start parameters, every response (with thinking summaries and token usage), every tool call and result, and the decision. It is local and git-ignored, and the report references it.

## Adding a tool

1. Create it with `defineTool({ name, description, input: z.object({...}), run })` in `src/tools/`. Write the description to say when to call it.
2. If it returns source text the agent might quote, register it with `ctx.evidence.add(...)` (or fetch through `loadDocument`) so excerpts from it can be verified.
3. Throw `ToolError` for failures the agent should see; let other errors propagate.
4. Add it to `buildTools` in `src/tools/index.ts`, and mention it in `prompts/fact-checker.md` if the agent needs to know when to use it.
