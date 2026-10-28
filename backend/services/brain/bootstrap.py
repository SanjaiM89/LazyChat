from __future__ import annotations

import asyncio
import contextlib

from core.logging import get_logger
from services.graph import FalkorClient

from . import schema
from .timeout import ms_from_env, with_timeout

logger = get_logger("brain.bootstrap")

_READY: dict[str, asyncio.Task] = {}


async def ensure_ready() -> None:
    if "task" in _READY:
        task = _READY["task"]
        if not task.done():
            with contextlib.suppress(Exception):
                await task
            return
    async def _bootstrap():
        try:
            client = FalkorClient.get()
            await with_timeout(schema.init_schema(client), ms_from_env("BRAIN_BOOTSTRAP_TIMEOUT_MS", 6000), "brain bootstrap")
        except Exception as e:
            logger.warning("bootstrap failed", error=str(e))
    task = asyncio.ensure_future(_bootstrap())
    _READY["task"] = task
    with contextlib.suppress(Exception):
        await task
