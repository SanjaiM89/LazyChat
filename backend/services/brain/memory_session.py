from __future__ import annotations

import random
from datetime import UTC, datetime
from typing import Any

from ..core.logging import get_logger
from .graph import FalkorClient

logger = get_logger("brain.memory.session")


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _uid(hex_len: int) -> str:
    return "".join(random.choice("0123456789abcdef") for _ in range(hex_len))


def new_session_id(user_id: str = "demo") -> str:
    return f"session:{user_id}:{_uid(10)}"


async def start_session(client: FalkorClient, user_id: str, session_id: str | None = None) -> dict[str, Any]:
    sid = session_id or new_session_id(user_id)
    ts = now_iso()
    await client.write(
        "MERGE (s:Session {id: $sid}) ON CREATE SET s.user_id = $uid, s.started_at = $ts, s.turn_count = 0 SET s.last_active_at = $ts",
        {"sid": sid, "uid": user_id, "ts": ts},
    )
    return {"session_id": sid, "user_id": user_id, "started_at": ts}


async def ensure_session(client: FalkorClient, user_id: str, session_id: str | None = None) -> str:
    if session_id:
        rows = await client.query("MATCH (s:Session {id: $sid}) RETURN s.id AS id", {"sid": session_id})
        if rows:
            return session_id
    return (await start_session(client, user_id, session_id))["session_id"]


async def list_sessions(client: FalkorClient, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    rows = await client.query(
        "MATCH (s:Session) WHERE s.user_id = $uid OPTIONAL MATCH (s)-[:CONTAINS]->(t:Turn) "
        "RETURN s.id AS session_id, s.started_at AS started_at, s.last_active_at AS last_active, "
        "count(t) AS turn_count, head([x IN collect(t.content) WHERE x IS NOT NULL AND x <> '']) AS preview "
        "ORDER BY coalesce(s.last_active_at, s.started_at) DESC LIMIT $limit",
        {"uid": user_id, "limit": limit},
    )
    out = []
    for r in rows:
        preview = r.get("preview")
        if isinstance(preview, str) and len(preview) > 120:
            preview = preview[:120] + "..."
        out.append({
            "session_id": r.get("session_id"),
            "started_at": r.get("started_at"),
            "last_active_at": r.get("last_active"),
            "turn_count": int(r.get("turn_count") or 0),
            "preview": preview,
        })
    return out


async def record_turn(client: FalkorClient, session_id: str, role: str, content: str, agent: str | None = None) -> dict[str, Any]:
    turn_id = f"turn:{_uid(12)}"
    ts = now_iso()
    await client.write(
        "MATCH (s:Session {id: $sid}) CREATE (t:Turn {id: $tid, role: $role, content: $content, timestamp: $ts, agent: $agent}) "
        "MERGE (s)-[:CONTAINS]->(t) SET s.turn_count = coalesce(s.turn_count, 0) + 1, s.last_active_at = $ts",
        {"sid": session_id, "tid": turn_id, "role": role, "content": content, "ts": ts, "agent": agent},
    )
    return {"turn_id": turn_id, "role": role, "content": content, "timestamp": ts}


async def get_turns(client: FalkorClient, session_id: str, limit: int = 200) -> list[dict[str, Any]]:
    rows = await client.query(
        "MATCH (s:Session {id: $sid})-[:CONTAINS]->(t:Turn) "
        "RETURN t.id AS id, t.role AS role, t.content AS content, t.timestamp AS timestamp, t.agent AS agent "
        "ORDER BY t.timestamp ASC LIMIT $limit",
        {"sid": session_id, "limit": limit},
    )
    return [
        {"id": r.get("id"), "role": r.get("role"), "content": r.get("content"), "timestamp": r.get("timestamp"), "agent": r.get("agent")}
        for r in rows
    ]


async def turn_count(client: FalkorClient, session_id: str) -> int:
    rows = await client.query("MATCH (s:Session {id: $sid})-[:CONTAINS]->(t:Turn) RETURN count(t) AS c", {"sid": session_id})
    return int(rows[0].get("c") or 0) if rows else 0


RECALL_CYPHER = """
MATCH (n)
WHERE (n:EpisodicMemory OR n:SemanticMemory) AND n.user_id = $uid
RETURN n.id AS id,
       coalesce(n.summary, n.fact) AS text,
       n.timestamp AS ts,
       CASE WHEN n:EpisodicMemory THEN 'episodic' ELSE 'semantic' END AS kind,
       coalesce(n.about, []) AS about
ORDER BY ts DESC LIMIT 50
"""


async def recall_memories(client: FalkorClient, user_id: str, question: str = "", limit: int = 6) -> list[dict[str, Any]]:
    rows = await client.query(RECALL_CYPHER, {"uid": user_id})
    if not rows:
        return []
    terms = {w for w in question.lower().split() if len(w) > 3}
    scored = []
    for r in rows:
        text = r.get("text") or ""
        text_lower = text.lower()
        overlap = sum(1 for t in terms if t in text_lower)
        scored.append({
            "id": r.get("id"),
            "summary": text,
            "timestamp": r.get("ts"),
            "kind": "episodic" if r.get("kind") == "episodic" else "semantic",
            "about": r.get("about") or [],
            "score": overlap,
        })
    scored.sort(key=lambda x: (-x["score"], x.get("timestamp") or ""))
    relevant = [m for m in scored if m["score"] > 0]
    return (relevant if relevant else scored)[:limit]


async def memory_stats(client: FalkorClient, user_id: str) -> dict[str, int]:
    rows = await client.query(
        "MATCH (n) WHERE (n:EpisodicMemory OR n:SemanticMemory OR n:ProceduralMemory) AND n.user_id = $uid RETURN labels(n)[0] AS label, count(*) AS c",
        {"uid": user_id},
    )
    return {r.get("label"): int(r.get("c") or 0) for r in rows}
