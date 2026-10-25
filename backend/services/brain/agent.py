from __future__ import annotations

from typing import Any

from core.logging import get_logger
from .crew import ask_crew
from services.graph import FalkorClient
from .memory_session import ensure_session, recall_memories, record_turn

logger = get_logger("brain.agent")


async def known_services(client: FalkorClient) -> list[str]:
    rows = await client.query("MATCH (s:Service) RETURN s.name AS name, s.aliases AS aliases")
    names = []
    for r in rows:
        for cand in [r.get("name")] + (r.get("aliases") or []):
            if cand:
                names.append(cand)
    return names


async def known_topics(client: FalkorClient) -> list[str]:
    rows = await client.query("MATCH (d:Decision) RETURN d.topics AS topics")
    topics = []
    for r in rows:
        for t in (r.get("topics") or []):
            if t and t not in topics:
                topics.append(t)
    return topics


async def edges_between(client: FalkorClient, node_ids: list[str]) -> list[dict[str, Any]]:
    if len(node_ids) < 2:
        return []
    try:
        rows = await client.query("MATCH (a)-[r]->(b) WHERE a.id IN $ids AND b.id IN $ids RETURN a.id AS src, type(r) AS rel, b.id AS dst", {"ids": node_ids[:200]})
    except Exception:  # noqa: BLE001
        return []
    seen = set()
    edges = []
    for r in rows:
        key = f"{r.get('src')}|{r.get('rel')}|{r.get('dst')}"
        if key in seen:
            continue
        seen.add(key)
        edges.append({"source": r.get("src"), "target": r.get("dst"), "type": r.get("rel")})
    return edges


def dedupe_subgraph(nodes, edges, max_nodes=80):
    by_id = {}
    for n in nodes:
        if isinstance(n, dict) and n.get("id") not in by_id:
            by_id[n.get("id")] = n
    trimmed = list(by_id.values())[:max_nodes]
    keep = {n.get("id") for n in trimmed}
    seen = set()
    out_edges = []
    for e in edges:
        if not isinstance(e, dict):
            continue
        key = f"{e.get('source')}|{e.get('target')}|{e.get('type')}"
        if key in seen:
            continue
        seen.add(key)
        if e.get("source") in keep and e.get("target") in keep:
            out_edges.append(e)
    return {"nodes": trimmed, "edges": out_edges}


async def ask_agent(question: str, opts: dict[str, Any] | None = None) -> dict[str, Any]:
    opts = opts or {}
    if not (question or "").strip():
        raise ValueError("question must not be empty")
    client = opts.get("client") or FalkorClient.get()
    user_id = opts.get("userId", "demo")
    session_id = await ensure_session(client, user_id, opts.get("sessionId"))
    llm = opts.get("llm")
    memories = []
    if opts.get("useMemory", True):
        try:
            memories = await recall_memories(client, user_id, question)
        except Exception:  # noqa: BLE001
            memories = []
    await record_turn(client, session_id, "user", question)
    multi_agent = opts.get("multiAgent", True)
    if multi_agent:
        result = await ask_crew(client, question, session_id, {"userId": user_id, "llm": llm, "memories": memories, "onStep": opts.get("onStep")})
        answer = result.get("answer", "")
        trace = result.get("reasoning_trace", [])
        all_nodes = result.get("nodes", [])
        all_edges = result.get("edges", [])
        agents_involved = result.get("agents_involved", [])
        activity = result.get("activity", [])
        intent = result.get("intent", "graph")
        procedures_used = result.get("procedures_used", [])
        procedure_learned = result.get("procedure_learned")
    else:
        # single pass
        trace = []
        all_nodes = []
        all_edges = []
        answer = ""
        # simplified: just delegate to crew
        result = await ask_crew(client, question, session_id, {"userId": user_id, "llm": llm, "memories": memories, "onStep": opts.get("onStep")})
        answer = result.get("answer", "")
        trace = result.get("reasoning_trace", [])
        all_nodes = result.get("nodes", [])
        all_edges = result.get("edges", [])
        agents_involved = result.get("agents_involved", [])
        activity = result.get("activity", [])
        intent = result.get("intent", "graph")
        procedures_used = result.get("procedures_used", [])
        procedure_learned = result.get("procedure_learned")
    await record_turn(client, session_id, "assistant", answer, (agents_involved[0] if agents_involved else "agent"))
    if not all_edges and all_nodes:
        all_edges = await edges_between(client, [n.get("id") for n in all_nodes if isinstance(n, dict) and n.get("id")])
    subgraph = dedupe_subgraph(all_nodes, all_edges)
    sources = sorted({f"{(n.get('label') or (n.get('labels') or ['Node'])[0])}:{(n.get('properties') or {}).get('key') or (n.get('properties') or {}).get('name') or (n.get('properties') or {}).get('title') or n.get('name') or n.get('id')}" for n in all_nodes if isinstance(n, dict)})[:20]
    return {
        "answer": answer,
        "reasoning_trace": trace,
        "graph_context": subgraph,
        "session_id": session_id,
        "user_id": user_id,
        "sources": sources,
        "agents_involved": agents_involved,
        "tool_count": len(trace),
        "memories_used": memories,
        "activity": activity,
        "intent": intent,
        "procedures_used": procedures_used,
        "procedure_learned": procedure_learned,
    }
