# DeepSeek Harness workspace environment

Omnia's chat UI keeps its components untouched. Workspace capability is
integrated *into chat itself*: the sidebar + button opens a **New chat / New
workspace** menu; New workspace opens an attach dialog (existing workspaces,
or create by browsing server folders under the home directory / typing a
path); the fresh chat is bound to that folder. The header shows a workspace
chip (click = files panel, × = detach), and the right panel gains a Files tab.

```
Omnia shell (Chat | Brain tabs — ChatView/Composer byte-identical)
  Sidebar [+] → New chat | New workspace → AttachWorkspaceDialog
  ChatHeader workspace chip → RightPanel "files" tab (FileExplorer)
  use-chat send() threads workspaceId → POST /api/chat → createChatRun
  pump(): memory briefing prepended to system + ws_* tools merged in

Native tools (lib/dsh/workspace-tools.ts) — the harness capability set
ported into our own loop, no subprocess:
  ws_list / ws_read / ws_write / ws_shell (cwd=root, 120s cap, truncated,
  remembered) / ws_todo / ws_remember — all confined to the workspace root
  (traversal, absolute escapes and symlink-out rejected; tested).
```

## Setup / run

```bash
# 1. FalkorDB + app (as usual)
docker compose up -d
npx tsx scripts/brain-seed.ts --reset   # once
npm run dev -- --webpack                # http://localhost:3000

# 2. Vendored harness (one time; git-ignored, ~200MB source + pnpm store)
git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git harness/deepseek-harness
cd harness/deepseek-harness && pnpm install && pnpm run build && cd ../..
```

Open the **Workspace** tab in the sidebar (or `/?view=workspace`). Create a
workspace pointing at a real project directory, type a task, hit **Run agent**.

Agent runs need an LLM: the bridge overlay (`data/dsh/lazychat-bridge.cordis.yml`,
auto-generated) points harness at Sarvam via `SARVAM_API_KEY` in `.env.local`
(same key Omnia uses). `GET /api/dsh/status` reports whether `dsh` is built.

## Architecture

```
Omnia shell (Chat | Brain tabs — chat components untouched)
  ├─ conversation ↔ workspace binding (persisted per conversation id)
  ├─ ws_* tools + memory briefing injected per run (chat-runs pump)
  └─ components/workspace/: AttachWorkspaceDialog, FileExplorer
  └─ dsh headless fallback: POST /api/dsh/runs spawns the vendored binary
       with cwd + overlay (proven: adopted session, file created, exit 0)
FalkorDB (same instance as Company Brain)
  ├─ (:Workspace)-[:IN_WORKSPACE]-records (plans, decisions, diffs, commands,
  │   errors, deps, todos, prefs, links, summaries) + (:AgentSession)
  └─ (:SharedMemory scope='global' | 'workspace:<id>')
dsh agents ↔ LazyChat over MCP (Streamable HTTP, stateless):
  ├─ /api/brain/mcp          company-brain.* (graph reads + actions)
  └─ /api/dsh/memory/mcp     lazychat_memory.* (recall/store/todos/records)
```

Memory injection is two-fold: the runner prefixes every task with
`buildMemoryContext()` (shared global + workspace briefing — visible in the UI
under the task box), and agents can call the memory MCP tools mid-run.

Native dsh plugin (`agent.inject` on `agent/pre-step`, à la
dsh-workspace-memories) is the documented follow-up; the prompt-prefix + MCP
route satisfies automatic injection for now with zero harness patching.

## Memory schema

| Node | Key fields |
|---|---|
| `Workspace` | id, name, path (canonical), description, owner, tags[], status, position, created/updated |
| `AgentSession` | id (= dsh session id), workspace_id, goal, status, hidden |
| `WorkspacePlan/Decision/CodeChange/CommandRun/ErrorFix/Dependency/Todo/WsPreference/WsLink/SessionSummary` | workspace_id + kind fields, -[:IN_WORKSPACE]-> Workspace |
| `SharedMemory` | scope `global`\|`workspace:<id>`, kind, text, slot?, tags[], use_count |

Rules: secrets redacted pre-write; identical content dedups (`use_count++`);
same-slot conflict → newest wins, old kept via `-[:REPLACED_BY]->`; recall is
lexical keyword overlap, global outranks workspace on ties.

APIs: `GET/POST /api/dsh/workspaces`, `GET/PATCH /api/dsh/workspaces/[id]`,
`[id]/files`, `[id]/commands`, `POST /api/dsh/runs`, `GET/DELETE
/api/dsh/runs/[id]`, `GET/POST /api/dsh/memory`, `PATCH/DELETE
/api/dsh/memory/[id]`, `GET /api/dsh/status`.

## Plugin / config list

Vendored harness is stock; our only harness-side surface is the generated
overlay `data/dsh/lazychat-bridge.cordis.yml`: `agent-default-model`
(sarvam/sarvam-105b), `llm-pi-ai` sarvam route (OpenAI-completions,
`SARVAM_API_KEY`), two `dsh-mcp-client` rows (memory + brain, streamable-http).

## Migration notes

- `harness/` is git-ignored by design (third-party checkout); the branch holds
  the bridge (`lib/dsh/*`, `app/api/dsh/*`, `components/workspace/*`) plus
  toolchain guards (tsconfig/next.config). Re-clone per machine.
- Test suites run sequentially in `npm run test:brain` — parallel files share
  one live graph and flake on count assertions.
- Test + probe data to clean: `Workspace` nodes you create via UI, `dsh-*`
  sessions, `SharedMemory` rows you store. Company seed is restored with
  `npx tsx scripts/brain-seed.ts` (idempotent MERGE + verify).

## Examples

```bash
# headless run exactly as the bridge spawns it
dsh --profile headless --patch data/dsh/lazychat-bridge.cordis.yml \
  --session-id session-demo1 --json "list the files here"

# workspace CRUD
curl -X POST localhost:3000/api/dsh/workspaces \
  -H 'Content-Type: application/json' -d '{"name":"Demo","path":"/tmp/demo"}'
```

## Validation checklist

- [ ] Chat tab works exactly as before (streaming, history, input, artifacts).
- [ ] Workspace tab: create → list → switch workspaces; validation rejects bad paths.
- [ ] Run agent: task executes with workspace as cwd; tool timeline + output stream; Stop works.
- [ ] Workspace memory saved (plans/decisions/errors/todos/commands) and visible in tabs; survives dev-server restart.
- [ ] Shared memory: store global + workspace scopes; recall in every workspace; view/edit/delete in Memory tab; secrets redacted.
- [ ] `npm run test:brain` green; `next build --webpack` green.

## Known limitations

- `dsh --profile headless --session-id` **adopts** a persisted session and
  refuses unknown ids — fresh runs must omit the flag and adopt the id from
  the opening `session` JSONL event (the bridge does this automatically).
- No PTY terminal: the execution panel shows streamed stdout + command history,
  not an interactive shell (use `dsh web` on :3080 or the Docker sandbox for that).
- Recall is lexical, not vector — same tradeoff as the Company Brain memory.
- Runs inherit the server's env; `SARVAM_API_KEY` must be in `.env.local`.
- Single local instance: no multi-user isolation beyond per-user memory keys.
- `dsh web` (full harness UI on :3080) runs side-by-side, not embedded.
