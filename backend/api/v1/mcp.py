from __future__ import annotations

from fastapi import APIRouter

from mcp.manager import MCPManager

router = APIRouter()
_manager = MCPManager()


@router.get("/servers")
async def list_servers() -> list[str]:
    await _manager.load_config()
    return await _manager.list_servers()


@router.get("/tools")
async def list_tools() -> list[dict]:
    return await _manager.list_tools()