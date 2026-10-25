from __future__ import annotations

from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware

from config.settings import get_settings


def add_cors(app) -> None:
    settings = get_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


async def request_id_middleware(request: Request, call_next):
    import uuid

    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    return response