from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from services.brain.agent import ask_agent

router = APIRouter()


@router.post("/run")
async def run_chat(payload: dict[str, Any]) -> dict[str, Any]:
    question = payload.get("question") or payload.get("input") or ""
    result = await ask_agent(question, {"sessionId": payload.get("session_id"), "userId": payload.get("user_id", "demo"), "llm": None})
    return result


@router.post("/stream")
async def stream_chat(payload: dict[str, Any]):
    question = payload.get("question") or payload.get("input") or ""

    async def gen():
        try:
            result = await ask_agent(question, {"sessionId": payload.get("session_id"), "userId": payload.get("user_id", "demo"), "llm": None})
            yield f"event: result\ndata: {json.dumps(result, default=str)}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")
