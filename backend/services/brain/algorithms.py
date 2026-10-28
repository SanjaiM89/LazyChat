from __future__ import annotations

ALGO_PAGERANK = "CALL algo.pageRank(null, null) YIELD node, score RETURN node, score ORDER BY score DESC LIMIT $limit"

DEGREE_CENTRALITY = """
MATCH (s:Service)
OPTIONAL MATCH (s)-[r:DEPENDS_ON]-()
RETURN s, count(r) AS score
ORDER BY score DESC
LIMIT $limit
"""

DEPENDENCY_IMPACT = """
MATCH (root:Service)
{service_match}
MATCH path = (affected:Service)-[:DEPENDS_ON*1..5]->(root)
RETURN DISTINCT affected, min(length(path)) AS distance
ORDER BY distance, affected.name
"""

EXPERT_FINDER = """
MATCH (root:Service)
{service_match}
OPTIONAL MATCH (p:Person)-[k:KNOWS_ABOUT]->(root)
WITH root, collect(DISTINCT {person: p, level: k.level, hops: 1}) AS direct
OPTIONAL MATCH (t:Ticket)-[:RELATES_TO]->(root)
WHERE t.status <> 'done'
OPTIONAL MATCH (t)-[:ASSIGNED_TO]->(active:Person)
WITH root, direct, collect(DISTINCT {person: active, level: 'hands-on', hops: 2}) AS ticketed
OPTIONAL MATCH (root)<-[:OWNS]-(team:Team)
OPTIONAL MATCH (member:Person)-[:MEMBER_OF]->(team)
WITH direct, ticketed, collect(DISTINCT {person: member, level: 'owning-team', hops: 2}) AS owners
RETURN direct + ticketed + owners AS candidates
"""

BRIDGE_FINDER = """
MATCH (a:Service)-[:DEPENDS_ON*1..]->(mid:Service)-[:DEPENDS_ON*1..]->(b:Service)
WHERE a <> b
WITH mid, count(DISTINCT a) * count(DISTINCT b) AS bridge_score
RETURN mid, bridge_score
ORDER BY bridge_score DESC
LIMIT $limit
"""

SHORTEST_SERVICE_PATH = """
MATCH (a:Service)
WHERE toLower(a.name) CONTAINS toLower($from_name)
   OR toLower(a.id) CONTAINS toLower($from_name)
   OR any(x IN coalesce(a.aliases, []) WHERE toLower(x) CONTAINS toLower($from_name))
MATCH (b:Service)
WHERE toLower(b.name) CONTAINS toLower($to_name)
   OR toLower(b.id) CONTAINS toLower($to_name)
   OR any(x IN coalesce(b.aliases, []) WHERE toLower(x) CONTAINS toLower($to_name))
WITH a, b, shortestPath((a)-[:DEPENDS_ON*..6]-(b)) AS path
RETURN path
"""

BETWEENNESS_SERVICES = "CALL algo.betweenness({nodeLabels:['Service']}) YIELD node, score RETURN node, score ORDER BY score DESC LIMIT $limit"
BETWEENNESS_ALL = "CALL algo.betweenness() YIELD node, score RETURN node, score ORDER BY score DESC LIMIT $limit"
HARMONIC_CENTRALITY = "CALL algo.HarmonicCentrality({nodeLabels:['Service']}) YIELD node, score RETURN node, score ORDER BY score DESC LIMIT $limit"
COMMUNITIES = "CALL algo.labelPropagation() YIELD node RETURN node"

MEMORY_LABELS = {"Session", "Turn", "Finding", "AgentHandoff", "EpisodicMemory", "SemanticMemory", "ProceduralMemory"}


def _service_match() -> str:
    from .cypher import service_match
    return service_match("root")


# Fix DEPENDENCY_IMPACT and EXPERT_FINDER placeholders
DEPENDENCY_IMPACT = DEPENDENCY_IMPACT.replace("{service_match}", _service_match())
EXPERT_FINDER = EXPERT_FINDER.replace("{service_match}", _service_match())


async def betweenness_centrality(client, limit: int = 8, services_only: bool = True):
    cypher = BETWEENNESS_SERVICES if services_only else BETWEENNESS_ALL
    try:
        rows = await client.query(cypher, {"limit": limit})
        out = []
        for row in rows:
            node = row.get("node")
            if node:
                out.append({"node": node, "score": float(row.get("score") or 0), "approx": False})
        return out
    except Exception:
        return await bridge_services(client, limit)


async def harmonic_centrality(client, limit: int = 8):
    try:
        rows = await client.query(HARMONIC_CENTRALITY, {"limit": limit})
        out = []
        for row in rows:
            node = row.get("node")
            if node:
                out.append({"node": node, "score": float(row.get("score") or 0)})
        return out
    except Exception:
        return []


async def communities(client):
    try:
        rows = await client.query(COMMUNITIES)
    except Exception:
        return []
    home = await home_teams(client)
    groups: dict[str, list] = {}
    for row in rows:
        node = row.get("node")
        if not node or not isinstance(node, dict):
            continue
        labels = node.get("labels") or []
        label = labels[0] if labels else ""
        if label in MEMORY_LABELS:
            continue
        key = home.get(node.get("id")) or community_label(node)
        groups.setdefault(key, []).append(node)
    out = []
    for community, members in groups.items():
        out.append({
            "community": community,
            "size": len(members),
            "members": [{"id": m.get("id"), "name": display(m)} for m in members[:25]],
        })
    out.sort(key=lambda x: x["size"], reverse=True)
    return out


async def home_teams(client) -> dict[str, str]:
    home: dict[str, str] = {}
    queries = [
        "MATCH (p:Person)-[:MEMBER_OF]->(t:Team) RETURN p.id AS id, t.name AS team",
        "MATCH (s:Service)<-[:OWNS]-(t:Team) RETURN s.id AS id, t.name AS team",
    ]
    for cypher in queries:
        try:
            rows = await client.query(cypher)
            for row in rows:
                tid = row.get("id")
                team = row.get("team")
                if team and tid and tid not in home:
                    home[str(tid)] = team
        except Exception:
            pass
    return home


def community_label(node: dict) -> str:
    props = node.get("properties") or {}
    labels = node.get("labels") or []
    label = labels[0] if labels else "Node"
    if label == "Person":
        return props.get("team") or "unassigned"
    if label == "Team":
        return props.get("name") or label
    if label == "Service":
        owner = props.get("owner") or ""
        return owner.split(":")[-1] if owner else label
    return label


def display(node: dict) -> str:
    p = node.get("properties") or {}
    return p.get("name") or p.get("key") or p.get("title") or node.get("id")


async def pagerank(client, limit: int = 10):
    try:
        rows = await client.query(ALGO_PAGERANK, {"limit": limit})
        out = []
        for row in rows:
            node = row.get("node")
            if node:
                out.append({"node": node, "score": float(row.get("score") or 0)})
        return out
    except Exception:
        rows = await client.query(DEGREE_CENTRALITY, {"limit": limit})
        out = []
        for row in rows:
            node = row.get("s")
            if node:
                out.append({"node": node, "score": float(row.get("score") or 0)})
        return out


async def dependency_impact(client, service: str):
    rows = await client.query(DEPENDENCY_IMPACT, {"service": service})
    out = []
    for row in rows:
        node = row.get("affected")
        if node:
            out.append({"service": node, "distance": int(row.get("distance") or 0)})
    return out


async def expert_finder(client, service: str):
    rows = await client.query(EXPERT_FINDER, {"service": service})
    if not rows:
        return []
    candidates = rows[0].get("candidates") or []
    if not isinstance(candidates, list):
        return []
    scores: dict[str, dict] = {}
    weights = {"expert": 3.0, "familiar": 1.0, "hands-on": 1.5, "owning-team": 0.5}
    for cand in candidates:
        if not isinstance(cand, dict):
            continue
        person = cand.get("person")
        if not person or not isinstance(person, dict):
            continue
        pid = person.get("id")
        level = cand.get("level") or "familiar"
        hops = int(cand.get("hops") or 1)
        entry = scores.get(pid, {"person": person, "score": 0.0, "evidence": []})
        entry["score"] += (weights.get(level, 0.5)) / hops
        entry["evidence"].append(f"{level} (hops={hops})")
        scores[pid] = entry
    out = []
    for i, entry in enumerate(sorted(scores.values(), key=lambda x: x["score"], reverse=True)):
        out.append({"person": entry["person"], "score": entry["score"], "evidence": entry["evidence"], "rank": i + 1})
    return out


async def bridge_services(client, limit: int = 5):
    rows = await client.query(BRIDGE_FINDER, {"limit": limit})
    out = []
    for row in rows:
        node = row.get("mid")
        if node:
            out.append({"service": node, "bridge_score": float(row.get("bridge_score") or 0)})
    return out


async def shortest_path_between_services(client, from_name: str, to_name: str):
    rows = await client.query(SHORTEST_SERVICE_PATH, {"from_name": from_name, "to_name": to_name})
    if not rows:
        return None
    path = rows[0].get("path")
    if not path or not isinstance(path, dict):
        return None
    nodes = path.get("nodes") or []
    edges_raw = path.get("edges") or []
    nodes = [n if isinstance(n, dict) else {} for n in nodes]
    edges = []
    for i, edge in enumerate(edges_raw):
        e = edge if isinstance(edge, dict) else {}
        edges.append({
            "type": e.get("relationshipType") or e.get("type") or "",
            "source": nodes[i].get("id") if i < len(nodes) else None,
            "target": nodes[i + 1].get("id") if i + 1 < len(nodes) else None,
        })
    return {"length": len(edges), "nodes": nodes, "edges": edges}
