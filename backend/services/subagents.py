from __future__ import annotations

import time
import uuid
from typing import Any

_subagents: dict[str, dict[str, Any]] = {}


def spawn_subagent(conversation_id: str, task: str, name: str | None = None) -> dict[str, Any]:
    sid = f"sub-{uuid.uuid4().hex[:8]}"
    rec = {"id": sid, "task": task, "name": name, "status": "running", "conversationId": conversation_id, "inbox": [], "startedAt": int(time.time()*1000)}
    _subagents[sid] = rec
    return rec


def get_subagent(sid: str) -> dict[str, Any] | None:
    return _subagents.get(sid)


def list_subagents(conversation_id: str | None = None) -> list[dict[str, Any]]:
    if conversation_id:
        return [s for s in _subagents.values() if s["conversationId"] == conversation_id]
    return list(_subagents.values())


def send_to_subagent(sid: str, message: str) -> bool:
    s = _subagents.get(sid)
    if not s:
        return False
    s["inbox"].append(message)
    return True


def interrupt_subagent(sid: str) -> bool:
    s = _subagents.get(sid)
    if not s:
        return False
    s["status"] = "interrupted"
    s["endedAt"] = int(time.time()*1000)
    return True
