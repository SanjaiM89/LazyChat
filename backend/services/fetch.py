from __future__ import annotations

from typing import Any

import httpx


async def fetch_url(url: str, max_chars: int = 20000) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            text = resp.text[:max_chars]
            return {"ok": True, "status": resp.status_code, "text": text}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
