from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable
from typing import Any, TypeVar

T = TypeVar("T")


def ms_from_env(name: str, fallback: int) -> int:
    try:
        raw = float(os.getenv(name, ""))
    except (TypeError, ValueError):
        return fallback
    if not (raw > 0):
        return fallback
    return int(raw)


async def with_timeout(work: Awaitable[Any], ms: int, label: str):
    task = asyncio.ensure_future(work) if not isinstance(work, asyncio.Task) else work
    try:
        return await asyncio.wait_for(task, timeout=ms / 1000.0)
    except TimeoutError:
        task.cancel()
        raise TimeoutError(f"{label} timed out after {ms}ms")
    finally:
        if not task.done():
            task.cancel()


async def with_budget(work: Awaitable[Any], ms: int, fallback: Any):
    try:
        return await with_timeout(work, ms, "operation")
    except Exception:  # noqa: BLE001
        return fallback
