from __future__ import annotations

import asyncio
import os
import time
import uuid
from typing import Any

MAX_TERMINALS = 8
DEFAULT_TIMEOUT_MS = 120000

_terminals: dict[str, dict[str, Any]] = {}


async def create_terminal(cwd: str | None = None) -> dict[str, Any]:
    tid = f"term-{uuid.uuid4().hex[:8]}"
    info = {"id": tid, "cwd": cwd or os.getcwd(), "createdAt": int(time.time()*1000), "lastUsedAt": int(time.time()*1000), "running": False, "history": []}
    _terminals[tid] = info
    return info


async def run_in_terminal(term_id: str, command: str, timeout_ms: int = DEFAULT_TIMEOUT_MS) -> dict[str, Any]:
    term = _terminals.get(term_id)
    if not term:
        return {"error": f"unknown terminal {term_id}"}
    proc = await asyncio.create_subprocess_shell(command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=term["cwd"])
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_ms/1000.0)
    except TimeoutError:
        proc.kill()
        return {"id": term_id, "status": "timeout", "output": ""}
    term["lastUsedAt"] = int(time.time()*1000)
    term["lastCommand"] = command
    return {"id": term_id, "status": "done", "exitCode": proc.returncode, "stdout": stdout.decode(errors="replace"), "stderr": stderr.decode(errors="replace")}


def list_terminals() -> list[dict[str, Any]]:
    return list(_terminals.values())


def close_terminal(term_id: str) -> bool:
    return _terminals.pop(term_id, None) is not None
