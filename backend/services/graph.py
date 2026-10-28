from __future__ import annotations

import contextlib
import os
from typing import Any

from falkordb import FalkorDB

from core.logging import get_logger

logger = get_logger("graph")


class FalkorClient:
    _instance: FalkorClient | None = None
    graph_name: str = "lazychat"

    def __init__(self, host: str = "localhost", port: int = 6379, password: str | None = None) -> None:
        self.db = FalkorDB(host=host, port=port, password=password)
        self.graph = self.db.select_graph(self.graph_name)

    @classmethod
    def get(cls) -> FalkorClient:
        if cls._instance is None:
            host = os.getenv("FALKOR_HOST", "localhost")
            port = int(os.getenv("FALKOR_PORT", "6379"))
            password = os.getenv("FALKOR_PASSWORD")
            cls._instance = cls(host=host, port=port, password=password)
        return cls._instance

    async def query(self, cypher: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        params = params or {}
        try:
            result = self.graph.query(cypher, params)
            headers = [h[1] if isinstance(h, (list, tuple)) else h for h in (result.header or [])]
            rows: list[dict[str, Any]] = []
            for row in result.result_set or []:
                rows.append({headers[i]: row[i] for i in range(len(headers))})
            return rows
        except Exception as e:
            logger.error("graph query failed", error=str(e), cypher=cypher[:200])
            raise

    async def write(self, cypher: str, params: dict[str, Any] | None = None) -> None:
        await self.query(cypher, params)

    async def close(self) -> None:
        with contextlib.suppress(Exception):
            self.db.connection.close()


def coerce_node(value) -> dict | None:
    if not isinstance(value, dict):
        return None
    if not (isinstance(value.get("id"), int) and isinstance(value.get("labels"), list) and isinstance(value.get("properties"), dict)):
        return None
    return node_to_dict(value)


def node_to_dict(node: dict) -> dict:
    props = dict(node.get("properties") or {})
    labels = list(node.get("labels") or [])
    label = labels[0] if labels else "Node"
    nid = props.get("id")
    if nid is None:
        nid = node.get("id")
    nid = str(nid)
    name = props.get("name") or props.get("key") or props.get("title") or nid
    return {"id": nid, "labels": labels, "label": label, "name": name, "properties": props, "element_id": node.get("id")}


def coerce_edge(value) -> dict | None:
    if not isinstance(value, dict):
        return None
    if not (isinstance(value.get("sourceId"), int) and isinstance(value.get("destinationId"), int) and isinstance(value.get("relationshipType"), str)):
        return None
    return edge_to_dict(value)


def edge_to_dict(edge: dict, element_to_business=None) -> dict:
    emap = element_to_business or {}
    src = emap.get(edge.get("sourceId"), str(edge.get("sourceId")))
    dst = emap.get(edge.get("destinationId"), str(edge.get("destinationId")))
    return {"id": edge.get("id"), "source": src, "target": dst, "type": edge.get("relationshipType") or "", "properties": dict(edge.get("properties") or {})}


def collect_subgraph(rows: list) -> dict:
    nodes: dict[str, dict] = {}
    element_to_business: dict = {}
    raw_edges: list = []

    def walk(value):
        if isinstance(value, list):
            for item in value:
                walk(item)
            return
        if isinstance(value, dict) and isinstance(value.get("id"), int) and isinstance(value.get("labels"), list) and isinstance(value.get("properties"), dict):
            d = node_to_dict(value)
            nodes[d["id"]] = d
            element_to_business[value.get("id")] = d["id"]
            return
        if isinstance(value, dict) and isinstance(value.get("sourceId"), int) and isinstance(value.get("destinationId"), int) and isinstance(value.get("relationshipType"), str):
            raw_edges.append(value)
            return
        if isinstance(value, dict) and isinstance(value.get("nodes"), list) and isinstance(value.get("edges"), list):
            for n in value["nodes"]:
                walk(n)
            for e in value["edges"]:
                walk(e)
            return

    for row in rows:
        if isinstance(row, dict):
            for v in row.values():
                walk(v)

    edges = []
    seen = set()
    for raw in raw_edges:
        d = edge_to_dict(raw, element_to_business)
        key = f"{d['source']}|{d['target']}|{d['type']}"
        if key in seen:
            continue
        seen.add(key)
        edges.append(d)
    return {"nodes": list(nodes.values()), "edges": edges}
