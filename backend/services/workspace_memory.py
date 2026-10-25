from __future__ import annotations

import hashlib
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from core.logging import get_logger

from .graph import FalkorClient

logger = get_logger("workspace_memory")


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def uid(prefix: str) -> str:
    return f"{prefix}:{uuid.uuid4().hex[:8]}{int(datetime.now().timestamp()) % 10000}"


def redact_secrets(text: str) -> str:
    patterns = [
        (re.compile(r"sk-[A-Za-z0-9]{20,}"), "sk-***"),
        (re.compile(r"ghp_[A-Za-z0-9]{20,}"), "ghp_***"),
        (re.compile(r"AKIA[0-9A-Z]{16}"), "AKIA***"),
    ]
    for pat, repl in patterns:
        text = pat.sub(repl, text)
    return text


def content_id(scope: str, kind: str, text: str) -> str:
    h = hashlib.sha256(f"{scope}|{kind}|{text}".encode()).hexdigest()[:16]
    return f"mem:{h}"


def row_to_memory(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r.get("id"),
        "scope": r.get("scope") or "global",
        "kind": r.get("kind") or "note",
        "text": r.get("text") or "",
        "slot": r.get("slot"),
        "tags": r.get("tags") if isinstance(r.get("tags"), list) else [],
        "use_count": int(r.get("use_count") or 0),
        "created_at": r.get("created_at") or "",
        "updated_at": r.get("updated_at") or "",
    }


async def store_shared(client: FalkorClient, scope: str, kind: str, text: str, slot: str | None = None, tags: list[str] | None = None) -> dict[str, Any]:
    text = redact_secrets(text).strip()[:4000]
    if not text:
        raise ValueError("Cannot store empty memory.")
    kind = (kind or "note").strip().lower()[:40] or "note"
    slot = (slot or "").strip() or None
    tags = [(t or "").strip().lower() for t in (tags or [])]
    tags = [t for t in tags if t][:12]
    ts = now_iso()
    mid = content_id(scope, kind, text)
    dupe = await client.query("MATCH (m:SharedMemory {id: $id}) RETURN m.id AS id LIMIT 1", {"id": mid})
    if dupe:
        await client.write("MATCH (m:SharedMemory {id: $id}) SET m.use_count = coalesce(m.use_count, 0) + 1, m.updated_at = $ts", {"id": mid, "ts": ts})
        rows = await client.query(
            "MATCH (m:SharedMemory {id: $id}) RETURN m.id AS id, m.scope AS scope, m.kind AS kind, m.text AS text, m.slot AS slot, m.tags AS tags, m.use_count AS use_count, m.created_at AS created_at, m.updated_at AS updated_at LIMIT 1",
            {"id": mid},
        )
        return row_to_memory(rows[0]) if rows else {}
    if slot:
        conflicts = await client.query("MATCH (m:SharedMemory) WHERE m.scope = $scope AND m.slot = $slot AND m.id <> $id RETURN m.id AS id", {"scope": scope, "slot": slot, "id": mid})
        await client.write(
            "MERGE (m:SharedMemory {id: $id}) SET m.scope = $scope, m.kind = $kind, m.text = $text, m.slot = $slot, m.tags = $tags, m.use_count = 0, m.created_at = $ts, m.updated_at = $ts",
            {"id": mid, "scope": scope, "kind": kind, "text": text, "slot": slot, "tags": tags, "ts": ts},
        )
        for c in conflicts:
            await client.write("MATCH (old:SharedMemory {id: $old}), (new:SharedMemory {id: $new}) MERGE (old)-[:REPLACED_BY]->(new)", {"old": c["id"], "new": mid})
    else:
        await client.write(
            "MERGE (m:SharedMemory {id: $id}) SET m.scope = $scope, m.kind = $kind, m.text = $text, m.slot = $slot, m.tags = $tags, m.use_count = 0, m.created_at = $ts, m.updated_at = $ts",
            {"id": mid, "scope": scope, "kind": kind, "text": text, "slot": slot, "tags": tags, "ts": ts},
        )
    rows = await client.query(
        "MATCH (m:SharedMemory {id: $id}) RETURN m.id AS id, m.scope AS scope, m.kind AS kind, m.text AS text, m.slot AS slot, m.tags AS tags, m.use_count AS use_count, m.created_at AS created_at, m.updated_at AS updated_at LIMIT 1",
        {"id": mid},
    )
    return row_to_memory(rows[0]) if rows else {}


async def recall_shared(client: FalkorClient, workspace_id: str, query: str = "", limit: int = 12) -> list[dict[str, Any]]:
    import os as _os
    user = _os.getenv("LAZYCHAT_USER", "")
    global_scope = f"global:{user}" if user else "global"
    scopes = [global_scope, f"workspace:{workspace_id}"]
    rows = await client.query(
        "MATCH (m:SharedMemory) WHERE m.scope IN $scopes RETURN m.id AS id, m.scope AS scope, m.kind AS kind, m.text AS text, m.slot AS slot, m.tags AS tags, m.use_count AS use_count, m.created_at AS created_at, m.updated_at AS updated_at ORDER BY m.updated_at DESC LIMIT 200",
        {"scopes": scopes},
    )
    terms = {w for w in __import__("re").split(r"\s+", query.lower()) if len(w) > 3}
    scored = []
    for r in rows:
        mem = row_to_memory(r)
        hay = f"{mem['text']} {' '.join(mem['tags'])} {mem['kind']}".lower()
        overlap = sum(1 for t in terms if t in hay)
        score = overlap + (0.1 if str(mem["scope"]).startswith("global") else 0)
        scored.append({"mem": mem, "score": score})
    scored.sort(key=lambda x: x["score"], reverse=True)
    relevant = [s for s in scored if s["score"] > 0.1]
    picked = (relevant if relevant else scored)[:limit]
    picked_mems = [p["mem"] for p in picked]
    if picked_mems:
        await client.write("MATCH (m:SharedMemory) WHERE m.id IN $ids SET m.use_count = coalesce(m.use_count, 0) + 1", {"ids": [m["id"] for m in picked_mems]})
    return picked_mems


async def update_shared(client: FalkorClient, mem_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    sets = ["m.updated_at = $ts"]
    params: dict[str, Any] = {"id": mem_id, "ts": now_iso()}
    if patch.get("text") is not None:
        sets.append("m.text = $text")
        params["text"] = redact_secrets(patch["text"]).strip()[:4000]
    if patch.get("tags") is not None:
        sets.append("m.tags = $tags")
        params["tags"] = [t.strip().lower() for t in patch["tags"] if t.strip()][:12]
    await client.write(f"MATCH (m:SharedMemory {{id: $id}}) SET {', '.join(sets)}", params)
    rows = await client.query(
        "MATCH (m:SharedMemory {id: $id}) RETURN m.id AS id, m.scope AS scope, m.kind AS kind, m.text AS text, m.slot AS slot, m.tags AS tags, m.use_count AS use_count, m.created_at AS created_at, m.updated_at AS updated_at LIMIT 1",
        {"id": mem_id},
    )
    return row_to_memory(rows[0]) if rows else None


async def delete_shared(client: FalkorClient, mem_id: str) -> bool:
    rows = await client.query("MATCH (m:SharedMemory {id: $id}) DETACH DELETE m RETURN 1 AS n", {"id": mem_id})
    return len(rows) > 0