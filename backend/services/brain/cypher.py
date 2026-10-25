from __future__ import annotations

from typing import Any

FIND_PERSON_BY_NAME = """
MATCH (p:Person)
WHERE toLower(p.name) CONTAINS toLower($name)
OPTIONAL MATCH (p)-[:MEMBER_OF]->(t:Team)
RETURN p, t.name AS team
"""


def service_match(v: str = "s", param: str = "service") -> str:
    return (
        f"WHERE toLower({v}.name) CONTAINS toLower(${param})\n"
        f"   OR toLower({v}.id) CONTAINS toLower(${param})\n"
        f"   OR any(a IN coalesce({v}.aliases, []) WHERE toLower(a) CONTAINS toLower(${param}))"
    )


SERVICE_MATCH = service_match()

FIND_EXPERTS_ON_SERVICE = f"""
MATCH (s:Service)
{SERVICE_MATCH}
OPTIONAL MATCH (p:Person)-[k:KNOWS_ABOUT]->(s)
OPTIONAL MATCH (p)-[:MEMBER_OF]->(t:Team)
RETURN p, k.level AS level, t.name AS team, s
ORDER BY CASE k.level WHEN 'expert' THEN 0 ELSE 1 END
"""

FIND_TICKETS_FOR_SERVICE = f"""
MATCH (s:Service)
{SERVICE_MATCH}
OPTIONAL MATCH (t:Ticket)-[:RELATES_TO]->(s)
OPTIONAL MATCH (t)-[:ASSIGNED_TO]->(assignee:Person)
RETURN t, assignee.name AS assignee, s
ORDER BY CASE t.status WHEN 'blocked' THEN 0 WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END
"""

FIND_DECISION_RATIONALE = """
MATCH (d:Decision)
WHERE toLower(d.title) CONTAINS toLower($topic)
   OR toLower(d.rationale) CONTAINS toLower($topic)
   OR any(t IN coalesce(d.topics, []) WHERE toLower(t) CONTAINS toLower($topic))
OPTIONAL MATCH (d)-[:DECIDED_BY]->(p:Person)
OPTIONAL MATCH (d)-[:RELATES_TO]->(s:Service)
RETURN d, p.name AS decided_by, collect(DISTINCT s.name) AS services
"""

SHORTEST_PATH_BETWEEN = """
MATCH (a {id: $from_id}), (b {id: $to_id})
WITH a, b, shortestPath((a)-[*..6]-(b)) AS path
RETURN path
"""

MULTI_HOP_CONTEXT = """
MATCH (n {id: $node_id})
MATCH path = (n)-[*1..%d]-(m)
WITH path, nodes(path) AS ns, relationships(path) AS rs
UNWIND ns AS node
UNWIND rs AS rel
RETURN DISTINCT node, rel
LIMIT $limit
"""

SUBGRAPH_AROUND = """
MATCH (n {id: $node_id})
OPTIONAL MATCH path = (n)-[*1..%d]-(m)
WITH n, path
WITH collect(n) + collect(nodes(path)) AS nodeLists, collect(relationships(path)) AS relLists
UNWIND nodeLists AS nodeList
UNWIND nodeList AS node
WITH collect(DISTINCT node) AS nodes, relLists
UNWIND relLists AS relList
UNWIND relList AS rel
RETURN nodes, collect(DISTINCT rel) AS rels
"""

SCHEMA_COUNTS = """
MATCH (n)
RETURN head(labels(n)) AS label, count(*) AS count
ORDER BY label
"""

EDGE_COUNTS = """
MATCH ()-[r]->()
RETURN type(r) AS type, count(*) AS count
ORDER BY type
"""

BANNED = ["CREATE", "MERGE", "SET ", "DELETE", "DETACH", "REMOVE", "DROP", "CALL DB"]


async def find_person_by_name(client, name: str) -> list[dict[str, Any]]:
    rows = await client.query(FIND_PERSON_BY_NAME, {"name": name})
    out = []
    for row in rows:
        person = row.get("p")
        if not person:
            continue
        out.append({**(person if isinstance(person, dict) else {}), "team": row.get("team")})
    return out


async def find_experts_on_service(client, service: str) -> list[dict[str, Any]]:
    rows = await client.query(FIND_EXPERTS_ON_SERVICE, {"service": service})
    out = []
    for row in rows:
        person = row.get("p")
        if not person:
            continue
        out.append({
            "person": person,
            "level": row.get("level"),
            "team": row.get("team"),
            "service": row.get("s"),
        })
    return out


async def find_tickets_for_service(client, service: str) -> list[dict[str, Any]]:
    rows = await client.query(FIND_TICKETS_FOR_SERVICE, {"service": service})
    out = []
    for row in rows:
        ticket = row.get("t")
        if not ticket:
            continue
        result = dict(ticket) if isinstance(ticket, dict) else {}
        result["assignee"] = row.get("assignee")
        out.append(result)
    return out


async def find_decision_rationale(client, topic: str) -> list[dict[str, Any]]:
    rows = await client.query(FIND_DECISION_RATIONALE, {"topic": topic})
    out = []
    for row in rows:
        decision = row.get("d")
        if not decision:
            continue
        result = dict(decision) if isinstance(decision, dict) else {}
        services = row.get("services") or []
        if not isinstance(services, list):
            services = []
        services = [s for s in services if isinstance(s, str) and s]
        result["decided_by"] = row.get("decided_by")
        result["services"] = services
        result["service"] = services[0] if services else None
        out.append(result)
    return out


async def shortest_path_between(client, from_id: str, to_id: str):
    rows = await client.query(SHORTEST_PATH_BETWEEN, {"from_id": from_id, "to_id": to_id})
    if not rows:
        return None
    return rows[0].get("path")


async def multi_hop_context(client, node_id: str, depth: int = 2, limit: int = 50):
    safe_depth = max(1, min(depth, 4))
    cypher = MULTI_HOP_CONTEXT.replace("%d", str(safe_depth))
    rows = await client.query(cypher, {"node_id": node_id, "limit": limit})
    return rows


async def subgraph_around(client, node_id: str, depth: int = 2):
    safe_depth = max(1, min(depth, 3))
    cypher = SUBGRAPH_AROUND.replace("%d", str(safe_depth))
    rows = await client.query(cypher, {"node_id": node_id})
    return rows


async def schema_summary(client) -> dict[str, Any]:
    node_rows = await client.query(SCHEMA_COUNTS)
    edge_rows = await client.query(EDGE_COUNTS)
    node_counts = {r.get("label"): int(r.get("count") or 0) for r in node_rows}
    edge_counts = {r.get("type"): int(r.get("count") or 0) for r in edge_rows}
    return {"node_counts": node_counts, "edge_counts": edge_counts}


async def run_custom_query(client, cypher: str, params: dict[str, Any] | None = None):
    params = params or {}
    upper = cypher.upper()
    if any(token in upper for token in BANNED):
        raise ValueError("Only read-only queries are allowed via runCustomQuery")
    rows = await client.query(cypher, params)
    return {"rows": rows}
