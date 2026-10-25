# TS -> Python Migration Map

All agentic logic now lives in `backend/` (Python/FastAPI). The Next.js app (`/`) is UI only.

| TypeScript (legacy) | Python (new) |
|---|---|
| `lib/agent/*` | `backend/src/lazychat/agents/*` |
| `lib/agent/tools/*` | `backend/src/lazychat/tools/*` |
| `lib/mcp.ts` | `backend/src/lazychat/mcp/*` |
| `lib/skills.ts` | `backend/src/lazychat/skills/*` |
| `lib/tools.ts` | `backend/src/lazychat/tools/*` |
| `lib/workspace/*` | `backend/src/lazychat/services/*` + repositories |
| `lib/brain/*` | `backend/src/lazychat/services/brain/*` (TODO) |
| `app/api/agent/*` | `backend/src/lazychat/api/v1/agents.py` |
| `app/api/mcp/*` | `backend/src/lazychat/api/v1/mcp.py` |
| `app/api/skills/*` | `backend/src/lazychat/api/v1/skills.py` |
| `app/api/tools/*` | `backend/src/lazychat/api/v1/tools.py` |
| `app/api/workspace/*` | `backend/src/lazychat/api/v1/workspaces.py` |

## Next.js UI integration

Set `NEXT_PUBLIC_BACKEND_URL=http://localhost:8000` and replace `fetch("/api/...")` calls with
`fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/v1/...`)`.

## Remaining work

- Port `lib/brain/*` (memory graph, crew, algorithms) into `services/brain/`.
- Port `lib/agent/*` submodules (session, storage, compaction, teams, workflow, etc.) into `agents/`.
- Port `lib/workspace/*` into `services/` + `repositories/`.
- Add persistence (SQLAlchemy models) and auth.
- Add SSE streaming endpoint for chat runs.
- Remove legacy TS agentic code once parity reached.