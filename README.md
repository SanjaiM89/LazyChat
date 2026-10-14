# Engineering Company Brain

**An AI agent that answers questions about your engineering organisation by traversing a graph.**

Ask *"which tickets are blocked by the auth migration?"* and the agent doesn't
search text — it traverses `(:Ticket)-[:BLOCKED_BY]->(:Decision)` and comes back
with seven tickets across seven services and two teams, plus the Cypher it ran,
the graph nodes it touched, and the conversation where the decision was argued.

Built for **Graph Hacks: Context for AI Agents** (WeMakeDevs × FalkorDB), Oct 15–18 2026.
Tracks entered: **all three**.

---

## Why this is a graph problem, not a search problem

The questions this product exists to answer are *relational*:

| Question | Why text search fails | What the graph does |
|---|---|---|
| Which tickets are blocked by the auth migration? | "auth" appears in 40 ticket titles | `Ticket-[:BLOCKED_BY]->Decision`, 7 hits across 7 services |
| If notifications goes down, what breaks? | "notifications" is mentioned everywhere | reverse transitive `DEPENDS_ON`, 4 services by hop distance |
| Who knows the auth system? | everyone mentions auth in Slack | `expert_finder`: weighted multi-hop ranking **with evidence** |
| What did we decide about the database, and why? | the ADR rationale is one field | `Decision<-[:DISCUSSED_IN]-Message` cites the actual discussion |
| Which service should we fix first? | no text answer exists | betweenness centrality |

FalkorDB is load-bearing throughout. Remove it and there is no answer, no memory,
no multi-agent coordination, and no UI — because all four *are* the graph.

---

## Architecture

```
┌──────────────────────────── Next.js 16 app ───────────────────────────────────┐
│  Omnia (/)          │  Company Brain (/brain)                                │
│  chat + artifacts   │  session sidebar │ chat + reasoning trace │ graph canvas │
│  + Brain tool +     │  activity · memory panels                             │
│    FalkorDB memory  │                                                       │
│                     │  lib/brainApi.ts → same-origin fetch + SSE              │
├─────────────────────┴───────────────────────────────────────────────────────┤
│                    app/api/brain/* (Route Handlers, nodejs)                   │
│  chat (POST) · chat/stream (SSE) · graph/schema · graph/subgraph ·           │
│  graph/node/… · graph/query · graph/search · sessions · memory               │
├─────────────────────────────────────────────────────────────────────────────┤
│                          lib/brain/ (TypeScript port)                         │
│  agent.ts (askAgent) · crew.ts (Researcher ─Finding/Handoff→ Synthesizer)    │
│  tools.ts (20 tools — the ONLY way the agent touches the graph)               │
│  llm.ts (SarvamLLM ⇄ AnthropicLLM ⇄ MockLLM, deterministic offline)          │
│  memory/session.ts · memory/consolidation.ts · procedures.ts · intent.ts     │
│  graph.ts (client) · cypher.ts (canonical Cypher) · algorithms.ts (GDS)      │
└────────────────────────────────────┬────────────────────────────────────────────┘
                                     │ Cypher
┌────────────────────────────────────▼────────────────────────────────────────────┐
│                    FalkorDB  ·  graph `company_brain`                             │
│                                                                                 │
│   Person · Team · Service · Repo · Ticket · Document · Decision · Message        │
│   Session · Turn · EpisodicMemory · SemanticMemory · ProceduralMemory           │
│   Finding · AgentHandoff                                                       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### The agent loop

```
question
  └─ recall memory (FalkorDB)         ← prior sessions for this user
  └─ Researcher: plan tools → run Cypher → write :Finding nodes
  └─ AgentHandoff: researcher → synthesizer, -[:RECORDED]-> findings
  └─ Synthesizer: compose answer from findings + recalled memory only
  └─ return { answer, reasoning_trace, graph_context, sources, activity }
```

The handoff is a **graph node**, not a local variable — so it is queryable,
countable and visible in the UI after the fact.

---

## Quick start

One stack: Next.js (Omnia + Brain UI + brain API routes) and FalkorDB.
Requires Docker and Node 20+.

```bash
# 1. FalkorDB
docker compose up -d                 # or: docker run -p 6379:6379 falkordb/falkordb:latest

# 2. App
npm install
npx tsx scripts/brain-seed.ts --reset  # load the synthetic company (idempotent)
npm run dev -- --webpack
# open http://localhost:3000/       (Omnia — now with Brain tool + FalkorDB memory)
# open http://localhost:3000/brain  (Company Brain demo view)
```

LLM providers are optional. With no keys the deterministic mock planner answers
from the graph offline. To use a real model, set `LLM_PROVIDER` plus the key in
`.env.local` (see `.env.example`): `sarvam` (`SARVAM_API_KEY`, model
`sarvam-105b`) or `anthropic` (`ANTHROPIC_API_KEY`).

Verify: `npm run test:brain` → **23 passed** (conversational-robustness suite).

### Seed / memory utilities (TypeScript)

```bash
npx tsx scripts/brain-seed.ts            # seed (idempotent MERGE, safe to re-run)
npx tsx scripts/brain-seed.ts --stats    # just print what is in the graph
```

The original Python backend was fully ported to TypeScript (`lib/brain/` +
`app/api/brain/*`) and then removed — this repo is Python-free.

### Try it

Ask the Brain (via `/brain` or the `companyBrain` tool in Omnia):

- Which tickets are blocked by the auth migration?
- If notifications-service goes down, what breaks?
- Who knows the auth system?

---

## Graph data model

See **`lib/brain/schema.ts`** for the machine-readable model
(colours, labels, relationships, index bootstrap).

**Node labels** (synthetic dataset: 4 teams, 20 people, 10 services, 9 repos,
30 tickets, 20 documents, 15 decisions, 50 messages)

| Label | Key properties |
|---|---|
| `Person` | `name`, `role`, `email`, `seniority` |
| `Team` | `name`, `mission` |
| `Service` | `name`, `tier` (critical/high/medium/low), `language`, `aliases` |
| `Repo` | `name`, `url`, `language` |
| `Ticket` | `key` (`MER-1001`), `status`, `priority`, `opened` |
| `Document` | `kind` (design_doc/rfc/postmortem/runbook), `summary` |
| `Decision` | `rationale`, `status`, `topics` |
| `Message` | `content`, `channel`, `timestamp`, `author_id` |
| `Session` `Turn` | `user_id`, `role`, `content`, `agent` |
| `EpisodicMemory` `SemanticMemory` `ProceduralMemory` | `user_id`, `summary`/`fact`/`steps`, `about` |
| `Finding` `AgentHandoff` | `session_id`, `agent`, `content` / `from_agent`, `to_agent`, `reason` |

**Relationships**

| Relationship | From → To | Meaning |
|---|---|---|
| `DEPENDS_ON` | Service → Service | **directed**: A→B means A breaks when B dies |
| `BLOCKED_BY` | Ticket → Ticket, Ticket → Decision | peer blocking *or* gated on a decision |
| `KNOWS_ABOUT` | Person → Service `{level}` | declared expertise |
| `RELATES_TO` | Ticket/Document/Decision → Service | topical |
| `AUTHORED` | Person → Document / Message / Decision | authorship |
| `DECIDED_BY` | Decision → Person | who owned the call |
| `DISCUSSED_IN` | Message → Ticket/Document/Decision | **from** the message |
| `MENTIONS` | Message → Person / Service | polymorphic reference |
| `IN_REPO` | Service/Ticket → Repo | where the code lives |
| `MEMBER_OF` `OWNS` | Person → Team, Team → Service | org structure |
| `ASSIGNED_TO` | Ticket → Person | assignee |
| `CONSOLIDATED_INTO` `RECORDED` | Session → EpisodicMemory, AgentHandoff → Finding | provenance |

### The Cypher the product depends on

**Blast radius** — reverse transitive `DEPENDS_ON`:
```cypher
MATCH (root:Service) WHERE toLower(root.name) CONTAINS toLower($service)
MATCH path = (affected:Service)-[:DEPENDS_ON*1..5]->(root)
RETURN affected, length(path) AS distance ORDER BY distance
```

**Cross-service blocking** — the demo's headline path:
```cypher
MATCH (d:Decision)
WHERE toLower(d.title) CONTAINS toLower($topic)
   OR any(t IN d.topics WHERE toLower(t) CONTAINS toLower($topic))
MATCH (t:Ticket)-[:BLOCKED_BY]->(d)
OPTIONAL MATCH (t)-[:RELATES_TO]->(s:Service)
RETURN t, s, d.title AS decision ORDER BY t.key
```

**Expert ranking** (weighted multi-hop, returns its own evidence):
```cypher
MATCH (root:Service) WHERE toLower(root.name) CONTAINS toLower($service)
OPTIONAL MATCH (p:Person)-[k:KNOWS_ABOUT]->(root)
WITH root, collect({person: p, level: k.level, hops: 1}) AS direct
OPTIONAL MATCH (t:Ticket)-[:RELATES_TO]->(root) WHERE t.status <> 'done'
OPTIONAL MATCH (t)-[:ASSIGNED_TO]->(active:Person)
WITH root, direct, collect({person: active, level: 'hands-on', hops: 2}) AS ticketed
OPTIONAL MATCH (root)<-[:OWNS]-(team:Team)
OPTIONAL MATCH (member:Person)-[:MEMBER_OF]->(team)
WITH direct, ticketed, collect({person: member, level: 'owning-team', hops: 2}) AS owners
RETURN direct + ticketed + owners AS candidates
```

**Sourcing an answer** — the discussion that produced a decision:
```cypher
MATCH (d:Decision)-[:DISCUSSED_IN]->(m:Message)   // read as (m)-[:DISCUSSED_IN]->(d)
OPTIONAL MATCH (p:Person)-[:AUTHORED]->(m)
RETURN d.title, p.name, m.channel, m.content
```

### Graph algorithms (all native FalkorDB)

| Algorithm | Procedure | Answers |
|---|---|---|
| PageRank | `CALL algo.pageRank()` | what matters overall |
| **Betweenness** | `CALL algo.betweenness({nodeLabels:['Service']})` | **which service to fix first** |
| Harmonic centrality | `CALL algo.HarmonicCentrality(...)` | what is closest to everything |
| Community detection | `CALL algo.labelPropagation()` | how the org clusters by team |
| Shortest path | `shortestPath()` | how do we get from A to B |
| Dependency impact | reverse `DEPENDS_ON*1..5` | what breaks if X dies |
| Bridge/bottleneck | path counting over `DEPENDS_ON` | services on many chains |

`pagerank` and `bridge_services` have documented fallbacks if a procedure is
absent; the rest degrade to an empty, honest result rather than an invented one.

---

## Agent tools

The agent cannot touch the graph except through these 20 tools. Each returns a
one-line summary **and** the Cypher that produced it — that pairing is what the
reasoning trace renders.

Reads: `find_experts` · `trace_dependencies` · `impact_of_failure` ·
`get_decision_context` · `tickets_blocked_by` · `tickets_for_service` ·
`find_people` · `shortest_path` · `pagerank` · `find_bottlenecks` ·
`central_services` · `team_clusters` · `graph_context` · `run_cypher`
(read-only, writes rejected)

Actions (Track 1 — the agent acts on what the graph shows; every write is a
MERGE keyed on a stable business id, so actions are traceable and re-runnable):
`create_ticket` · `update_ticket` · `record_decision` · `note_knowledge` ·
`remember_fact` (open subject—predicate→object mapping: links existing nodes by
name, creates `Concept` nodes otherwise — this is how the graph maps anything,
not just company records).

The same registry is served over MCP at `POST /api/brain/mcp` (stateless,
JSON responses), so external agents get tool selection through MCP.

---

## Explainability

Every answer carries:

1. **the answer**
2. **the reasoning trace** — tool, arguments, Cypher, rows, duration, error
3. **the contributing subgraph** — nodes and edges that justify it
4. **sources** — clickable chips that highlight nodes in the canvas
5. **agent activity** — what the Researcher wrote, what it handed off

Nothing is asserted that a tool did not return. Negative results are stated
plainly ("no tickets are blocked by that decision") rather than padded.

---

## LLM providers

Three implementations sit behind one `complete()` interface, and `getLlm()`
picks between them:

| Provider | Selected when | Tool calling |
|---|---|---|
| `SarvamLlm` | `SARVAM_API_KEY` set (or `LLM_PROVIDER=sarvam`) | JSON block, parsed back into tool calls |
| `AnthropicLlm` | `ANTHROPIC_API_KEY` set | native tool use |
| `MockLlm` | neither key, or `LLM_FORCE_MOCK=1` | deterministic offline planner |

`LLM_PROVIDER=anthropic|sarvam|mock` overrides key detection outright.

**sarvam-105b has no native function calling.** Asked to call a tool it returns
`tool_calls: None` and writes a JSON blob in a code fence instead. The adapter
parses that blob back into `ToolInvocation`s, so the same agent loop runs
unchanged — which is the point of putting the protocol behind an interface
rather than assuming one provider's shape.

Two Sarvam-specific behaviours are handled explicitly:

- **Tool messages need a `tool_call_id`.** The API rejects a conversation mixing
  tool results with tool definitions, and requires an id on every tool message.
  The model cannot supply one, so the adapter synthesises ids and pairs them
  with results in call order.
- **It intermittently returns an empty message** with `finish_reason=length`.
  That is treated as retryable — a degenerate response, not an answer.

Because answers take 20–90s, the frontend keeps the Send button disabled for the
whole turn and only falls back to the REST endpoint if the **socket actually
fails** — never merely because the answer is slow, which would launch a second
full agent run alongside the first.

Set `SARVAM_API_KEY` and `SARVAM_MODEL` in `.env.local` (see `.env.example`).
The key is git-ignored; `.env` is never committed.

## Running without an API key

`getLlm()` returns `MockLlm` when no key is set. It is **not a
stub**: it loads the graph's own vocabulary (`Service.aliases`, `Decision.topics`),
picks tools with the same tool-calling protocol Claude uses, then composes an
answer strictly from tool output. The whole product — trace, graph context,
multi-agent handoff, memory — is exercised offline, which is why the test suite
runs with no network.

Set `ANTHROPIC_API_KEY` and the identical loop runs against real Claude with
native tool use. Set `LLM_FORCE_MOCK=1` to keep the offline planner against a
real key.

---

## Memory

Omnia remembers without being asked. Every finished turn is scanned for
self-identifying statements ("my name is Jev", "I work at Acme") and they are
stored immediately as `SemanticMemory` — so the *next* conversation already
knows. Existence is checked first: re-stating a fact refreshes it, and a rename
replaces the old value (single-value facts live in slots like `user.name`, so
exactly one wins). Threshold consolidation then compresses sessions into
episodic + semantic memory exactly like the `/brain` path, and `remember_fact`
reports "already known" instead of duplicating an identical edge.

Conversation state is not a side-channel — it is **graph state**.

| Node | Written when | Read by |
|---|---|---|
| `Session` / `Turn` | every question and answer | the transcript endpoint, consolidation |
| `EpisodicMemory` | every 4 new turns, refreshed | recall, Memory panel |
| `SemanticMemory` | same pass, one row per distinct fact | recall |
| `ProceduralMemory` | app startup (idempotent) | task-recipe reference |
| `Finding` / `AgentHandoff` | every Researcher step | Synthesizer, Activity panel |

Three properties this design buys:

- **Recall is auditable.** `recall_memories` is one Cypher query filtered on
  `user_id`, ranked by keyword overlap. Not vector search — so the trace can show
  *which* memory node fired and why.
- **Consolidation recurs.** Gated on turns *since the last consolidation*
  (`Session.consolidated_turns`), not "has this session been consolidated", so a
  40-message conversation remembers all of it.
- **Facts are content-addressed.** `fact_id()` hashes the normalised text, so
  re-learning something MERGEs onto the existing node instead of appending a copy.
  Facts are sourced from tool `Finding`s rather than prose, and recall markers are
  rejected — otherwise recall feeds the answer, the answer feeds the summary, and
  the summary becomes new memory.

Isolation is structural: every memory node carries `user_id` and every read filters
on it, so two users asking the same question cannot see each other's history.
There is a test that asserts exactly that.

### The agent writes its own procedures

The shipped recipes are only a floor. After every turn, the agent turns what
**actually worked** into a reusable recipe and stores it in the graph:

```
"Who knows auth-service?"         → find_experts(service='auth-service')
"Who knows the payments service?" → find_experts(service='$service')   ← learned
"Who knows the ledger service?"   → reuses the recipe
```

Three rules make this a skill rather than a transcript:

- **Only successful runs are learned.** A tool call that errored, or that returned
  zero rows, is not recorded — a failure cannot be mistaken for a skill.
- **Values become slots.** `service='auth-service'` is stored as
  `service='$service'`, so the recipe generalises to services never seen before.
- **Ids are content-addressed.** Learning the same recipe twice updates one node
  and increments `uses` rather than appending a near-duplicate.

Recipes reach the planner as a **hint, not an instruction** — the Researcher may
ignore one. The Memory tab shows the split between *"written by the agent"* and
*"shipped with the project"*, with `used / applied / succeeded` counts.

Each learned recipe also records **why it works** — `rationale`, `applies_when` and
`avoid_when` — so the agent can recognise a novel question that calls for the same
reasoning, and decline one that merely shares vocabulary. Offline this falls back
to the tool-semantics table; with a key, the model writes the explanation.

Fact extraction is LLM-driven when a key is configured, behind a **grounding
guard**: a fact survives only if it appears verbatim in the source, or at least 70%
of its content words do. The model may re-segment and re-word a finding; it may not
invent one. That guard is the reason "the agent summarises" can never quietly
become "the agent makes things up".

---

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/brain/chat` | `{message, session_id, user_id}` → answer + trace + subgraph |
| `POST` | `/api/brain/chat/stream` | SSE: `start` / `tool` / `memory` / `handoff` / `procedures` / `delta` / `procedure_learned` / `done` |
| `GET` | `/api/brain/graph/schema` | legend, colours, live counts |
| `GET` | `/api/brain/graph/subgraph?node_id=&depth=` | neighbourhood for the canvas |
| `GET` | `/api/brain/graph/node/{id}` | citation detail + neighbours |
| `GET` | `/api/brain/graph/query` | read-only Cypher console (writes → 400) |
| `GET` | `/api/brain/graph/search?q=` | type-ahead for citations |
| `GET` | `/api/brain/sessions/{user_id}` | past conversations |
| `GET` | `/api/brain/sessions/{id}/turns` | conversation history |
| `GET` | `/api/brain/sessions/{id}/activity` | agent activity timeline |
| `GET` | `/api/brain/memory/{user_id}` | episodic + semantic + procedural memory |
| `POST` | `/api/brain/memory/{user_id}/consolidate` | force consolidation of a session |
| `GET` | `/api/brain/health` | liveness + FalkorDB reachability |

---

## Testing

```bash
npm run test:brain   # 23 passed (intent + conversational robustness, live graph)
```

| File | Covers |
|---|---|
| `tests/brain/intent.test.ts` | classification, out-of-scope, live-graph capability reply, greetings, no-evidence, single-pass |

Notable regression tests: the agent cannot mutate company data (only its own
memory); one user's memories are invisible to another; a later answer cannot
restate an earlier turn's findings; consolidation recurs as a session grows;
re-learning a fact updates it rather than duplicating it; recalled text is never
stored as a new fact.

---

## Project layout

```
lib/brain/   agent.ts · crew.ts · tools.ts · llm.ts · intent.ts · prompts.ts
             graph.ts · cypher.ts · algorithms.ts · schema.ts · procedures.ts
             config.ts · bootstrap.ts · omnia-memory.ts · types.ts · seed-data.json
             memory/ session.ts · consolidation.ts
app/api/brain/  chat (+stream) · graph/* · sessions/* · memory/* · health
app/brain/     the /brain route
components/brain/  BrainApp · GraphCanvas · Panels
lib/brainApi.ts  typed client (same-origin fetch + SSE)
scripts/brain-seed.ts  dataset loader (idempotent MERGE + verify)
tests/brain/   intent.test.ts (node:test, live graph)
tests/dsh/     memory.test.ts (workspace registry + durable memory)
harness/       vendored DeepSeek Harness checkout (git-ignored; see docs/dsh-harness.md)
lib/dsh/       harness bridge: workspaces, memory, runner, overlay, typed client
app/api/dsh/   workspaces, runs, memory (+MCP), files, commands, status routes
components/workspace/  WorkspaceView (list, execution, files, memory, todos, history)
docs/dsh-harness.md  setup, architecture, memory schema/API, plugins, limitations
phases.md      living phase tracker
```

---

## Data

All data is **synthetic**. "Meridian" is a fictional company; the dataset is
exported verbatim to `lib/brain/seed-data.json`. No private, personal or
restricted data is used anywhere in this project.

---

## Deployment

- **FalkorDB** — any FalkorDB instance (Cloud, or a VM running
  `falkordb/falkordb:latest`). Set `FALKORDB_HOST`, `FALKORDB_PORT`,
  `FALKORDB_GRAPH_NAME`, `FALKORDB_PASSWORD`.
- **App** — any host that runs `next start` after `next build --webpack`.
  Set the FalkorDB vars plus the LLM key (`SARVAM_API_KEY` or
  `ANTHROPIC_API_KEY`). Seed once with `npx tsx scripts/brain-seed.ts`.
`docker-compose.yml` at the root starts FalkorDB locally. No separate backend
process exists: the brain API is Next.js Route Handlers in the same app.

Live deployment URL: _see `phases.md` — deployment is the remaining item in
Phase 10._

---

## Tracks

| Track | Where it shows up |
|---|---|
| **1 — Agents that act on connected data** | 20 tools (reads + graph actions: file/assign/close tickets, record decisions, map open facts); MCP server at `/api/brain/mcp`; native betweenness/harmonic/community detection; every answer ships its traversal |
| **2 — Agent memory and coordination** | `Session`/`Turn`/`Episodic`/`Semantic`/`Procedural` nodes; Researcher→Synthesizer handoff as an `AgentHandoff` node; per-user isolation |
| **3 — Company brain** | People, teams, services, repos, tickets, documents, decisions and chat in one graph, with sourced, clickable answers |

---

## AI assistant disclosure

**AI coding assistants were used in building this project.** OpenCode (with
Claude and a free-tier fallback model) was used throughout — generating the
Python backend, the React components, tests and documentation, and debugging
FalkorDB Cypher dialect differences. All architecture, the graph model, the tool
design and the product decisions were directed by the human author, who can
explain and defend every query and design choice in this README.

FalkorDB does not generate or alter project data; it is the system of record the
product queries.
