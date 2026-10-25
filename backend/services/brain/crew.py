from __future__ import annotations

import random
from datetime import UTC, datetime
from typing import Any

from ..core.logging import get_logger
from .graph import FalkorClient

logger = get_logger("brain.crew")

RESEARCHER = "researcher"
SYNTHESIZER = "synthesizer"


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _uid(n: int) -> str:
    return "".join(random.choice("0123456789abcdef") for _ in range(n))


async def write_finding(client: FalkorClient, session_id: str, agent: str, content: str, opts: dict[str, Any] | None = None) -> str:
    opts = opts or {}
    fid = f"finding:{_uid(10)}"
    ts = now_iso()
    await client.write(
        "MERGE (f:Finding {id: $fid}) SET f.session_id = $sid, f.agent = $agent, f.content = $content, "
        "f.timestamp = $ts, f.about = $about, f.cypher = $stmt, f.turn_ref = $turnRef",
        {
            "fid": fid, "sid": session_id, "agent": agent, "content": content, "ts": ts,
            "about": opts.get("nodeIds") or [], "stmt": opts.get("cypher"), "turnRef": opts.get("turnRef"),
        },
    )
    return fid


async def read_findings(client: FalkorClient, session_id: str, agent: str | None = None, turn_ref: str | None = None) -> list[dict[str, Any]]:
    clauses = ["f.session_id = $sid"]
    params: dict[str, Any] = {"sid": session_id}
    if agent:
        clauses.append("f.agent = $agent")
        params["agent"] = agent
    if turn_ref:
        clauses.append("f.turn_ref = $turnRef")
        params["turnRef"] = turn_ref
    rows = await client.query(
        f"MATCH (f:Finding) WHERE {' AND '.join(clauses)} RETURN f.id AS id, f.content AS content, f.timestamp AS timestamp, f.about AS about, f.cypher AS cypher ORDER BY f.timestamp ASC",
        params,
    )
    return [{"id": r.get("id"), "content": r.get("content"), "timestamp": r.get("timestamp"), "about": r.get("about") or [], "cypher": r.get("cypher")} for r in rows]


async def record_handoff(client: FalkorClient, session_id: str, from_agent: str, to_agent: str, reason: str, finding_ids: list[str] | None = None) -> str:
    hid = f"handoff:{_uid(10)}"
    ts = now_iso()
    await client.write(
        "MERGE (h:AgentHandoff {id: $hid}) SET h.session_id = $sid, h.from_agent = $fr, h.to_agent = $to, h.reason = $reason, h.timestamp = $ts",
        {"hid": hid, "sid": session_id, "fr": from_agent, "to": to_agent, "reason": reason, "ts": ts},
    )
    for fid in (finding_ids or []):
        await client.write("MATCH (h:AgentHandoff {id: $hid}), (f:Finding {id: $fid}) MERGE (h)-[:RECORDED]->(f)", {"hid": hid, "fid": fid})
    return hid


async def session_activity(client: FalkorClient, session_id: str) -> list[dict[str, Any]]:
    finding_rows = await client.query("MATCH (f:Finding) WHERE f.session_id = $sid RETURN f.agent AS agent, f.content AS content, f.timestamp AS timestamp ORDER BY f.timestamp ASC", {"sid": session_id})
    activity = [{"kind": "finding", "agent": r.get("agent"), "detail": r.get("content"), "timestamp": r.get("timestamp")} for r in finding_rows]
    handoff_rows = await client.query(
        "MATCH (h:AgentHandoff) WHERE h.session_id = $sid OPTIONAL MATCH (h)-[:RECORDED]->(f:Finding) RETURN h.from_agent AS from_agent, h.to_agent AS to_agent, h.reason AS reason, h.timestamp AS timestamp, count(f) AS count ORDER BY h.timestamp ASC",
        {"sid": session_id},
    )
    for r in handoff_rows:
        activity.append({"kind": "handoff", "agent": r.get("from_agent"), "detail": f"-> {r.get('to_agent')}: {r.get('reason')} ({r.get('count')} finding(s))", "timestamp": r.get("timestamp")})
    activity.sort(key=lambda x: x.get("timestamp") or "")
    return activity
