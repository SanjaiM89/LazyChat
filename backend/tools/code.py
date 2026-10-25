from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from typing import Any, ClassVar

from .base import Tool, ToolResult


class CodeRunTool(Tool):
    name: str = "code_run"
    description: str = "Run a snippet of Python code and return stdout/stderr."
    parameters: ClassVar[dict] = {
        "type": "object",
        "properties": {
            "code": {"type": "string", "description": "Python source to execute"},
            "timeout": {"type": "integer", "default": 30},
        },
        "required": ["code"],
    }

    async def run(self, **kwargs: Any) -> ToolResult:
        code = kwargs["code"]
        timeout = kwargs.get("timeout", 30)
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "snippet.py"
            p.write_text(code)
            try:
                proc = await asyncio.create_subprocess_exec(
                    "python3", str(p),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=td,
                )
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
                return ToolResult(
                    ok=proc.returncode == 0,
                    data={"stdout": stdout.decode(errors="replace"), "stderr": stderr.decode(errors="replace"), "returncode": proc.returncode},
                )
            except TimeoutError:
                proc.kill()
                return ToolResult(ok=False, error=f"timed out after {timeout}s")
            except Exception as e:  # noqa: BLE001
                return ToolResult(ok=False, error=str(e))