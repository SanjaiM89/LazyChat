from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from config.settings import get_settings
from core.logging import get_logger

logger = get_logger("mcp")


class MCPManager:
    def __init__(self) -> None:
        self.servers: dict[str, Any] = {}
        self.tools: list[dict[str, Any]] = []

    async def load_config(self) -> None:
        path = Path(get_settings().mcp_servers_config)
        if not path.exists():
            logger.info("no mcp config found", path=str(path))
            return
        try:
            cfg = json.loads(path.read_text())
        except Exception as e:  # noqa: BLE001
            logger.error("failed to parse mcp config", error=str(e))
            return
        for name, spec in (cfg.get("mcpServers") or {}).items():
            self.servers[name] = spec
            logger.info("registered mcp server", name=name)

    async def list_servers(self) -> list[str]:
        return list(self.servers.keys())

    async def list_tools(self) -> list[dict[str, Any]]:
        return self.tools