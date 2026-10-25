from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def index() -> dict:
    return {"resource": __name__.split(".")[-1], "status": "ok"}
