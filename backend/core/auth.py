from __future__ import annotations

import os
from fastapi import Header, HTTPException

API_KEY = os.getenv("LAZYCHAT_API_KEY", "")


async def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if not API_KEY:
        return
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid or missing api key")
