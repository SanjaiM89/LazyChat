from __future__ import annotations

import asyncio
from typing import Any, ClassVar

from .base import Tool, ToolResult


class ShellTool(Tool):
    name: ClassVar[str] = "shell"
    description: ClassVar[str] = "Run a shell command and return stdout/stderr."
    parameters: ClassVar[dict] = {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "Command to execute"},
            "timeout": {"type": "integer", "default": 30},
        },
        "required": ["command"],
    }

    async def run(self, **kwargs: Any) -> ToolResult:
        command: str = kwargs["command"]
        timeout: int = kwargs.get("timeout", 30)
        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            return ToolResult(
                ok=proc.returncode == 0,
                data={
                    "stdout": stdout.decode(errors="replace"),
                    "stderr": stderr.decode(errors="replace"),
                    "returncode": proc.returncode,
                },
            )
        except TimeoutError:
            proc.kill()
            return ToolResult(ok=False, error=f"command timed out after {timeout}s")
        except Exception as e:
            return ToolResult(ok=False, error=str(e))