from __future__ import annotations

import asyncio

from core.logging import get_logger
from . import schema
from services.graph import FalkorClient
from .timeout import ms_from_env, with_timeout

logger = get_logger("brain.bootstrap")

_READY: dict[str, asyncio.Task] = {}


async def ensure_ready() -> None:
    if "task" in _READY:
        task = _READY["task"]
        if not task.done():
            try:
                await task
            except Exception:  # noqa: BLE001, S110
                pass
            return
    async def _bootstrap():
        try:
            client = FalkorClient.get()
            await with_timeout(schema.init_schema(client), ms_from_env("BRAIN_BOOTSTRAP_TIMEOUT_MS", 6000), "brain bootstrap")
        except Exception as e:  # noqa: BLE001
            logger.warning("bootstrap failed", error=str(e))
    task = asyncio.ensure_future(_bootstrap())
    _READY["task"] = task
    try:
        await task
    except Exception:  # noqa: BLE001, S110
        pass
