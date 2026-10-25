from .base import Tool, ToolResult
from .code import CodeRunTool
from .registry import ToolRegistry, registry
from .shell import ShellTool
from .web import WebFetchTool

# Register built-in tools
registry.register(ShellTool())
registry.register(WebFetchTool())
registry.register(CodeRunTool())

__all__ = ["Tool", "ToolRegistry", "ToolResult", "registry"]