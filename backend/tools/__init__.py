from .base import Tool, ToolResult
from .registry import ToolRegistry, registry
from .shell import ShellTool
from .web import WebFetchTool

# Register built-in tools
registry.register(ShellTool())
registry.register(WebFetchTool())

__all__ = ["Tool", "ToolRegistry", "ToolResult", "registry"]