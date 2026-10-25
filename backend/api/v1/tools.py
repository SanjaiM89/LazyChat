from __future__ import annotations

from fastapi import APIRouter

from tools.base import ToolResult
from tools.registry import registry

router = APIRouter()


@router.get("/")
async def list_tools() -> list[dict]:
    return registry.schemas()


@router.post("/{name}/run")
async def run_tool(name: str, payload: dict) -> dict:
    tool = registry.get(name)
    if tool is None:
        return {"ok": False, "error": f"unknown tool {name}"}
    result: ToolResult = await tool.run(**payload)
    return result.model_dump()