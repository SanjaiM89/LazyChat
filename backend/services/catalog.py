from __future__ import annotations

from dataclasses import dataclass

ToolEffect = str
ToolFamily = str
ToolVariant = str


@dataclass
class ToolMeta:
    name: str
    family: ToolFamily
    title: str
    variant: ToolVariant
    effect: ToolEffect
    concurrency_safe: bool
    mutates: bool


# Tool catalog ported from lib/agent/catalog.ts. Entries are populated below.
TOOL_CATALOG: dict[str, ToolMeta] = {}
