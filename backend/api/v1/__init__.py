from fastapi import APIRouter

from . import agents, chat, goals, health, mcp, skills, tools, workspaces

router = APIRouter()
router.include_router(health.router, tags=["health"])
router.include_router(agents.router, prefix="/agents", tags=["agents"])
router.include_router(chat.router, prefix="/chat", tags=["chat"])
router.include_router(mcp.router, prefix="/mcp", tags=["mcp"])
router.include_router(skills.router, prefix="/skills", tags=["skills"])
router.include_router(tools.router, prefix="/tools", tags=["tools"])
router.include_router(workspaces.router, prefix="/workspaces", tags=["workspaces"])
router.include_router(goals.router, prefix="/goals", tags=["goals"])