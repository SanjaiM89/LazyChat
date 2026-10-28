from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

_commands: dict[str, dict[str, Any]] = {}


def register_command(name: str, description: str, run: Callable[[dict], Awaitable[dict]]) -> None:
    if name in _commands:
        raise ValueError(f"command '/{name}' is already registered")
    _commands[name] = {"name": name, "description": description, "run": run}


def list_commands() -> list[dict[str, Any]]:
    return list(_commands.values())


def find_command(name: str) -> dict[str, Any] | None:
    return _commands.get(name)


def command_name_of(line: str) -> str | None:
    trimmed = (line or "").strip()
    if not trimmed.startswith("/"):
        return None
    name = trimmed[1:].split()[0].lower() if trimmed[1:].split() else ""
    return name or None


async def run_command(name: str, ctx: dict[str, Any]) -> dict[str, Any]:
    cmd = _commands.get(name)
    if not cmd:
        return {"message": f"Unknown command: /{name}", "error": True}
    return await cmd["run"](ctx)


# Register built-in commands
async def _help(ctx):
    rows = "\n".join(f"/{c['name']} — {c['description']}" for c in list_commands())
    return {"message": f"The commands are:\n\n{rows}"}

register_command("help", "List the commands this app answers itself.", _help)
