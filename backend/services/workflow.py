from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any


async def run_workflow_script(script: str, args: Any, agent_hook: Callable, note_hook: Callable, timeout_ms: int = 120000) -> dict[str, Any]:
    phases: list[str] = []
    logs: list[str] = []
    calls: list[dict[str, Any]] = []

    async def agent(prompt, options=None):
        options = options or {}
        calls.append({"prompt": str(prompt), "label": (options or {}).get("label"), "phase": (options or {}).get("phase")})
        return await agent_hook(str(prompt), options or {})

    async def pipeline(items, *stages):
        if not isinstance(items, list):
            raise TypeError("pipeline() needs an array of items.")
        async def run_item(item, index):
            prev = item
            for stage in stages:
                if not callable(stage):
                    raise TypeError("pipeline() stages must be functions.")
                try:
                    prev = await stage(prev, item, index) if asyncio.iscoroutinefunction(stage) else stage(prev, item, index)
                except Exception:  # noqa: BLE001
                    return None
            return prev
        return await asyncio.gather(*[run_item(it, i) for i, it in enumerate(items)])

    async def parallel(thunks):
        if not isinstance(thunks, list):
            raise TypeError("parallel() needs an array of functions.")
        async def run_one(thunk):
            if not callable(thunk):
                raise TypeError("parallel() takes functions.")
            try:
                r = thunk()
                if asyncio.iscoroutine(r):
                    r = await r
                return r
            except Exception:  # noqa: BLE001
                return None
        return await asyncio.gather(*[run_one(t) for t in thunks])

    def phase(title):
        phases.append(str(title))
        note_hook("phase", str(title))

    def log(msg):
        logs.append(str(msg))
        note_hook("log", str(msg))

    namespace = {
        "agent": agent,
        "pipeline": pipeline,
        "parallel": parallel,
        "phase": phase,
        "log": log,
        "args": args,
    }

    try:
        code = compile(script, "workflow.py", "exec")
        exec(code, {"__builtins__": {}}, namespace)  # noqa: S102
        # If script defines a coroutine result, await it
        result = namespace.get("result", None)
        if asyncio.iscoroutine(result):
            result = await asyncio.wait_for(result, timeout=timeout_ms / 1000.0)
        return {"ok": True, "value": result, "phases": phases, "logs": logs, "calls": calls}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e), "phases": phases, "logs": logs, "calls": calls}
