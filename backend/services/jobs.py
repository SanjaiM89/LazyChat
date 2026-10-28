from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

MAX_OUTPUT = 256 * 1024
MAX_JOBS = 100

_jobs: dict[str, dict[str, Any]] = {}
_processes: dict[str, asyncio.subprocess.Process] = {}


def _trim(record: dict[str, Any]) -> None:
    if len(record["output"]) <= MAX_OUTPUT:
        return
    record["output"] = record["output"][-MAX_OUTPUT:]
    record["truncated"] = True


def reap_jobs(max_age_ms: int = 60 * 60 * 1000) -> int:
    now = int(time.time() * 1000)
    removed = 0
    for job in list(_jobs.values()):
        if job["status"] == "running":
            continue
        if now - (job.get("endedAt") or job["startedAt"]) < max_age_ms:
            continue
        del _jobs[job["id"]]
        removed += 1
    if len(_jobs) > MAX_JOBS:
        oldest = sorted(_jobs.values(), key=lambda j: j["startedAt"])[0]
        del _jobs[oldest["id"]]
        removed += 1
    return removed


def start_job(conversation_id: str, title: str, command: str, cwd: str, shell: str | None = None, run_fn: Callable[[], Awaitable[dict]] | None = None) -> dict[str, Any]:
    reap_jobs()
    jid = f"job-{uuid.uuid4().hex[:8]}"
    record = {"id": jid, "conversationId": conversation_id, "title": title or command, "command": command, "cwd": cwd, "status": "running", "startedAt": int(time.time() * 1000), "output": "", "truncated": False}
    _jobs[jid] = record

    if run_fn is not None:
        async def _run_custom():
            try:
                result = await run_fn()
                cur = _jobs.get(jid)
                if not cur:
                    return
                cur["output"] += result.get("output", "") or ""
                _trim(cur)
                cur["status"] = "done" if (result.get("exitCode") in (0, None)) else "failed"
                cur["exitCode"] = result.get("exitCode")
                cur["endedAt"] = int(time.time() * 1000)
            except Exception as e:
                cur = _jobs.get(jid)
                if not cur:
                    return
                cur["output"] += f"\n{e}\n"
                _trim(cur)
                cur["status"] = "failed"
                cur["exitCode"] = 1
                cur["endedAt"] = int(time.time() * 1000)
        _t = asyncio.ensure_future(_run_custom())
        _ = _t
        return record

    async def _run():
        proc = await asyncio.create_subprocess_exec(
            shell or "bash", "--norc", "--noprofile", "-c", command,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            cwd=cwd, env={**os.environ, "TERM": "dumb"},
        )
        _processes[jid] = proc
        async def _read():
            cur = _jobs.get(jid)
            if proc.stdout is None:
                return
            while True:
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    break
                cur = _jobs.get(jid)
                if not cur:
                    break
                cur["output"] += chunk.decode(errors="replace")
                _trim(cur)
        await _read()
        code = await proc.wait()
        _processes.pop(jid, None)
        cur = _jobs.get(jid)
        if not cur:
            return
        if proc.returncode is None:
            cur["status"] = "killed"
        else:
            cur["status"] = "done" if code == 0 else "failed"
        cur["exitCode"] = code
        cur["endedAt"] = int(time.time() * 1000)

    _t2 = asyncio.ensure_future(_run())
    _ = _t2
    return record


def get_job(job_id: str) -> dict[str, Any] | None:
    return _jobs.get(job_id)


def list_jobs(conversation_id: str | None = None) -> list[dict[str, Any]]:
    jobs = [j for j in _jobs.values() if (conversation_id is None or j["conversationId"] == conversation_id)]
    jobs.sort(key=lambda j: j["startedAt"], reverse=True)
    return jobs


def job_output(job_id: str, since: int = 0) -> dict[str, Any] | None:
    job = _jobs.get(job_id)
    if job is None:
        return None
    return {"output": job["output"][since:], "truncated": job["truncated"]}


def kill_job(job_id: str) -> bool:
    proc = _processes.get(job_id)
    job = _jobs.get(job_id)
    if job is None:
        return False
    if proc is not None:
        import contextlib
        with contextlib.suppress(ProcessLookupError, OSError):
            proc.terminate()
        _processes.pop(job_id, None)
    job["status"] = "killed"
    job["endedAt"] = int(time.time() * 1000)
    return True


def running_job_count() -> int:
    return len(_processes)
