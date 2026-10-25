# TS -> Python Migration Map

All agentic logic now lives in `backend/` (Python/FastAPI). The Next.js app (`/`) is UI only.

| TypeScript (legacy) | Python (new) |
|---|---|
| `lib/agent/*` | `backend/agents/*` |
| `lib/agent/tools/*` | `backend/tools/*` |
| `lib/mcp.ts` | `backend/mcp/*` |
| `lib/skills.ts` | `backend/skills/*` |
| `lib/tools.ts` | `backend/tools/*` |
| `lib/workspace/*` | `backend/services/*` + repositories |
| `lib/brain/*` | `backend/services/brain/*` (TODO) |
| `app/api/agent/*` | `backend/api/v1/agents.py` |
| `app/api/mcp/*` | `backend/api/v1/mcp.py` |
| `app/api/skills/*` | `backend/api/v1/skills.py` |
| `app/api/tools/*` | `backend/api/v1/tools.py` |
| `app/api/workspace/*` | `backend/api/v1/workspaces.py` |

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