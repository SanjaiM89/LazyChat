# LazyChat × FalkorDB — "Engineering Company Brain" — Phase Tracker

Hackathon: **Graph Hacks: Context for AI Agents** (WeMakeDevs × FalkorDB), Oct 15–18, 2026.
Tracks entered: **all three** (1: Agents on Connected Data, 2: Agent Memory & Coordination, 3: Company Brain).

> This file is the living project tracker. It is updated at every phase boundary.

## Key decisions (log)

- **Merge + TypeScript port (owner decision, Oct 14)**: the Python FastAPI backend is retired — the entire brain (graph client, Cypher, algorithms, 15 tools, LLM adapters incl. Sarvam, intent, crew, memory, consolidation, procedures) is ported to TypeScript in `lib/brain/` and served by Next.js Route Handlers at `app/api/brain/*`. Omnia keeps all its features and gains a `companyBrain` tool plus FalkorDB-backed memory of its own conversations (`lib/brain/omnia-memory.ts`); `/brain` is now a same-origin view (fetch + SSE, no WebSocket, no :8000). The Python `backend/` was then deleted (Oct 14) — the repo is Python-free. Test runner is now `npm run test:brain` (`tests/brain/`, node:test + tsx, live graph, mock LLM); production build `next build --webpack` is green. `falkordb` must stay in `serverExternalPackages` (RSC bundling breaks its CJS driver).

- **Repo layout**: the repo root already contains a **Next.js 16 app** ("LazyChat"/"Omnia") — no empty `frontend/` exists. Decision (confirmed with owner): all hackathon Python goes in `backend/`; the hackathon UI will be built **inside the existing Next.js app** (new route + components) instead of a separate `frontend/` folder. Deviation from the original spec noted here.
- **FalkorDB**: local Docker (`falkordb/falkordb:latest`) via `docker-compose.yml` during development; env-driven so Cloud credentials drop in at deploy time.
- **LLM**: no Anthropic key provided yet → agent core is being built behind an `LLMClient` abstraction with a deterministic **MockLLM** so the whole pipeline runs offline; swapping in real Claude = set `ANTHROPIC_API_KEY`.
- **Git**: owner handles commits; agent only writes files, never commits.
- **Data**: all seed data synthetic ("Meridian" is fictional); no private/personal data.
- **Natural-language resolution**: services carry a curated `aliases` list and decisions a `topics` list, matched case-insensitively in Cypher. Chosen over an embedding index because the domain vocabulary is small and enumerable, and it keeps every lookup auditable in the reasoning trace.
- **Test runner**: `cd backend && .venv/bin/python -m pytest tests/ -q` (**98 passing**). The FalkorDB container is `lcb-falkordb` on :6379; start with `docker run` because this machine's Docker has no compose v2 plugin.
- **README placement** (owner decision): the hackathon `README.md` now documents the Company Brain at the repo root, and the original Omnia README was **moved to `OMNIA.md`, not deleted**. The two files cross-link so neither project is hidden.
- **Session note**: an earlier OpenCode session stayed alive in the background and was overwriting files mid-task (it rewrote `scripts/seed_data.py` and re-seeded the graph). Detected by checksums changing mid-sample and by the agent's own log spawning `seed_data.py --reset`. Its Meridian dataset was **kept** (richer and better tested than mine); only my unused Nimbus draft was discarded. A snapshot of the pre-existing state is at `/tmp/opencode/backend-snapshot-151330/`.

## Phase 0 — Repository Scaffolding & Environment
**Status: COMPLETED**
- Done:
  - `backend/` structure created (`app/{api,agent,graph,memory,models,services}`, `scripts/`, `tests/`)
  - `backend/app/main.py` — hello-world FastAPI with `/` and `/api/health`, CORS configured
  - `backend/app/config.py` — env-driven settings (`get_settings()`)
  - `backend/requirements.txt`, `backend/.env.example`
  - Root `docker-compose.yml` for FalkorDB (+ browser UI on :3001 to avoid clashing with Next.js on :3000)
  - `backend/tests/test_health.py` — 2 smoke tests PASS
  - `uvicorn app.main:app` boots; `/api/health` returns 200
  - FalkorDB container running (`lcb-falkordb`, localhost:6379); `falkordb` Python client roundtrip verified
- Notes:
  - This machine has docker without the compose v2 plugin → container started via `docker run`; `docker-compose.yml` kept as the reviewed deployment spec for submission.
  - `.gitignore` addition pending: `backend/.venv`, `backend/.uv-cache`.
- Blockers: none

## Phase 1 — FalkorDB Foundation & Graph Schema
**Status: COMPLETED**
- Done:
  - `backend/app/graph/client.py` — singleton FalkorClient with query logging (every Cypher + params + duration), error surface (`GraphError`), `run_query`/`run_write`, `delete_graph` for `--reset`
  - `backend/app/graph/schema.md` — documented data model (8 domain labels + 6 memory/agent labels, 13 relationship types, example multi-hop paths)
  - `backend/app/graph/schema.py` — label/relationship constants, property map, idempotent index + best-effort unique-constraint creation (`init_schema()`)
  - `backend/app/graph/queries.py` — named canonical Cypher + wrappers: `find_person_by_name`, `find_experts_on_service`, `find_tickets_for_service`, `find_decision_rationale`, `shortest_path_between`, `multi_hop_context`, `subgraph_around`, `schema_summary`, read-only `run_custom_query` (write statements blocked)
  - `backend/app/graph/algorithms.py` — `pagerank` (**native `algo.pageRank` verified working**, degree-centrality fallback), `dependency_impact` (reverse transitive DEPENDS_ON), `expert_finder` (multi-hop, weighted: expert 3.0 / hands-on 1.5 / familiar 1.0 / owning-team 0.5), `bridge_services` (bottleneck proxy), `shortest_path_between_services`
  - `backend/app/graph/serialize.py` + `backend/app/models/graph.py` — node/edge → JSON conversion, Pydantic models (GraphNode/GraphEdge/Subgraph/ToolCall/AgentAnswer)
  - `backend/tests/test_graph.py` — **14 tests PASS** against live FalkorDB
- Decisions:
  - FalkorDB requires `shortestPath()` in `WITH`/`RETURN` (not bare `MATCH`) — canonical queries written accordingly.
  - falkordb-py `Path` exposes `.nodes()`/`.edges()` callables (not `.relationships()`).
- Blockers: none

## Phase 2 — Data Model & Seeding
**Status: COMPLETED**
- Done:
  - `backend/scripts/company_data.py` — the full synthetic "Meridian" dataset (fictional company; no real/private data) with a `validate()` integrity check (counts + referential integrity) and `expected_edges()` derived from the data
  - `backend/scripts/seed_data.py` — batched `UNWIND`/`MERGE` loader (`--reset`, `--stats`), plus `verify()` that hard-fails on any node/edge count mismatch
  - Seeded: 4 teams / 20 people / 10 services / 9 repos / 30 tickets / 20 documents / 15 decisions / 50 messages; 16 `DEPENDS_ON`, 41 `KNOWS_ABOUT`, 10 `BLOCKED_BY`, 97 `RELATES_TO`, 70 `AUTHORED`, 57 `MENTIONS`
  - `backend/tests/test_seed.py` — **17 tests** proving each demo question is answerable from the graph (who knows auth / what breaks if notifications goes down / who worked on payments / database decision rationale / auth-migration blocking chain / pagerank hub) + 7 plain-English alias-resolution tests. Full suite: **41 passed**
- Decisions:
  - Added two relationship types: `IN_REPO` (Service→Repo) and `BLOCKED_BY` (Ticket→Ticket) — neither fit an existing type, and Phase 9 needs blocking. Documented in `schema.md`
  - Added `Service.aliases` and `Decision.topics` curated keyword lists. Real bug this fixed: "the **notifications** service" did not match node `notification-service`, so the headline demo question returned nothing; "database choice" matched no ADR text
  - Seed data shaped so demo questions are genuinely multi-hop: added `event-pipeline DEPENDS_ON payments-api` so "what breaks if notifications goes down?" reaches 3 hops (payments-api→event-pipeline→recsys)
- Notes / bugs caught:
  - `MERGE` with missing endpoints writes **0 rows without erroring** — this had silently dropped every `KNOWS_ABOUT` edge (dict-literal ordering ran knowledge before services). Added `verify()` so this can never pass silently again
  - `delete_graph()` raised on a not-yet-existing graph; now tolerant so `--reset` works on a fresh DB
  - `FIND_DECISION_RATIONALE` returned duplicate rows via `OPTIONAL MATCH` fan-out; now collects services
  - Corrected a false alarm: I initially suspected a FalkorDB planner bug with 3-hop chains, but the query was semantically invalid (`DECIDED_BY` starts at `Decision`). Genuine rebinding/`shortestPath` quirks are documented in `schema.md`
  - Reduced `client.py` query logging verbosity (batch params printed as `[N rows]`) — the full dump buried the signal
- **Hardening pass (continuing session) — found by running the Phase 9 questions against the seeded graph rather than reading the code:**
  - **`Ticket-[:BLOCKED_BY]->Decision` was missing.** Only Ticket→Ticket blocking existed, so *"which tickets are blocked by the auth migration?"* returned **0 rows**. Added `TICKET_DECISION_BLOCKERS` (8 tickets → 2 decisions). The Auth v3 decision now blocks **7 tickets across 7 services and 2 teams** — the demo's headline multi-hop path.
  - **`Person-[:AUTHORED]->Decision` was missing** (decisions carried only `DECIDED_BY`), so the 3-hop *"who worked on payments and what did they decide?"* returned 0 rows. Now returns 4 people with their decisions.
  - **`Decision<-[:DISCUSSED_IN]-Message` was missing**, so no decision could cite the conversation that produced it — a direct threat to the Track 3 sourced-answer requirement. Added `DECISION_DISCUSSION` covering 13 of 15 decisions.
  - **`Ticket-[:IN_REPO]->Repo` added** (inherited from the ticket's service) so *"where does this work happen?"* needs no second hop.
  - **Seed-order bug:** tickets were seeded *before* decisions, so the Ticket→Decision `MERGE` matched nothing and silently created 0 edges. Reordered in `seed()`. This is the same class of bug as the `KNOWS_ABOUT` one above, and `verify()` now catches it.
  - `NODE_PROPERTIES` in `schema.py` was still describing the previous session's draft dataset (had `Person.team`, `Service.owner`, `Ticket.assignee` — none of which are stored). Realigned to the real node keys; added `RELATIONSHIP_PROPERTIES`.
  - `schema.md` rewritten to match the seeded graph exactly, including the **directions** that matter: `DEPENDS_ON` is runtime direction (blast radius is a reverse traversal), `DISCUSSED_IN` points *from* the message, and `BLOCKED_BY` has two target shapes (ticket vs decision).
  - Test edge-count assertions now derive from `data.expected_edges()` instead of hardcoded integers, so the suite cannot drift from the dataset again.
  - Discarded my own earlier Nimbus draft (`scripts/seed_dataset.py`, deleted — no importers) in favour of Meridian.
- Blockers: none

## Phase 3 — Agent Core with FalkorDB Context
**Status: COMPLETED**
- Done:
  - `backend/app/agent/llm.py` — `LLMClient`-shaped layer with two implementations behind one interface. `AnthropicLLM` uses native Claude tool use; **`MockLLM` is a real deterministic planner, not a stub** — it picks tools via the same tool-calling protocol, then composes an answer strictly from tool output. `get_llm()` selects on `ANTHROPIC_API_KEY` and never raises on a missing key, so the whole demo runs offline.
  - `backend/app/agent/prompts.py` — grounding rules (never invent; prefer graph algorithms over text search; cite node ids; negative results are valid), plus separate Researcher and Synthesizer system prompts.
  - `backend/app/agent/tools.py` — **13 tools** on a shared registry: `find_experts`, `trace_dependencies`, `impact_of_failure`, `get_decision_context`, `tickets_blocked_by`, `tickets_for_service`, `find_people`, `shortest_path`, `pagerank`, `bridge_services`, `graph_context`, `run_cypher` (read-only enforced). Every result carries `summary` + `cypher` + contributing nodes/edges, which is what makes the trace explainable.
  - `backend/app/agent/agent.py` — the loop: plan → execute Cypher → compose → return `{answer, reasoning_trace, graph_context, session_id, sources}`. `MAX_TOOL_ROUNDS=6`, errors become trace entries rather than crashes.
  - `backend/tests/test_agent.py` — 22 tests incl. a **planner table** asserting each phrasing routes to the right tool, and a grounding test that the agent declines questions the graph cannot answer.
- Notes / bugs caught:
  - **Topic extraction was the crux.** Naive stopword-stripping produced search terms like `"tickets blocked auth migration"` and matched nothing. Fixed by loading the graph's *own* vocabulary (`Decision.topics`, `Service.aliases`) and matching the question against it — `"auth migration"` → topic `auth` → the Auth v3 decision.
  - `_maybe_node()` only accepted dicts, but FalkorDB returns `Node` objects — every node-reading tool was silently returning zero results while reporting success. Fixed to coerce via `node_to_dict`.
  - `execute(name, client, **kwargs)` collided with the `find_people(name=...)` argument. Fixed with positional-only parameters (`/`).
  - Plural forms (`tickets`, `bottlenecks`, `decisions`) defeated the planner regexes; all rules now accept plurals.
  - `tickets_for_service` read `status` off the node wrapper instead of `node["properties"]["status"]`, reporting "0 not done" for a list of open tickets.
  - **Contributing subgraphs arrived edge-less**, so the UI could not draw a traversal path. Added a single enrichment query that fetches the real edges between the nodes the tools touched.
- Decisions:
  - Text-to-Cypher is served by the `run_cypher` tool plus `Decision.topics`/`Service.aliases` keyword matching. FalkorDB's hosted Text2Cypher needs a paid API key, so it is not a dependency; the NL→Cypher capability is preserved and inspectable.
- Blockers: none

## Phase 4 — Session & Agent Memory
**Status: COMPLETED**
- Done:
  - `backend/app/memory/session.py` — `Session`/`Turn` persistence, `list_sessions`, `get_turns`, and `recall_memories` (lexical, inspectable — deliberately not vector search, so the trace can show *which* memory node was recalled and why). Every read filters on `user_id`.
  - `backend/app/memory/consolidation.py` — after N turns, compresses a session into `EpisodicMemory` (+ `CONSOLIDATED_INTO` provenance) and extracts durable `SemanticMemory` facts; `install_procedures()` seeds a small floor of `ProceduralMemory` recipes.
  - **Rolling consolidation**: re-fires every `CONSOLIDATE_AFTER_TURNS` (4) *new* turns, tracked by `Session.consolidated_turns`. One `EpisodicMemory` per session is refreshed to cover the whole conversation and carries `turn_count`.
  - **Content-addressed facts**: `fact_id()` is a SHA-1 of the normalised text, so re-learning a fact MERGEs onto the existing node instead of appending a near-duplicate.
  - **Facts come from `Finding` nodes** (tool output), falling back to assistant prose. Recall markers (`earlier sessions`, `[episodic]`, `[semantic]`) are rejected outright.
  - `backend/app/agent/crew.py` — **Researcher → Synthesizer handoff through shared graph state.** The Researcher writes `Finding` nodes; the handoff is an `AgentHandoff` node with `-[:RECORDED]-> Finding` edges; the Synthesizer reads only the findings. Nothing passes through a local variable, so the handoff is queryable and visible in the UI afterwards.
  - `backend/tests/test_memory.py` — 12 tests: session lifecycle, consolidation, cross-session recall, **per-user isolation**, handoff graph shape, and an end-to-end test asserting the recall is visible in the answer.
- Notes / bugs caught:
  - FalkorDB rejects parameters imported into `CALL {}` (`WITH $uid AS uid` still fails). Replaced the `CALL { } UNION` recall query with a single label-agnostic `MATCH`.
  - `read_findings()` was not passing the `agent` parameter — every call raised `Parameter agent not found`.
  - The Synthesizer calls the LLM with `tools=[]`, which made `MockLLM` try to *plan* instead of compose, so recalled memory never reached the answer. Added a composer role that reads findings and memory out of the prompt.
  - Memory is only foregrounded when the graph came up empty; otherwise fresh evidence leads and recall is appended, so stale context cannot drown out current data.
  - **Found by auditing the write path after delivery** (two defects, both fixed):
    1. *A session consolidated exactly once, ever.* The gate returned False forever once a `CONSOLIDATED_INTO` edge existed, so **turns 3–7 of a long conversation were silently never remembered**. Measured: 1 consolidation across a 14-turn session. Now gated on *new* turns since the last consolidation via `Session.consolidated_turns` — fires at questions 2, 4, 6, …
    2. *Semantic facts duplicated and compounded.* Dedup was only within one call, keyed on `fact[:80]`, so each session appended copies. Worse, recall text was fed into the summary and back into memory, so **each session's memory became a copy of the previous one's**. Fixed by content-addressed ids and by sourcing facts from tool `Finding`s instead of prose, with recall markers rejected.
- Decisions:
  - Memory nodes live in the same FalkorDB graph as the company data. Removing FalkorDB removes recall along with everything else, which is what the hackathon rule requires.
  - **The agent writes its own `ProceduralMemory`** (`app/agent/procedures.py`). After a turn, tool calls that actually *returned rows and did not error* are generalised into a recipe: concrete argument values become slots (`find_experts(service='$service')`), the task is labelled from the tools used (refined by the LLM when one is configured), and the recipe is content-addressed so re-learning updates rather than duplicates. On the next similar question the recipe is recalled, shown to the Researcher as a hint (never an instruction), and its success is recorded (`uses`/`applied`/`successes`). The seeded recipes remain as a floor for question types the agent has not met yet.
  - **Recipes record *why*, not just *what*.** `reflect()` asks the model for `rationale` / `applies_when` / `avoid_when`, stored on the node and rendered in the prompt hint. Offline it falls back to the tool-semantics table, so a recipe is never stored as a bare command list. The `avoid_when` condition is what stops a recipe from being mis-applied to a question that merely shares vocabulary.
  - **Fact extraction is LLM-driven when a key is present** (`extract_facts_llm`), with a grounding guard: a fact survives only if it appears verbatim in the source, or ≥70% of its content words do (floor of 3). The model may re-segment and re-word; it may not invent. Recall markers are rejected on both paths.
  - Recipes are *hints, not overrides* — the Researcher is free to ignore one. And a failed run teaches nothing, so an error can never be mistaken for a skill.
- Blockers: none

## Phase 5 — FastAPI Endpoints
**Status: COMPLETED**
- Done:
  - `backend/app/api/chat.py` — `POST /api/chat` and `WS /api/chat/stream`. The socket streams the **trace as it is built**: a `tool` event per step, a `handoff` event at the Researcher→Synthesizer boundary, then `delta` chunks word-by-word, then `done`.
  - `backend/app/api/graph.py` — `/api/graph/schema` (legend + live counts), `/subgraph`, `/node/{id}` (citation detail), `/query` (read-only console), `/search` (type-ahead for clickable citations). One shared `NODE_COLORS` palette so backend and frontend agree.
  - `backend/app/api/sessions.py` — `/api/sessions/{user}`, `/{session_id}/turns`, `/{session_id}/activity` (Agent Activity panel), `/api/memory/{user}`, `/api/memory/{user}/consolidate`.
  - `backend/app/models/api.py` — request/response models.
  - `backend/app/main.py` — routers mounted, request-duration logging middleware, catch-all exception handler that never leaks a traceback, `/api/health` that actually pings FalkorDB.
  - `backend/tests/test_api.py` — **18 tests** over real routing: validation (422), subgraph 404, write rejection (400), session continuity, agent-timeline contents, memory consolidation via HTTP.
- Notes / bugs caught:
  - WebSocket writes happen on a worker thread (the agent is blocking). First attempt used `anyio.from_thread.run`, which does not apply to `asyncio.to_thread`; switched to `asyncio.run_coroutine_threadsafe` with the captured loop.
  - The streaming path loaded only `s.name`, so the alias `notifications` was missing and *"If the **notifications** service goes down"* resolved to the wrong service. Now both paths call the agent's single `_known_services()` loader — one source of truth for vocabulary.
  - `ws.to_thread(...)` does not exist on Starlette's WebSocket.
  - Graph failures return **503**, not 500: the product genuinely depends on FalkorDB, so a dead graph is a dependency outage and should read like one.
- Blockers: none

## Phase 6 — Frontend Chat with Graph Visualization
**Status: COMPLETED**
- Decision (from earlier phases): the UI lives **inside the existing Next.js 16 app** at route **`/brain`**, not in a separate `frontend/` folder. Deviation from the original spec, noted in "Key decisions" above.
- Done:
  - `lib/brainApi.ts` — typed API client (`NEXT_PUBLIC_API_URL`, defaults to `http://localhost:8000`) plus a `streamChat()` WebSocket wrapper with a documented event protocol.
  - `app/brain/page.tsx` + `components/brain/BrainApp.tsx` — three-pane layout: session sidebar, chat, graph/activity/memory panel.
  - `components/brain/GraphCanvas.tsx` — `react-force-graph-2d` (installed), custom canvas painting so nodes are coloured by label, edges coloured by relationship type, contributing nodes ringed in amber, and the traversal path **animated one node at a time**. Click a node → `/api/graph/subgraph` expands the view.
  - `components/brain/Panels.tsx` — `ReasoningTrace` (collapsible: tool, args, Cypher, rows, duration, error), `AgentActivity` (findings + handoffs as a timeline), `MemoryPanel` (episodic/semantic with timestamps).
  - Message bubbles carry agent badges (`researcher`/`synthesizer`) and **clickable source chips** that highlight the node in the graph.
  - Suggested-question panel, per-user session list with previews and turn counts, "show trace" toggle, detail panel for the clicked node.
- Verified in a real browser (not just compiled): answered a question end-to-end — answer text, agent badges, Cypher in the trace, and a live canvas with 18 nodes / 26 edges painted.
- Notes / bugs caught:
  - Next 16 dev defaults to Turbopack and refuses the repo's webpack config → run with `next dev --webpack`.
  - `react-force-graph-2d` touches `window` at import; loaded via `next/dynamic` with `ssr:false`.
  - The WebSocket path and the REST fallback both populate the graph, so the UI degrades instead of breaking where a proxy blocks sockets.
  - `app.main` startup used `@app.on_event`, which is **deprecated** in this FastAPI; switched to the `lifespan` context manager.
- Blockers: none

## Phase 7 — Explainability & Graph Algorithms as Tools
**Status: COMPLETED**
- Done:
  - Added three **native FalkorDB** algorithms to `algorithms.py`, discovered by introspecting `dbms.procedures()` rather than assuming:
    - `betweenness_centrality()` — `algo.betweenness`, with a path-counting fallback
    - `harmonic_centrality()` — `algo.HarmonicCentrality` (centrality not dominated by degree)
    - `communities()` — `algo.labelPropagation`, org-shaped
  - New agent tools: `find_bottlenecks`, `central_services`, `team_clusters` (registry now **15 tools**), each returning nodes + Cypher for the trace.
  - Prompt now names the right measure for each kind of structural question, so the agent picks between them deliberately instead of defaulting to text search.
  - `scripts/reset_memory.py` — clears Session/Turn/Finding/Handoff/memory nodes while **asserting the seeded company data is intact** (`--dry-run`, `--keep-user`).
- Notes / bugs caught:
  - These procedures accept **one** argument on this server; the usual `CALL algo.betweenness(null, {...})` two-arg form is rejected. Correct form is `CALL algo.betweenness({nodeLabels:['Service']})`.
  - Community detection initially grouped by bare label ("Message: 50 nodes") because the graph had no team link for those nodes. Fixed by resolving each node's **home team** through `MEMBER_OF`/`OWNS`/`RELATES_TO`/`AUTHORED`. Clusters are now Platform (58), Payments & Billing (44), Data & ML (25), Growth & Activation (22).
  - Test and manual sessions had polluted the graph (218 Turns, 130 Findings), which also skewed PageRank and communities. That is what `reset_memory.py` exists to prevent.
- Decisions:
  - "Bottleneck" routes to native betweenness rather than the `bridge_services` approximation; `bridge_services` remains available as a distinct measure (on many dependency chains).
- Blockers: none

## Phase 8 — Multi-Agent Coordination & Memory Demo
**Status: COMPLETED**
- Done:
  - Handoff is logged as an `AgentHandoff` node with `-[:RECORDED]-> Finding` edges. Verified by a test asserting the edge exists and carries the findings.
  - Frontend **Agent Activity** tab: findings and handoffs rendered as a chronological timeline (`/activity` returns them ordered).
  - Frontend **Memory** tab: episodic + semantic nodes with `kind` badges, timestamps, and per-kind counts from `/api/memory/{user}`.
  - `backend/scripts/demo_flow.py --track 2` runs the full two-session demo and **is the demo-video script**: Session 1 → consolidation → handoff inspection → Session 2 (new id) → per-user isolation check.
- Verified end-to-end in the browser: after two questions the Memory tab showed `EpisodicMemory: 1 | SemanticMemory: 1` with the auth-migration summary, and the Agent Activity tab showed `researcher → synthesizer` handoffs with timestamps.
- Bug found by running the demo (not by testing):
  - **The Synthesizer read every finding in the session**, so the second answer restated the first. Fixed with a `turn_ref` stamped on each `Finding`, threaded through `run_researcher` / `run_synthesizer` / `ask_crew` **and** the streaming path. Regression test asserts answer 2 does not contain `MER-1002`.
- Blockers: none

## Phase 9 — Company Brain Depth
**Status: COMPLETED**
- All four required questions verified against the seeded graph:

  | Question | Traversal | Result |
  |---|---|---|
  | Who worked on payments and what decisions did they make? | `Person-[:AUTHORED]->Decision-[:RELATES_TO]->Service` | 3 decisions, named deciders |
  | Which tickets are blocked by the auth migration? | `Ticket-[:BLOCKED_BY]->Decision` | 7 tickets / 7 services / 2 teams |
  | What did we decide about the database and why? | `Decision-[:DECIDED_BY]->Person`, `[:DISCUSSED_IN]` | Postgres ADR + rationale + discussion |
  | If notifications goes down what breaks? | reverse `DEPENDS_ON*1..5` | 4 services, grouped by hop distance |

- Every answer carries sources as clickable chips; clicking one highlights the node and opens its detail (`/api/graph/node/{id}` → properties + neighbours).
- Blockers: none

## Phase 10 — Polish, Deployment & Submission
**Status: COMPLETED except deployment + demo video (need credentials)**
- Done:
  - `README.md` rewritten as the hackathon submission doc: description, architecture diagram, graph data model, the Cypher the product depends on, algorithm table, tool list, explainability contract, setup, API reference, testing, tracks, AI disclosure. **The previous Omnia README was moved to `OMNIA.md`, not deleted** — the two files cross-link.
  - `BLOG.md` — blog post for the side prize: why these questions are structural rather than similarity problems, the three schema decisions each forced by a failing query, the two bugs that shaped the design, what FalkorDB provided, and what we'd do next.
  - `scripts/demo_flow.py` — all three tracks, doubles as the demo-video script.
  - `scripts/reset_memory.py` — clears conversation state and asserts company data is intact.
  - Full suite green: **148 tests**.
- Verified in a real browser (not merely compiled): answer text, agent badges, Cypher shown in the trace, live canvas (18 nodes / 26 edges), Agent Activity timeline, Memory panel, and the turn-scoping fix.
- Remaining (requires credentials / a human):
  - Deploy FalkorDB (Cloud or a VM) and set `FALKORDB_HOST/PORT/GRAPH_NAME/PASSWORD`
  - Deploy the backend (`uvicorn app.main:app`) and set `CORS_ORIGINS`
  - Deploy the frontend with `NEXT_PUBLIC_API_URL` **set at build time** (Next inlines it)
  - Record the 2–3 min demo video from `python scripts/demo_flow.py --track 1|2|3` plus the `/brain` UI
- **SarvamAI provider added** (`sarvam-105b`, key in `backend/.env`): `SarvamLLM` speaks the same protocol but has **no native tool use** — it emits JSON in a code fence, which `parse_tool_calls()` converts back into tool invocations. The adapter also synthesises the `tool_call_id`s the API requires on tool messages (the model cannot supply them) and retries the intermittent empty response (`finish_reason=length`). Verified live: 6/6 demo questions answered from the graph, correctly.
- **Frontend fix found only because the provider got slower**: the REST fallback fired on a 1.5s timer, so with a 20–90s model *every* question launched a duplicate full agent run alongside the streaming one, and the Send button re-enabled while the answer was still pending. Fallback now triggers only on real socket failure, with a 60s timeout warning.
- `tests/conftest.py` pins `LLM_FORCE_MOCK=1` so the suite stays offline and deterministic — without it, a configured key turns every agent test into a 20–90s paid call.
- Blockers: deployment credentials, demo video recording

---

## Test suite summary

`cd backend && .venv/bin/python -m pytest tests/ -q` → **148 passed**

| File | Focus |
|---|---|
| `test_graph.py` | client, schema, canonical queries, algorithms |
| `test_seed.py` | seed integrity + demo questions answerable |
| `test_agent.py` | tool dispatch, grounding, trace shape, planner routing, no company-data mutation |
| `test_memory.py` | sessions, consolidation, cross-session recall, per-user isolation, handoff graph, turn scoping |
| `test_api.py` | routing, validation, 404/400 paths, session continuity |
| `test_procedures.py` | slot generalisation, success-gating, recipe reuse, per-user scoping |
| `test_health.py` | app boot + health |

## Honest limitations

- Without `ANTHROPIC_API_KEY` the planner is `MockLLM` — deterministic and rule-based, not a language model. It exercises the whole pipeline but is not a general reasoner.
- The grounding guard is deliberately strict: a faithful paraphrase that swaps "7" for "seven" is *rejected*, because token overlap cannot verify it. Safety over yield — documented in `test_llm_fact_extraction_rejects_drift_too_far`.
- Procedural reflection is LLM-assisted, not LLM-authored: the model supplies the wording, the tool sequence supplies the identity, and a failed run still teaches nothing.
- Memory recall is lexical, not semantic; paraphrases will be missed.
- `algo.*` procedures take a single argument on this server version; the two-argument form fails.
- Seed data is synthetic. Pointing this at a real organisation needs an ingestion pipeline, which is out of scope here.
