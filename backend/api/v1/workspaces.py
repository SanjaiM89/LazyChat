from __future__ import annotations

from fastapi import APIRouter, HTTPException

from services.graph import FalkorClient
from services.workspaces import (
    create_workspace,
    delete_workspace,
    get_workspace,
    list_workspaces,
    update_workspace,
)

router = APIRouter()


def _client() -> FalkorClient:
    return FalkorClient.get()


@router.get("/")
async def list_ws(include_archived: bool = False, owner: str | None = None) -> list[dict]:
    ws = await list_workspaces(_client(), include_archived=include_archived, owner_id=owner)
    return [w.model_dump() for w in ws]


@router.post("/")
async def create_ws(payload: dict) -> dict:
    ws = await create_workspace(_client(), payload)
    return ws.model_dump()


@router.get("/{ws_id}")
async def get_ws(ws_id: str) -> dict:
    ws = await get_workspace(_client(), ws_id)
    if not ws:
        raise HTTPException(status_code=404, detail="workspace not found")
    return ws.model_dump()


@router.patch("/{ws_id}")
async def update_ws(ws_id: str, payload: dict) -> dict:
    ws = await update_workspace(_client(), ws_id, payload)
    return ws.model_dump()


@router.delete("/{ws_id}")
async def delete_ws(ws_id: str) -> dict:
    ok = await delete_workspace(_client(), ws_id)
    return {"deleted": ok}