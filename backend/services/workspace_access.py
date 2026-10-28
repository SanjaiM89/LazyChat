from __future__ import annotations

from typing import Any

from .workspaces import get_workspace


async def owned_workspace(client, ws_id: str, user_uid: str) -> Any:
    ws = await get_workspace(client, ws_id)
    if ws is None:
        return None
    if getattr(ws, "owner", "") != user_uid:
        return None
    return ws
