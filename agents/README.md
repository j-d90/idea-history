# Agents

Six agents work on the knowledge graph, and a pipeline runs them. Each agent has one job, and the harness decides what gets written.

Events are the raw observations of history. Ideas are identified from them, then written up, linked and checked:

```
gatherer ─► events ─► interpreter ─► ideas (candidates) ─► author ─► sourced ─► linker ─► fact-checker ─► reviewed
                                                             ▲                                │
                                                             └──────── failed review ◄────────┘
```

| Agent | Command | Job | Writes |
|---|---|---|---|
| **Gatherer** | `npm run gather -- events --from <year> --to <year>` | Collect observations of one type (events, for now) for a period, from sources it reads and quotes | `sourced` events, the new sources they cite, entities |
| **Interpreter** | `npm run interpret -- --from <year> --to <year>` | Decide which of a period's events show an idea emerging (earliest evidence, articulation, institutionalization, spread), with evidence; match ideas by vector search | `EMERGES_IN` links, aliases, new `candidate` ideas |
| **Author** | `npm run author -- <idea-id \| event:id>` | Curate candidates (write or decline), source drafts, revise entries that failed review; every citation backed by a quote from that source | The entry, now `sourced`; its new sources |
| **Linker** | `npm run link -- <idea-id>` | Find similar earlier ideas by vector search and decide whether a link exists, and of what type (`BUILDS_ON`, `REACTS_AGAINST`, `PARALLELS`), with evidence | `linker` links, replacing the idea's unverified `seed` links |
| **Fact-checker** | `npm run review -- <idea-id \| event:id>` | Check every claim in a sourced idea or event against its sources; the only path to `reviewed` | A `Review` record; the entry's status |
| **Extractor** | `npm run extract -- <source-key>` | Read one source document; extract the ideas it discusses, their synonyms and the entities involved | Aliases on existing ideas, new `candidate` ideas, entities, `DISCUSSES` |

Every agent takes `--dry-run` (run the agent, write nothing). Other flags:
- `review` and `author` take `--force`.
- `gather` takes `--focus "<what to look for>"` and `--searches <n>`.
- `extract` takes `--focus`.

Years are negative for BCE, or written like `2500bce`. Exit codes: 0 success, 1 error or incomplete run, 2 (review only) a failed review.

## The pipeline

`npm run pipeline` works out from the graph what each item needs next, and prints the plan with cost estimates. Planning is free; it runs nothing.

```bash
npm run pipeline                                   # plan for everything already in the graph
npm run pipeline -- --from 2500bce --to 2001bce    # also plan gathering for that range, in windows
npm run pipeline -- --only review,revise           # just some stages
npm run pipeline -- --from 2500bce --to 2001bce --run --budget 10   # run it, spending at most about $10
```

- **What each stage picks up:**

  | Stage | Picks up |
  |---|---|
  | review | Sourced entries whose current content hasn't been reviewed |
  | revise | Entries whose current content failed review |
  | link | Sourced ideas not linked since they changed |
  | author | Candidates and drafts |
  | interpret | Gathered periods whose events changed since they were last interpreted |
  | gather | Requested windows not yet gathered |

  An entry the author already declined, or tried and failed to fix, isn't retried until something changes.
- **Order:** downstream work goes first (the order of the table), so the budget finishes entries before starting new ones.
- **Re-planning:** the plan is recomputed after every task, so each stage's output feeds the next within one run.
- **Gathering windows** default to 100 years before 1000 BCE, narrowing to 5 years after 1800 CE (`--step` overrides).
- **Budget:** `--run` requires `--budget`. The runner stops before a task whose average cost would exceed what's left. Each agent run also has its own `AGENT_MAX_USD` limit.

This is a first draft. It runs one task at a time, and its cost estimates are averages of past runs (web search fees are extra).

## Configuration

`.env` (see `.env.example`) holds the settings shared by all agents:
- `ANTHROPIC_API_KEY`
- `AGENT_MODEL` (default `claude-sonnet-5-5`, for cost; `claude-opus-5-5` for the strongest reasoning)
- `AGENT_EFFORT` (default `high`)
- per-run turn and spend limits, and web search limits

Graph lookups also need `OPENAI_API_KEY` (embeddings) and the Neo4j settings.

## Architecture

```
<agent>/cli.ts ─► <agent>/<run>.ts ─────────────────────────────────────────────┐   (pipeline/ calls the same <run>.ts functions)
                    │ 1. load from the graph (kg/src/repository.ts)               │
                    │ 2. core/loop.ts ──► Claude (Messages API, streaming)         │
                    │      │  ▲              │                                     │
                    │      │  └─ results ◄── tool calls                            │
                    │      ▼                                                       │
                    │    core/tools/ ── read_source, search_source ─► net.ts ─► web
                    │      │            lookup_doi, europepmc, arxiv, archive      │
                    │      │            find_similar_ideas/events/entities, get_idea/event ─► vector indexes
                    │      │            register_source ─► core/sources.ts (checked on the spot)
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
| `core/sources.ts` | `register_source`, and the check that an excerpt comes from the cited source itself |
| `core/entities.ts` | Entity references shared by agents that record entities |
| `core/log.ts`, `core/slug.ts`, `core/args.ts`, `core/period.ts` | Run transcripts; readable unique ids; year arguments; periods |
| `gatherer/`, `interpreter/`, `author/`, `linker/`, `fact-checker/`, `extractor/` | Each agent's prompt (`prompt.md`), output schema and checks, orchestration and CLI |
| `gatherer/observations/` | Observation types: each defines its guidance, item schema, checks and writes; `events.ts` is the first |
| `pipeline/` | The planner (`plan.ts`) and runner (`cli.ts`) |
| `test/` | Unit tests (`npm test`) |

## Design decisions

**Agents read and submit; they never write.** Each agent's tools read sources and query the graph, and it ends by submitting one structured result (`submit_observations`, `submit_interpretation`, `submit_entry`, `submit_links`, `submit_review`, `submit_extraction`). No agent has file system, shell or database-write access. The harness checks the submission, then writes it in a single transaction, so a rejected or abandoned run leaves the graph untouched.

**Structured results, checked by code.** Each submission is a strict-schema tool call, so its arguments always match the schema. The checks in each agent's `schema.ts` (or `verdict.ts`) run before anything is accepted:
- **Gatherer:** each event falls within the requested period, has consistent dates (no year 0; earliest ≤ year ≤ latest) and at least one citation, and existing ids are real.
- **Interpreter:** every event in the period is accounted for (in an emergence, or listed with a reason). A new idea can't be placed after its own earliest evidence.
- **Author:** the entry passes the content rules for `sourced`. Every distinct `[@key, locator]` has a supporting excerpt, and anything in quotation marks is verbatim.
- **Extractor:** matched ids exist, and new ideas need a year, a basis for it, and an origin.
- **Linker:** targets exist, are earlier, and aren't candidates, and every candidate it was given is accounted for.
- **Fact-checker:** every claim location is covered and the verdict is consistent; the final pass or fail is computed by code.

Strict tools are compiled into a grammar, and the API refuses one that's too large. `npm run check-tools` confirms the API accepts every agent's tools, for a fraction of a cent. Run it after changing a submission schema.

A rejected submission comes back with the list of problems so the agent can fix them. After three rejections the run ends without writing anything (the fact-checker records a fail instead).

**Evidence is checked against what was actually read.** Every document an agent fetches goes into the `EvidenceLedger` with a hash of its text. Every excerpt an agent offers, whether for an extracted idea, a link or a supported claim, must appear verbatim in one of those documents. Matching ignores PDF whitespace and hyphenation quirks. So an agent can't support a link with a remembered or invented quote.

**A citation must be backed by the source it cites.** Agents that write content (the gatherer and the author) cite bibliography keys, and each citation's excerpt must be found in that source's own document as read during the run, not merely in some document. New works are registered with `register_source` right after reading them; the harness checks the entry (fields, source policy, that the URL was read) on the spot. A run saves only the registered sources it actually cites.

**Vector search finds candidates; it's never evidence.** The extractor uses `find_similar_ideas` and `find_similar_entities` to recognise things the graph already has under other names, which avoids duplicates and accumulates synonyms. The linker starts from the most similar earlier ideas, but must find a source for every link and account for every candidate it rejects.

**Provenance everywhere.** Links, emergences, `DISCUSSES` and `INVOLVES` relationships carry the run id that created them. Each run is an `AgentRun` (or `Review`) node with model, turns and cost; runs over a period record its `from` and `to`. Proposed ideas are `candidate`s, hidden from the site until the author curates them. The pipeline reads this history to decide what's next.

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
- **An observation type** for the gatherer: a module in `gatherer/observations/` implementing `ObservationType` (guidance, item schema, checks, write), registered in `gatherer/gather.ts`.
- **An agent:** a folder with:
  - `prompt.md` (its charter and method);
  - `schema.ts` (a strict submission schema, its checks, and a `createSubmit…Tool`);
  - an orchestration module that loads from the graph, calls `runAgentLoop`, writes the accepted result with `withWrite`, and records an `AgentRun`;
  - `cli.ts` using `openRuntime`.

  Add an npm script and tests for its checks.
