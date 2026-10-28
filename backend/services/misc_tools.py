from __future__ import annotations

import time
from typing import Any

from .mcp.manager import MCPManager
from .skills.service import SkillService


def build_skill_tools() -> dict[str, Any]:
    svc = SkillService()

    async def skill(name: str) -> dict[str, Any]:
        skills = await svc.list()
        wanted = name.lower()
        found = None
        for s in skills:
            if s.name.lower() == wanted:
                found = s
                break
        if found is None:
            for s in skills:
                if s.id == name:
                    found = s
                    break
        if found is None:
            for s in skills:
                if wanted in s.name.lower():
                    found = s
                    break
        if found is None:
            return {"error": f'There is no skill called "{name}".', "available": [s.name for s in skills]}
        if not found.enabled:
            return {"error": f'The skill "{found.name}" is switched off.', "name": found.name}
        return {"name": found.name, "instructions": found.prompt, "source": None}

    return {"skill": {"description": "Load a skill", "execute": skill}}


def build_deliverable_tools(conversation_id: str | None = None) -> dict[str, Any]:
    async def present(title: str, summary: str, items: list | None = None) -> dict[str, Any]:
        payload = {"title": title, "summary": summary, "items": items or [], "at": int(time.time() * 1000)}
        return {"presented": True, **payload}

    return {"present": {"description": "Present finished work", "execute": present}}


def build_inspect_tools() -> dict[str, Any]:
    async def inspect_list(family: str | None = None) -> dict[str, Any]:
        return {"count": 0, "families": [], "tools": []}

    async def inspect_query(name: str) -> dict[str, Any]:
        return {"error": f'There is no tool called "{name}".'}

    return {
        "inspect_list": {"description": "List tools", "execute": inspect_list},
        "inspect_query": {"description": "Look up a tool", "execute": inspect_query},
    }


def build_mcp_resource_tools() -> dict[str, Any]:
    mgr = MCPManager()

    async def mcp_list_resources(server: str | None = None) -> dict[str, Any]:
        resources = await mgr.list_tools()
        filtered = [r for r in resources if (server is None or r.get("server") == server)]
        return {"count": len(filtered), "resources": filtered}

    async def mcp_list_resource_templates() -> dict[str, Any]:
        return {"count": 0, "templates": []}

    async def mcp_read_resource(server: str, uri: str) -> dict[str, Any]:
        return {"error": "not implemented"}

    return {
        "mcp_list_resources": {"description": "List MCP resources", "execute": mcp_list_resources},
        "mcp_list_resource_templates": {"description": "List MCP resource templates", "execute": mcp_list_resource_templates},
        "mcp_read_resource": {"description": "Read MCP resource", "execute": mcp_read_resource},
    }
