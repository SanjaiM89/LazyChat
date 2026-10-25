from __future__ import annotations

from typing import Any

MAX_LOCATIONS = 100
MAX_RESULT_CHARS = 20000
TIMEOUT_MS = 15000
LSP_OPERATIONS = ["goToDefinition", "findReferences", "goToImplementation", "hover"]


def lsp_available() -> bool:
    return False


async def lsp_query(operation: str, file: str, line: int, character: int) -> dict[str, Any]:
    return {"ok": False, "error": "LSP not configured in Python backend"}
