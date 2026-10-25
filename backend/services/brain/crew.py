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


# ---------------------------------------------------------------------------
# Researcher / Synthesizer (simplified, using OpenAI-compatible LLM client)
# ---------------------------------------------------------------------------

async def run_researcher(client, question, session_id, opts=None):
    opts = opts or {}
    from .tools import compact, execute, tool_specs
    llm = opts.get("llm")
    turn_ref = opts.get("turnRef")
    on_step = opts.get("onStep")
    trace = []
    nodes = []
    edges = []
    finding_ids = []
    messages = [{"role": "user", "content": question}]
    import json as _json
    for round_no in range(4):
        if llm is None:
            break
        resp = await llm.chat(messages, tools=tool_specs())
        choice = resp["choices"][0]["message"]
        tool_calls = choice.get("tool_calls") or []
        content = choice.get("content") or ""
        if content:
            messages.append({"role": "assistant", "content": content})
        if not tool_calls:
            break
        for tc in tool_calls:
            fn = tc["function"]["name"]
            try:
                args = _json.loads(tc["function"].get("arguments") or "{}")
            except Exception:  # noqa: BLE001
                args = {}
            result = await execute(fn, client, args)
            step = {
                "tool": result.get("tool", fn),
                "arguments": args,
                "cypher": result.get("cypher"),
                "result_summary": result.get("summary"),
                "row_count": result.get("row_count", 0),
                "duration_ms": result.get("duration_ms"),
                "error": result.get("error"),
                "round": round_no + 1,
            }
            trace.append(step)
            if on_step:
                on_step(step)
            nodes.extend(result.get("nodes") or [])
            edges.extend(result.get("edges") or [])
            summary = result.get("summary")
            if summary:
                fid = await write_finding(client, session_id, RESEARCHER, summary, {
                    "nodeIds": [n.get("id") for n in (result.get("nodes") or []) if isinstance(n, dict) and n.get("id")][:8],
                    "cypher": result.get("cypher"),
                    "turnRef": turn_ref,
                })
                finding_ids.append(fid)
            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": _json.dumps(compact(result))})
    findings = await read_findings(client, session_id, RESEARCHER, turn_ref)
    return {"agent": RESEARCHER, "trace": trace, "nodes": nodes, "edges": edges, "finding_ids": finding_ids, "findings": findings}


async def run_synthesizer(client, question, session_id, opts=None):
    opts = opts or {}
    findings = await read_findings(client, session_id, RESEARCHER, opts.get("turnRef"))
    if not findings:
        return {"agent": SYNTHESIZER, "answer": "I could not find anything in the graph for that question.", "findings": []}
    llm = opts.get("llm")
    extra = opts.get("extraContext", "")
    prompt = f"Question: {question}\n\nFindings:\n" + "\n".join(f"- {f.get('content')}" for f in findings)
    if extra:
        prompt += f"\n\nRecalled memory:\n{extra}"
    prompt += "\n\nWrite the answer using only the findings above."
    if llm is None:
        return {"agent": SYNTHESIZER, "answer": "\n".join(f"- {f.get('content')}" for f in findings), "findings": findings}
    resp = await llm.chat([{"role": "user", "content": prompt}], tools=None)
    answer = (resp["choices"][0]["message"].get("content") or "").strip()
    if not answer:
        answer = "\n".join(f"- {f.get('content')}" for f in findings)
    return {"agent": SYNTHESIZER, "answer": answer, "findings": findings}


async def ask_crew(client, question, session_id, opts=None):
    opts = opts or {}
    from .intent import classify
    intent = classify(question)
    userId = opts.get("userId", "demo")
    memories = opts.get("memories") or []
    turn_ref = f"turn-{_uid(8)}"
    if not intent.is_graph:
        answer = "Hello! How can I help?"
        await write_finding(client, session_id, intent.kind, answer, {"turnRef": turn_ref})
        return {
            "answer": answer, "reasoning_trace": [], "nodes": [], "edges": [], "findings": [],
            "handoff_id": None, "agents_involved": ["company-brain"], "activity": await session_activity(client, session_id),
            "memories_used": memories, "procedures_used": [], "procedure_learned": None, "intent": intent.kind,
        }
    research = await run_researcher(client, question, session_id, {"llm": opts.get("llm"), "turnRef": turn_ref, "userId": userId, "onStep": opts.get("onStep")})
    handoff_id = await record_handoff(client, session_id, RESEARCHER, SYNTHESIZER, f"researched '{question[:80]}'", research.get("finding_ids"))
    trace = research.get("trace", [])
    has_rows = any((s.get("row_count") or 0) > 0 for s in trace)
    if not has_rows:
        answer = "I could not find anything in the graph for that question."
        await write_finding(client, session_id, SYNTHESIZER, answer[:500], {"turnRef": turn_ref})
        return {
            "answer": answer, "reasoning_trace": trace, "nodes": research.get("nodes", []), "edges": research.get("edges", []),
            "findings": research.get("findings", []), "handoff_id": handoff_id, "agents_involved": [RESEARCHER, SYNTHESIZER],
            "activity": await session_activity(client, session_id), "memories_used": memories, "procedures_used": [],
            "procedure_learned": None, "intent": "no_evidence",
        }
    recall_text = "\n".join(f"- [{m.get('kind')}] {(m.get('summary') or '')[:160]}" for m in memories) if memories else ""
    synthesis = await run_synthesizer(client, question, session_id, {"llm": opts.get("llm"), "extraContext": recall_text, "turnRef": turn_ref})
    answer = synthesis.get("answer", "")
    await write_finding(client, session_id, SYNTHESIZER, answer[:500], {"turnRef": turn_ref})
    return {
        "answer": answer, "reasoning_trace": trace, "nodes": research.get("nodes", []), "edges": research.get("edges", []),
        "findings": research.get("findings", []), "handoff_id": handoff_id, "agents_involved": [RESEARCHER, SYNTHESIZER],
        "activity": await session_activity(client, session_id), "memories_used": memories, "procedures_used": [],
        "procedure_learned": None, "intent": "graph",
    }
