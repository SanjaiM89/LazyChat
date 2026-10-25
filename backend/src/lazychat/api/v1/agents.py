from __future__ import annotations

from fastapi import APIRouter

from ...agents.default import DefaultAgent
from ...models.chat import AgentRun

router = APIRouter()
_agent = DefaultAgent()


@router.post("/run")
async def run_agent(payload: dict) -> dict:
    run = AgentRun(id=payload.get("id", "run-1"), session_id=payload.get("session_id", "session-1"))
    user_input = payload.get("input", "")
    result = await _agent.run(run, user_input)
    return result.model_dump(mode="json")