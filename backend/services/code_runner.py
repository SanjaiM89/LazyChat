from __future__ import annotations

import asyncio
from typing import Any


async def run_code(code: str, tools: dict[str, Any] | None = None, timeout: int = 30) -> dict[str, Any]:
    tools = tools or {}
    # Provide tools as globals in the executed code via a restricted namespace
    ns: dict[str, Any] = {"tools": tools}
    try:
        exec(compile(code, "<code>", "exec"), {"__builtins__": __builtins__}, ns)
        result = ns.get("result")
        if asyncio.iscoroutine(result):
            result = await asyncio.wait_for(result, timeout=timeout)
        return {"ok": True, "result": result}
    except Exception as e:
        return {"ok": False, "error": str(e)}
