from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
from typing import Any

from core.logging import get_logger
from models.workspace import Workspace, WorkspaceStatus

from .graph import FalkorClient
from .workspace_paths import (
    default_workspace_title,
    realpath_normalize,
    workspace_dir_status,
)

logger = get_logger("workspaces")


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def uid(prefix: str) -> str:
    return f"{prefix}:{uuid.uuid4().hex[:8]}"


def row_to_workspace(r: dict[str, Any]) -> Workspace:
    dir_path = r.get("path") or ""
    status = r.get("status")
    return Workspace(
        id=r.get("id"),
        title=(r.get("title") or r.get("name") or "").strip(),
        path=dir_path,
        description=r.get("description") or "",
        owner=r.get("owner") or "",
        tags=r.get("tags") if isinstance(r.get("tags"), list) else [],
        status=WorkspaceStatus.archived if status == "archived" else WorkspaceStatus.active,
        dir_status=workspace_dir_status(dir_path),
        position=int(r.get("position") or 0),
        created_at=r.get("created_at") or "",
        updated_at=r.get("updated_at") or "",
    )


WORKSPACE_FIELDS = (
    "w.id AS id, w.title AS title, w.name AS name, w.path AS path, "
    "w.description AS description, w.owner AS owner, w.tags AS tags, w.status AS status, "
    "w.position AS position, w.created_at AS created_at, w.updated_at AS updated_at"
)


async def list_workspaces(client: FalkorClient, include_archived: bool = False, owner_id: str | None = None) -> list[Workspace]:
    conds = []
    if not include_archived:
        conds.append("w.status <> 'archived'")
    if owner_id:
        conds.append("w.owner = $owner")
    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    params = {"owner": owner_id} if owner_id else {}
    rows = await client.query(f"MATCH (w:Workspace) {where} RETURN {WORKSPACE_FIELDS} ORDER BY w.position ASC, w.updated_at DESC", params)
    return [row_to_workspace(r) for r in rows]


async def get_workspace(client: FalkorClient, ws_id: str) -> Workspace | None:
    rows = await client.query(f"MATCH (w:Workspace {{id: $id}}) RETURN {WORKSPACE_FIELDS} LIMIT 1", {"id": ws_id})
    return row_to_workspace(rows[0]) if rows else None


async def get_workspace_by_path(client: FalkorClient, dir_path: str) -> Workspace | None:
    try:
        canon = realpath_normalize(dir_path)
    except Exception:  # noqa: BLE001
        canon = os.path.abspath(dir_path)
    rows = await client.query("MATCH (w:Workspace {path: $path}) RETURN w.id AS id LIMIT 1", {"path": canon})
    if not rows:
        return None
    return await get_workspace(client, rows[0]["id"])


REGISTRY_ID = "registry"


async def read_registry_state(client: FalkorClient) -> dict[str, Any]:
    rows = await client.query(
        "MATCH (s:WorkspaceState {id: $id}) RETURN s.initialized AS initialized, s.default_workspace_id AS default_workspace_id, s.pending_operation AS pending_operation, s.pending_workspace_id AS pending_workspace_id",
        {"id": REGISTRY_ID},
    )
    row = rows[0] if rows else {}
    operation = row.get("pending_operation") or ""
    workspace_id = row.get("pending_workspace_id") or ""
    pending = None
    if operation in ("create", "delete") and workspace_id:
        pending = {"operation": operation, "workspace_id": workspace_id}
    dwid = row.get("default_workspace_id")
    return {
        "initialized": row.get("initialized") is True,
        "default_workspace_id": dwid if (isinstance(dwid, str) and dwid) else None,
        "pending": pending,
    }


async def write_registry_state(client: FalkorClient, patch: dict[str, Any]) -> None:
    current = await read_registry_state(client)
    nxt = {**current, **patch}
    pending = nxt.get("pending")
    await client.write(
        "MERGE (s:WorkspaceState {id: $id}) SET s.initialized = $initialized, s.default_workspace_id = $defaultWorkspaceId, s.pending_operation = $pendingOperation, s.pending_workspace_id = $pendingWorkspaceId",
        {
            "id": REGISTRY_ID,
            "initialized": nxt.get("initialized", False),
            "defaultWorkspaceId": nxt.get("default_workspace_id") or "",
            "pendingOperation": (pending or {}).get("operation", ""),
            "pendingWorkspaceId": (pending or {}).get("workspace_id", ""),
        },
    )


async def create_workspace(client: FalkorClient, inp: dict[str, Any]) -> Workspace:
    dir_path = realpath_normalize(inp["path"])
    if not os.path.isdir(dir_path):
        raise ValueError(f"cannot create a workspace at '{dir_path}': path is not a directory")
    existing = await get_workspace_by_path(client, dir_path)
    if existing:
        return existing
    lowest = await client.query("MATCH (w:Workspace) RETURN min(w.position) AS p")
    ts = now_iso()
    ws_id = uid("ws")
    pos = int((lowest[0].get("p") if lowest else None) or 1) - 1
    title = (inp.get("title") or "").strip() or default_workspace_title(dir_path)
    await write_registry_state(client, {"pending": {"operation": "create", "workspace_id": ws_id}})
    await client.write(
        "CREATE (w:Workspace {id: $id, title: $title, path: $path, description: $description, owner: $owner, tags: $tags, status: 'active', position: $position, created_at: $ts, updated_at: $ts})",
        {"id": ws_id, "title": title, "path": dir_path, "description": inp.get("description") or "", "owner": inp.get("owner") or "", "tags": inp.get("tags") or [], "position": pos, "ts": ts},
    )
    created = await get_workspace(client, ws_id)
    if not created:
        await write_registry_state(client, {"pending": None})
        raise RuntimeError("Workspace creation failed.")
    reg = await read_registry_state(client)
    await write_registry_state(client, {"initialized": True, "default_workspace_id": reg.get("default_workspace_id") or ws_id, "pending": None})
    return created


async def update_workspace(client: FalkorClient, ws_id: str, patch: dict[str, Any]) -> Workspace:
    sets = ["w.updated_at = $ts"]
    params: dict[str, Any] = {"id": ws_id, "ts": now_iso()}
    for key, value in patch.items():
        if value is None:
            continue
        if key == "title" and isinstance(value, str) and not value.strip():
            continue
        sets.append(f"w.{key} = ${key}")
        params[key] = value
    await client.write(f"MATCH (w:Workspace {{id: $id}}) SET {', '.join(sets)}", params)
    updated = await get_workspace(client, ws_id)
    if not updated:
        raise ValueError(f"Unknown workspace '{ws_id}'.")
    return updated


async def delete_workspace(client: FalkorClient, ws_id: str) -> bool:
    ws = await get_workspace(client, ws_id)
    if not ws:
        return False
    await write_registry_state(client, {"pending": {"operation": "delete", "workspace_id": ws_id}})
    await client.write("MATCH (w:Workspace {id: $id}) DETACH DELETE w", {"id": ws_id})
    await write_registry_state(client, {"pending": None})
    return True


async def archive_workspace(client: FalkorClient, ws_id: str) -> Workspace:
    return await update_workspace(client, ws_id, {"status": "archived"})


async def move_workspace_before(client: FalkorClient, ws_id: str, before_id: str | None = None) -> list[Workspace]:
    all_ws = await list_workspaces(client, include_archived=True)
    idx = next((i for i, w in enumerate(all_ws) if w.id == ws_id), -1)
    if idx < 0:
        raise ValueError(f"cannot reorder unknown workspace '{ws_id}'")
    without = [w for w in all_ws if w.id != ws_id]
    if before_id is None:
        at = len(without)
    else:
        at = next((i for i, w in enumerate(without) if w.id == before_id), -1)
        if at < 0:
            raise ValueError(f"cannot reorder unknown workspace '{before_id}'")
    moved = all_ws[idx]
    ordered = without[:at] + [moved] + without[at:]
    ts = now_iso()
    for i, w in enumerate(ordered):
        await client.write("MATCH (w:Workspace {id: $id}) SET w.position = $position, w.updated_at = $ts", {"id": w.id, "position": i, "ts": ts})
    return await list_workspaces(client, include_archived=True)


async def record_session(client: FalkorClient, workspace_id: str, session_id: str, goal: str = "") -> dict[str, Any]:
    ts = now_iso()
    await client.write(
        "MERGE (s:AgentSession {id: $sid}) ON CREATE SET s.workspace_id = $wid, s.goal = $goal, s.status = 'running', s.hidden = false, s.started_at = $ts WITH s MATCH (w:Workspace {id: $wid}) MERGE (s)-[:IN_WORKSPACE]->(w)",
        {"sid": session_id, "wid": workspace_id, "goal": goal, "ts": ts},
    )
    rows = await client.query(
        "MATCH (s:AgentSession {id: $sid}) RETURN s.id AS id, s.workspace_id AS workspace_id, s.goal AS goal, s.status AS status, s.hidden AS hidden, s.started_at AS started_at, s.ended_at AS ended_at LIMIT 1",
        {"sid": session_id},
    )
    r = rows[0] if rows else {}
    return {
        "id": r.get("id"),
        "workspace_id": r.get("workspace_id") or "",
        "goal": r.get("goal") or "",
        "status": r.get("status") or "running",
        "hidden": bool(r.get("hidden")),
        "started_at": r.get("started_at") or "",
        "ended_at": r.get("ended_at"),
    }


async def end_session(client: FalkorClient, session_id: str, status: str = "ended") -> None:
    ts = now_iso()
    await client.write("MATCH (s:AgentSession {id: $sid}) SET s.status = $status, s.ended_at = $ts", {"sid": session_id, "status": status, "ts": ts})


async def list_sessions(client: FalkorClient, workspace_id: str, include_hidden: bool = False) -> list[dict[str, Any]]:
    extra = "" if include_hidden else "AND s.hidden = false"
    rows = await client.query(
        f"MATCH (s:AgentSession) WHERE s.workspace_id = $wid {extra} RETURN s.id AS id, s.workspace_id AS workspace_id, s.goal AS goal, s.status AS status, s.hidden AS hidden, s.started_at AS started_at, s.ended_at AS ended_at ORDER BY s.started_at DESC",
        {"wid": workspace_id},
    )
    return [
        {
            "id": r.get("id"),
            "workspace_id": r.get("workspace_id") or "",
            "goal": r.get("goal") or "",
            "status": r.get("status") or "ended",
            "hidden": bool(r.get("hidden")),
            "started_at": r.get("started_at") or "",
            "ended_at": r.get("ended_at"),
        }
        for r in rows
    ]