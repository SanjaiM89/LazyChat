from __future__ import annotations

import asyncio
import os
import time
import uuid
from typing import Any

MAX_OUTPUT = 256 * 1024
_jobs: dict[str, dict[str, Any]] = {}


def start_job(conversation_id: str, title: str, command: str, cwd: str | None = None) -> dict[str, Any]:
    jid = f"job-{uuid.uuid4().hex[:8]}"
    record = {"id": jid, "conversationId": conversation_id, "title": title, "command": command, "cwd": cwd or os.getcwd(), "status": "running", "startedAt": int(time.time()*1000), "output": "", "truncated": False}
    _jobs[jid] = record

    async def _run():
        proc = await asyncio.create_subprocess_shell(command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, cwd=record["cwd"])
        out, _ = await proc.communicate()
        text = out.decode(errors="replace")
        if len(text) > MAX_OUTPUT:
            text = text[-MAX_OUTPUT:]
            record["truncated"] = True
        record["output"] = text
        record["status"] = "done" if proc.returncode == 0 else "failed"
        record["exitCode"] = proc.returncode
        record["endedAt"] = int(time.time()*1000)

    _task = asyncio.ensure_future(_run())
    _ = _task
    return record


def get_job(job_id: str) -> dict[str, Any] | None:
    return _jobs.get(job_id)


def list_jobs(conversation_id: str | None = None) -> list[dict[str, Any]]:
    if conversation_id:
        return [j for j in _jobs.values() if j["conversationId"] == conversation_id]
    return list(_jobs.values())
