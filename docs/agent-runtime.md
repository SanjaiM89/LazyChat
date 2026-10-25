# Omnia's agent runtime

Omnia used to drive the DeepSeek Harness: a `dsh --profile headless` subprocess
per run, a cordis patch overlay that mounted our MCP servers into it, and a
`/api/dsh/runs` API to poll it. That is gone. Everything the harness offered is
now native to Omnia — its tools, its session model, its permission model — so
the desktop app carries no harness runtime and no DeepSeek code.

## The shape

```
Omnia shell (Chat | Brain tabs)
  Sidebar [+] → New chat | New workspace → AttachWorkspaceDialog
  ChatHeader workspace chip → RightPanel "files" tab (FileExplorer)
  use-chat send() threads workspaceId + permissions → POST /api/chat
  pump(): memory briefing prepended to system + ws_* tools merged in
         every tool call checked against the session's permissions
         every turn, step and tool outcome appended to the session log
```

```
lib/agent/            the runtime
  catalog.ts          every tool: family, title, variant, effect  (shared with the UI)
  events.ts           the event vocabulary
  session.ts          the append-only session log (SQLite + FTS)
  permissions.ts      sandbox modes, approval policy, presets
  guard.ts            enforcement: allow / ask / deny, before a tool runs
  result-guard.ts     the same for what a tool returns: spill, then prune
  compaction.ts       pressure, retention, overflow recovery, image offload
  spill.ts            oversized results, written to a file
  plugins.ts          the plugin and bundle registry
  terminals.ts        shells that stay alive
  code-runner.ts      a program that calls the tools
  workflow.ts         a script that fans work out across agents
  teams.ts            named teammates and the task board
  subagents.ts        second agents, with an inbox
  jobs.ts             background work that outlives the turn
  lsp.ts              a language-server client
  recovery.ts         picking up a run that died
  fetch.ts            fetching a page (public addresses only)
  tools/              one file per family

lib/workspace/        folder-bound work (was lib/dsh/)
  access.ts           path confinement + ownership
  memory.ts           shared and workspace memory on FalkorDB
  tools.ts            the ws_* tools
  workspaces.ts       the workspace registry
  client.ts           the browser client

app/api/workspace/    workspaces, memory, browse
app/api/agent/        plugins, sessions (+ their trace), schedules
components/agent/     PluginPanel · SessionBrowser · PermissionChip
```

## The session log

`lib/agent/session.ts` appends one row per durable fact: a turn, a step, a tool
call, a tool result, an approval, a compaction. Nothing is ever updated, so the
log is also the crash-recovery record — a run that dies mid-turn leaves every
committed step behind. `session_events_fts` mirrors it for full-text search,
which is what `session_search` and the session browser read.

## The tool families

| Family | Tools |
|---|---|
| Workspace | `ws_list/read/write/glob/grep/read_image/str_replace_editor/shell/todo/remember` |
| Shell | `shell_bash` (a shell that stays alive), `working_directory`, `terminal_open/send/read/signal/close/list` |
| Programs | `code_run` — a TypeScript program that calls the tools, in its own process |
| Workflows | `workflow` — a JavaScript program that fans work out across agents; `ralph` — one fresh agent per round |
| Teams | `team_spawn_teammate`, `team_send_message`, `team_list_agents`, `team_wait_agent`, `team_interrupt_agent`, `team_task_create/list/get/update` |
| Subagents | `subagent`, `subagent_list`, `subagent_send_message`, `subagent_interrupt`, `subagent_list_models` |
| Jobs | `job_start`, `job_output`, `job_list`, `job_kill` — work that outlives the turn |
| Web | `webSearch`, `web_fetch` (public addresses only) |
| Browser | `computer_*` (the act primitives) plus `browser_observe`, `browser_extract`, `browser_tabs` |
| Code | `lsp` (definition, references, implementation, hover), `lsp_servers` (configure one) |
| History | `session_search`, `session_event_read`, `session_event_search`, `session_trace` |
| Skills | `skill` — load a skill's instructions |
| Context | `spill_read` — read back a result that was too large to keep |
| Registry | `inspect_list`, `inspect_query`, `plugin_list`, `plugin_set`, `plugin_bundle_set`, `plugin_exemption_list`, `plugin_exemption_set` |
| MCP | `mcp_list_resources`, `mcp_list_resource_templates`, `mcp_read_resource` |
| Deliverables | `present` — declare what was delivered |

A subagent is a second agent: it runs in this process with the same tools,
minus the ones that would let it spawn another one. It has an inbox, so a
message sent while it works is delivered when it next starts a turn.

A teammate is a named subagent. The board it works from is durable and every
change bumps a revision, so two agents cannot silently overwrite each other.

## Context depth

Three layers keep a turn inside the model's window:

1. **Pruning** — a tool result over 8192 characters is cut to 4096 of head and
   1024 of tail before the model sees it.
2. **Spilling** — a result over 20 000 characters is written to
   `DATA_DIR/spill/` and the model gets a preview plus the locator;
   `spill_read` fetches the rest back.
3. **Compaction** — at 80% of the context window the older part is summarized
   and the newest 30% is kept verbatim, cut at a user-message boundary. A
   provider that refuses the request over its context or its image budget
   triggers the same recovery and the turn is tried again.

## Permissions

Three sandbox modes and an approval policy, decided against the catalog's
`effect`:

| mode | reads | writes | commands / agents |
|---|---|---|---|
| `read-only` | allowed | denied | denied |
| `workspace-write` | allowed | allowed | asked for |
| `danger-full-access` | allowed | allowed | allowed |

`lib/agent/guard.ts` wraps the tool set before the model sees it. A call that
needs a decision pauses the turn and asks through the same mechanism the
model's own questions use, so the answer arrives through the existing UI. The
user can allow a call once or for the rest of the session.

The header chip shows the mode and changes it; the choice travels with every
run.

## Plugins

A plugin is a named group of tools the user can switch on and off; a bundle
is a group of plugins. The registry filters the tool set of the next turn.
The Plugins panel in the right column edits it.

## Internal endpoints

`/api/workspace/memory/mcp` and `/api/brain/mcp` speak MCP to outside clients.
They require the internal token: `OMNIA_INTERNAL_TOKEN` from the environment, or
a generated one in `DATA_DIR/internal-token`. The packaged server binds
`127.0.0.1` only.
