# Agents

Three agents work on the knowledge graph. Each has one job, and the harness decides what gets written.

| Agent | Command | Job | Writes |
|---|---|---|---|
| **Extractor** | `npm run extract -- <source-key>` | Read a source document; extract the ideas it discusses, their synonyms, and the entities involved; match them against the graph by vector search | Aliases on existing ideas, new `candidate` ideas, entities, `DISCUSSES` and `INVOLVES` relationships |
| **Linker** | `npm run link -- <idea-id>` | Find similar earlier ideas by vector search and decide whether a link exists, and of what type (`BUILDS_ON`, `REACTS_AGAINST`, `PARALLELS`), with evidence | `linker` links, replacing the idea's unverified `seed` links |
| **Fact-checker** | `npm run review -- <idea-id>` | Check every claim in a sourced idea against its sources; the only path to `reviewed` | A `Review` record; the idea's status |

All three take `--dry-run` (run the agent, write nothing). `review` also takes `--force`, and `extract` takes `--focus "<what to look for>"`. Exit codes: 0 success, 1 error or incomplete run, 2 (review only) a failed review.

A typical flow:
1. Add a source (`npm run kg -- source put`).
2. `extract` from it.
3. A curator promotes good candidates and sources them (`npm run kg -- idea put`).
4. `link` the idea.
5. `review` it.

## Configuration

`.env` (see `.env.example`) holds the settings shared by all agents:
- `ANTHROPIC_API_KEY`
- `AGENT_MODEL` (default `claude-sonnet-5-5`, for cost; `claude-opus-5-5` for the strongest reasoning)
- `AGENT_EFFORT` (default `high`)
- per-run turn and spend limits, and web search limits

Graph lookups also need `OPENAI_API_KEY` (embeddings) and the Neo4j settings.

## Architecture

```
<agent>/cli.ts ─► <agent>/<run>.ts ─────────────────────────────────────────────┐
                    │ 1. load from the graph (kg/src/repository.ts)               │
                    │ 2. core/loop.ts ──► Claude (Messages API, streaming)         │
                    │      │  ▲              │                                     │
                    │      │  └─ results ◄── tool calls                            │
                    │      ▼                                                       │
                    │    core/tools/ ── read_source, search_source ─► net.ts ─► web
                    │      │            lookup_doi, europepmc, arxiv, archive      │
                    │      │            find_similar_ideas/entities, get_idea ─► vector indexes
                    │      │                 │                                     │
                    │      │                 └─► core/evidence.ts (every document read)
                    │      └── submit_<result> ─► <agent>/schema.ts checks ◄─┘     │
                    │ 3. write to the graph in one transaction ─────────────────────┘
                    └─► core/log.ts: .runs/<run-id>.jsonl (full transcript); AgentRun / Review node
```

| Path | Responsibility |
|---|---|
| `core/loop.ts` | The agent loop: requests, stop-reason handling, tool dispatch, turn and spend limits |
| `core/runtime.ts` | Shared setup for every CLI (config, API client, graph, embedder, Ctrl-C); run ids; transactions; `AgentRun` records |
| `core/config.ts` | Environment validation, price table for the budget guard |
| `core/evidence.ts` | Ledger of documents read; verbatim-excerpt matching |
| `core/tools/` | Shared tools: source reading (`documents.ts`, `scholarly.ts`, through `net.ts`) and graph lookups (`graph.ts`) |
| `core/log.ts`, `core/slug.ts` | Run transcripts; readable unique ids |
| `extractor/`, `linker/`, `fact-checker/` | Each agent's prompt (`prompt.md`), output schema and checks, orchestration and CLI |
| `test/` | Unit tests (`npm test`) |

## Design decisions

**Agents read and submit; they never write.** Each agent's tools read sources and query the graph, and it ends by submitting one structured result (`submit_extraction`, `submit_links`, `submit_review`). No agent has file system, shell or database-write access. The harness checks the submission, then writes it in a single transaction, so a rejected or abandoned run leaves the graph untouched.

**Structured results, checked by code.** Each submission is a strict-schema tool call, so its arguments always match the schema. The checks in each agent's `schema.ts` (or `verdict.ts`) run before anything is accepted:
- The extractor's matched ids must exist, and new ideas need a year, a basis for it, and an origin.
- The linker's targets must exist, be earlier, and not be candidates, and every candidate it was given must be accounted for.
- The fact-checker must cover every claim location and give a consistent verdict, and its final pass/fail is computed by code.

A rejected submission comes back with the list of problems so the agent can fix them. After three rejections the run ends without writing anything (the fact-checker records a fail instead).

**Evidence is checked against what was actually read.** Every document an agent fetches goes into the `EvidenceLedger` with a hash of its text. Every excerpt an agent offers, whether for an extracted idea, a link or a supported claim, must appear verbatim in one of those documents. Matching ignores PDF whitespace and hyphenation quirks. So an agent can't support a link with a remembered or invented quote.

**Vector search finds candidates; it's never evidence.** The extractor uses `find_similar_ideas` and `find_similar_entities` to recognise things the graph already has under other names, which avoids duplicates and accumulates synonyms. The linker starts from the most similar earlier ideas, but must find a source for every link and account for every candidate it rejects.

**Provenance everywhere.** Links, `DISCUSSES` and `INVOLVES` relationships carry the run id that created them. Each run is an `AgentRun` (or `Review`) node with model, turns and cost. Extractor proposals are `candidate` ideas, hidden from the site until curated.

**A manual agent loop.** `core/loop.ts` owns the request and tool cycle rather than using the SDK's beta tool runner. Every stop reason is explicit:
- `tool_use`: run the tools.
- `pause_turn`: a server tool paused; resend to resume.
- `end_turn` without a result: nudge, then give up.
- `max_tokens` and `refusal`: stop rather than act on a truncated or declined turn.

History is append-only, which keeps prompt caching and thinking continuity intact. Tool inputs are streamed (`eager_input_streaming`), so the loop validates them against each tool's zod schema before running.

**Untrusted input is handled as untrusted.**
- Model-chosen URLs go through `net.ts`: http(s) only, every redirect hop checked against private and loopback addresses (agents can't reach Neo4j or cloud metadata endpoints), bounded retries, and time and size caps.
- Fetched text and graph content are labelled as data, and every prompt tells the agent never to follow instructions found in them.

**Model settings.** Sonnet 5.5 by default, with adaptive thinking (`display: "summarized"`, so the transcript holds a reasoning summary) at effort `high`. System prompts and tool lists are fixed across runs, so they cache. Server-side refusal fallback is on by default (`AGENT_FALLBACK=off` disables it), and each run records which models served it.

**Every run is auditable.** `.runs/<run-id>.jsonl` holds the start parameters, every response (with thinking summaries and token usage), every tool call and result, and the outcome. It's local and git-ignored. Summaries live in the graph.

## Adding an agent or a tool

- **A tool:** `defineTool({ name, description, input: z.object({...}), run })` in `core/tools/`. Write the description to say when to call it. If it returns text an agent might quote, register it with `ctx.evidence.add(...)` (or fetch through `loadDocument`). Throw `ToolError` for failures the agent should see.
- **An agent:** a folder with:
  - `prompt.md` (its charter and method);
  - `schema.ts` (a strict submission schema, its checks, and a `createSubmit…Tool`);
  - an orchestration module that loads from the graph, calls `runAgentLoop`, writes the accepted result with `withWrite`, and records an `AgentRun`;
  - `cli.ts` using `openRuntime`.

  Add an npm script and tests for its checks.
