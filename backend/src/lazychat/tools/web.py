from __future__ import annotations

from typing import Any

import httpx

from .base import Tool, ToolResult


class WebFetchTool(Tool):
    name = "web_fetch"
    description = "Fetch a URL and return its text content."
    parameters = {
        "type": "object",
        "properties": {"url": {"type": "string"}, "max_chars": {"type": "integer", "default": 20000}},
        "required": ["url"],
    }

    async def run(self, **kwargs: Any) -> ToolResult:
        url = kwargs["url"]
        max_chars = kwargs.get("max_chars", 20000)
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                text = resp.text[:max_chars]
                return ToolResult(ok=True, data={"status": resp.status_code, "text": text})
        except Exception as e:  # noqa: BLE001
            return ToolResult(ok=False, error=str(e))