# LazyChat Backend (Python)

Agentic backend for LazyChat. Hosts agents, MCP, skills, tools, memory and workspaces.
The Next.js UI (`/` root) talks to this service over HTTP on port 8000.

## Layout

```
src/lazychat/
  api/v1/        # FastAPI routers (HTTP layer, thin)
  agents/        # Agent implementations + base runner
  mcp/           # MCP client/manager
  skills/        # Skill CRUD + prompt builder
  tools/         # Tool base, registry, implementations
  services/      # LLM client, business logic
  models/        # Pydantic schemas
  repositories/  # Data access
  config/        # Settings
  core/          # Logging, errors, middleware
```

## Run

```
cd backend
uv sync
uv run uvicorn lazychat.main:app --reload --port 8000
```

## Test

```
uv run pytest
```