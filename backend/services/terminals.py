from __future__ import annotations

import asyncio
import contextlib
import os
import time
import uuid
from typing import Any

MAX_TERMINALS = 8
MAX_BUFFER = 64 * 1024
MAX_HISTORY = 50
DEFAULT_TIMEOUT_MS = 120000

_terminals: dict[str, dict[str, Any]] = {}


class Terminal:
    def __init__(self, tid, cwd, proc):
        self.id = tid
        self.cwd = cwd
        self.proc = proc
        self.buffer = ""
        self.history: list[str] = []
        self.pending: asyncio.Future | None = None
        self.created_at = int(time.time() * 1000)
        self.last_used_at = int(time.time() * 1000)
        self.running = True
        self.exit_code = None
        self.last_command = None


async def open_terminal(cwd: str | None = None, shell: str = "bash", extra_env: dict | None = None) -> dict[str, Any]:
    # reap idle
    reap_terminals(30 * 60 * 1000)
    if len(_terminals) >= MAX_TERMINALS:
        oldest = sorted(_terminals.values(), key=lambda t: t.last_used_at)[0] if _terminals else None
        if oldest:
            close_terminal(oldest.id)
    env = dict(os.environ)
    if extra_env:
        env.update(extra_env)
    env.update({"PS1": "", "TERM": "dumb", "OMNIA": "1"})
    proc = await asyncio.create_subprocess_exec(
        shell, "--norc", "--noprofile",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=cwd or os.getcwd(),
        env=env,
    )
    tid = f"term-{uuid.uuid4().hex[:8]}"
    term = Terminal(tid, cwd or os.getcwd(), proc)
    _terminals[tid] = term
    # start reading
    _t = asyncio.ensure_future(_read_loop(term))
    _ = _t
    return _info(term)


async def _read_loop(term: Terminal):
    try:
        while True:
            data = await term.proc.stdout.read(4096)
            if not data:
                break
            text = data.decode(errors="replace")
            term.buffer += text
            if len(term.buffer) > MAX_BUFFER:
                term.buffer = term.buffer[-MAX_BUFFER:]
            term.history.append(text)
            if len(term.history) > MAX_HISTORY:
                term.history.pop(0)
            if term.pending is not None and not term.pending.done() and any(line.strip() == term.pending_marker for line in term.buffer.split("\n")):
                    term.pending.set_result(None)
                    term.pending = None
    except Exception:
        pass
    term.running = False
    if term.pending is not None and not term.pending.done():
        term.pending.set_result(None)
        term.pending = None


def _info(term: Terminal) -> dict[str, Any]:
    return {"id": term.id, "cwd": term.cwd, "createdAt": term.created_at, "lastUsedAt": term.last_used_at, "running": term.running, "exitCode": term.exit_code, "lastCommand": term.last_command}


def get_terminal(tid: str) -> Terminal | None:
    return _terminals.get(tid)


def list_terminals() -> list[dict[str, Any]]:
    return [_info(t) for t in _terminals.values()]


async def run_in_terminal(term_id: str, command: str, timeout_ms: int = DEFAULT_TIMEOUT_MS) -> dict[str, Any]:
    term = _terminals.get(term_id)
    if term is None:
        return {"output": "", "timedOut": False, "running": False}
    if not term.running:
        return {"output": term.buffer, "timedOut": False, "running": False}
    marker = f"__OMNIA_{uuid.uuid4().hex[:10]}__"
    term.buffer = ""
    term.last_command = command
    term.last_used_at = int(time.time() * 1000)
    term.pending_marker = marker
    loop = asyncio.get_event_loop()
    fut = loop.create_future()
    term.pending = fut
    term.proc.stdin.write(f"{command}\n".encode())
    term.proc.stdin.write(f"echo {marker}\n".encode())
    await term.proc.stdin.drain()
    timed_out = False
    try:
        await asyncio.wait_for(fut, timeout=timeout_ms / 1000.0)
    except TimeoutError:
        timed_out = True
        term.pending = None
    output = term.buffer.split(marker)[0] if marker in term.buffer else term.buffer
    return {"output": output.rstrip(), "timedOut": timed_out, "running": term.running}


def send_to_terminal(term_id: str, data: str) -> bool:
    term = _terminals.get(term_id)
    if term is None or not term.running:
        return False
    term.proc.stdin.write(data.encode())
    term.last_used_at = int(time.time() * 1000)
    return True


def read_terminal(term_id: str, since: int = 0) -> dict[str, Any]:
    term = _terminals.get(term_id)
    if term is None:
        return {"output": "", "truncated": False}
    output = term.buffer[since:]
    return {"output": output, "truncated": len(term.buffer) >= MAX_BUFFER}


def signal_terminal(term_id: str, signal: str = "SIGINT") -> bool:
    term = _terminals.get(term_id)
    if term is None or not term.running:
        return False
    try:
        term.proc.send_signal(getattr(__import__("signal"), signal, 2))
        return True
    except (ProcessLookupError, OSError):
        return False


def close_terminal(term_id: str) -> bool:
    term = _terminals.get(term_id)
    if term is None:
        return False
    with contextlib.suppress(ProcessLookupError, OSError):
        term.proc.terminate()
    del _terminals[term_id]
    return True


def reap_terminals(max_age_ms: int = 30 * 60 * 1000) -> int:
    now = int(time.time() * 1000)
    removed = 0
    for tid in list(_terminals.keys()):
        term = _terminals[tid]
        if not term.running or now - term.last_used_at > max_age_ms:
            with contextlib.suppress(ProcessLookupError, OSError):
                term.proc.terminate()
            del _terminals[tid]
            removed += 1
    return removed
