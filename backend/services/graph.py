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
