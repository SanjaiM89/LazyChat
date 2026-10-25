from __future__ import annotations

from typing import Any

BUILTIN_PLUGINS: list[dict[str, Any]] = [
    {"id": "web", "title": "Web", "description": "Search the web and fetch pages.", "tools": ["web_search", "web_fetch"], "version": "1.0.0"},
    {"id": "code", "title": "Code", "description": "Run code.", "tools": ["code_run", "shell"], "version": "1.0.0"},
    {"id": "memory", "title": "Memory", "description": "Workspace memory.", "tools": ["ws_remember"], "version": "1.0.0"},
]


def list_plugins() -> list[dict[str, Any]]:
    return BUILTIN_PLUGINS


def get_plugin(plugin_id: str) -> dict[str, Any] | None:
    for p in BUILTIN_PLUGINS:
        if p["id"] == plugin_id:
            return p
    return None
