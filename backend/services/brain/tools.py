from __future__ import annotations

import time
from typing import Any

from core.logging import get_logger
from .algorithms import (
    bridge_services,
    dependency_impact,
    expert_finder,
    find_tickets_for_service,
    pagerank,
    shortest_path_between_services,
)
from .cypher import (
    FIND_EXPERTS_ON_SERVICE,
    find_decision_rationale,
    find_person_by_name,
    service_match,
    subgraph_around,
)
from services.graph import FalkorClient

logger = get_logger("brain.tools")

REGISTRY: dict[str, dict[str, Any]] = {}


def empty(tool: str, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    base = {"tool": tool, "ok": True, "summary": "", "nodes": [], "edges": [], "row_count": 0}
    if overrides:
        base.update(overrides)
    return base


def tool(name: str, description: str, input_schema: dict[str, Any], executor):
    REGISTRY[name] = {"name": name, "description": description, "input_schema": input_schema, "executor": executor}


def as_string(value: Any, fallback: str = "") -> str:
    return value if isinstance(value, str) else fallback


def tool_specs() -> list[dict[str, Any]]:
    return [{"name": t["name"], "description": t["description"], "input_schema": t["input_schema"]} for t in REGISTRY.values()]


async def execute(name: str, client: FalkorClient, args: dict[str, Any]) -> dict[str, Any]:
    spec = REGISTRY.get(name)
    if not spec:
        return empty(name, {"ok": False, "summary": f"unknown tool {name}", "error": f"unknown tool {name}"})
    start = time.time()
    try:
        result = await spec["executor"](client, args or {})
        result.setdefault("duration_ms", int((time.time() - start) * 1000))
        return result
    except Exception as e:  # noqa: BLE001
        return empty(name, {"ok": False, "summary": str(e), "error": str(e), "duration_ms": int((time.time() - start) * 1000)})


def compact(result: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in result.items() if k in ("tool", "summary", "row_count", "nodes")}


# --- Expertise ---

async def _find_experts(client, args):
    service = as_string(args.get("service"))
    ranked = await expert_finder(client, service)
    if not ranked:
        return empty("find_experts", {"summary": f"No one is recorded as knowing '{service}'."})
    top = ranked[:5]
    people = ", ".join(f"{e['person'].get('name') if isinstance(e.get('person'), dict) else e.get('person')} ({round(e['score'], 1)})" for e in top)
    return empty("find_experts", {
        "summary": f"{len(ranked)} people know {service}. Best matches: {people}.",
        "data": top,
        "cypher": FIND_EXPERTS_ON_SERVICE,
        "nodes": [e.get("person") for e in top if e.get("person")],
        "row_count": len(ranked),
    })

tool("find_experts", "Rank people who know a service.", {"type": "object", "properties": {"service": {"type": "string"}}, "required": ["service"]}, _find_experts)

# --- Dependencies / blast radius ---

async def _trace_dependencies(client, args):
    service = as_string(args.get("service"))
    direction = as_string(args.get("direction"), "dependencies")
    # Use cypher via service_match
    if direction == "dependents":
        cypher = f"MATCH (s:Service) {service_match()} OPTIONAL MATCH (dep:Service)-[:DEPENDS_ON]->(s) RETURN s, collect(dep) AS dependents"
    else:
        cypher = f"MATCH (s:Service) {service_match()} OPTIONAL MATCH (s)-[:DEPENDS_ON]->(dep:Service) RETURN s, collect(dep) AS dependencies"
    rows = await client.query(cypher, {"service": service})
    nodes = []
    for r in rows:
        s = r.get("s")
        if isinstance(s, dict):
            nodes.append(s)
        deps = r.get("dependents") or r.get("dependencies") or []
        if isinstance(deps, list):
            for d in deps:
                if isinstance(d, dict):
                    nodes.append(d)
    return empty("trace_dependencies", {
        "summary": f"Traced dependencies for '{service}' ({direction}).",
        "cypher": cypher,
        "nodes": nodes,
        "row_count": len(rows),
    })

tool("trace_dependencies", "List services a service depends on or dependents.", {"type": "object", "properties": {"service": {"type": "string"}, "direction": {"type": "string", "enum": ["dependencies", "dependents"]}}, "required": ["service"]}, _trace_dependencies)

async def _impact_of_failure(client, args):
    service = as_string(args.get("service"))
    impacts = await dependency_impact(client, service)
    nodes = [i.get("service") for i in impacts if i.get("service")]
    return empty("impact_of_failure", {
        "summary": f"{len(impacts)} services affected if '{service}' fails.",
        "cypher": "DEPENDENCY_IMPACT",
        "nodes": nodes,
        "row_count": len(impacts),
        "data": impacts,
    })

tool("impact_of_failure", "Services that break if a service fails.", {"type": "object", "properties": {"service": {"type": "string"}}, "required": ["service"]}, _impact_of_failure)

# --- Bottlenecks / centrality ---

async def _find_bottlenecks(client, args):
    limit = int(args.get("limit") or 8)
    rows = await client.query("CALL algo.betweenness({nodeLabels:['Service']}) YIELD node, score RETURN node, score ORDER BY score DESC LIMIT $limit", {"limit": limit})
    nodes = [r.get("node") for r in rows if r.get("node")]
    return empty("find_bottlenecks", {"summary": f"Top {len(rows)} bottleneck services.", "nodes": nodes, "row_count": len(rows), "data": rows})

tool("find_bottlenecks", "Betweenness centrality over services.", {"type": "object", "properties": {"limit": {"type": "integer"}}, "required": []}, _find_bottlenecks)

async def _central_services(client, args):
    limit = int(args.get("limit") or 8)
    rows = await client.query("CALL algo.HarmonicCentrality({nodeLabels:['Service']}) YIELD node, score RETURN node, score ORDER BY score DESC LIMIT $limit", {"limit": limit})
    nodes = [r.get("node") for r in rows if r.get("node")]
    return empty("central_services", {"summary": f"Top {len(rows)} central services.", "nodes": nodes, "row_count": len(rows), "data": rows})

tool("central_services", "Harmonic centrality over services.", {"type": "object", "properties": {"limit": {"type": "integer"}}, "required": []}, _central_services)

async def _pagerank(client, args):
    limit = int(args.get("limit") or 10)
    res = await pagerank(client, limit)
    nodes = [r.get("node") for r in res if r.get("node")]
    return empty("pagerank", {"summary": f"Top {len(res)} nodes by PageRank.", "nodes": nodes, "row_count": len(res), "data": res})

tool("pagerank", "PageRank over the graph.", {"type": "object", "properties": {"limit": {"type": "integer"}}, "required": []}, _pagerank)

async def _bridge_services(client, args):
    limit = int(args.get("limit") or 5)
    res = await bridge_services(client, limit)
    nodes = [r.get("service") for r in res if r.get("service")]
    return empty("bridge_services", {"summary": f"{len(res)} bridge services.", "nodes": nodes, "row_count": len(res), "data": res})

tool("bridge_services", "Services on many dependency chains.", {"type": "object", "properties": {"limit": {"type": "integer"}}, "required": []}, _bridge_services)

async def _shortest_path(client, args):
    from_name = as_string(args.get("from_service") or args.get("from"))
    to_name = as_string(args.get("to_service") or args.get("to"))
    res = await shortest_path_between_services(client, from_name, to_name)
    if not res:
        return empty("shortest_path", {"summary": f"No path between '{from_name}' and '{to_name}'."})
    nodes = res.get("nodes") or []
    return empty("shortest_path", {"summary": f"Path length {res.get('length')} between '{from_name}' and '{to_name}'.", "nodes": nodes, "row_count": res.get("length", 0), "data": res})

tool("shortest_path", "Shortest dependency path between two services.", {"type": "object", "properties": {"from_service": {"type": "string"}, "to_service": {"type": "string"}}, "required": ["from_service", "to_service"]}, _shortest_path)

# --- Tickets / decisions ---

async def _tickets_for_service(client, args):
    service = as_string(args.get("service"))
    rows = await find_tickets_for_service(client, service)
    nodes = [r for r in rows]
    return empty("tickets_for_service", {"summary": f"{len(rows)} tickets for '{service}'.", "nodes": nodes, "row_count": len(rows), "data": rows})

tool("tickets_for_service", "Tickets related to a service.", {"type": "object", "properties": {"service": {"type": "string"}}, "required": ["service"]}, _tickets_for_service)

async def _tickets_blocked_by(client, args):
    topic = as_string(args.get("topic") or args.get("decision"))
    rows = await find_decision_rationale(client, topic)
    return empty("tickets_blocked_by", {"summary": f"Decision rationale for '{topic}': {len(rows)} result(s).", "row_count": len(rows), "data": rows})

tool("tickets_blocked_by", "Tickets blocked by a decision.", {"type": "object", "properties": {"topic": {"type": "string"}}, "required": ["topic"]}, _tickets_blocked_by)

async def _get_decision_context(client, args):
    topic = as_string(args.get("topic"))
    rows = await find_decision_rationale(client, topic)
    return empty("get_decision_context", {"summary": f"Decision context for '{topic}': {len(rows)} result(s).", "row_count": len(rows), "data": rows})

tool("get_decision_context", "Why a decision was made.", {"type": "object", "properties": {"topic": {"type": "string"}}, "required": ["topic"]}, _get_decision_context)

# --- People ---

async def _find_people(client, args):
    name = as_string(args.get("name"))
    rows = await find_person_by_name(client, name)
    nodes = [r for r in rows]
    return empty("find_people", {"summary": f"{len(rows)} people matching '{name}'.", "nodes": nodes, "row_count": len(rows), "data": rows})

tool("find_people", "Find a person by name.", {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}, _find_people)

# --- Graph context / cypher ---

async def _graph_context(client, args):
    node_id = as_string(args.get("node_id") or args.get("node"))
    depth = int(args.get("depth") or 2)
    rows = await subgraph_around(client, node_id, depth)
    nodes = []
    if isinstance(rows, list) and rows:
        r = rows[0]
        if isinstance(r, dict):
            ns = r.get("nodes")
            if isinstance(ns, list):
                nodes = ns
    return empty("graph_context", {"summary": f"Neighbourhood of '{node_id}' (depth {depth}).", "nodes": nodes, "row_count": len(nodes)})

tool("graph_context", "Neighbourhood of a node.", {"type": "object", "properties": {"node_id": {"type": "string"}, "depth": {"type": "integer"}}, "required": ["node_id"]}, _graph_context)

async def _run_cypher(client, args):
    cypher = as_string(args.get("cypher") or args.get("query"))
    params = args.get("params") or {}
    from .cypher import run_custom_query
    res = await run_custom_query(client, cypher, params if isinstance(params, dict) else {})
    rows = res.get("rows") or []
    return empty("run_cypher", {"summary": f"Custom query returned {len(rows)} row(s).", "row_count": len(rows), "data": res})

tool("run_cypher", "Read-only Cypher query.", {"type": "object", "properties": {"cypher": {"type": "string"}, "params": {"type": "object"}}, "required": ["cypher"]}, _run_cypher)
