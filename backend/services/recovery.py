from __future__ import annotations

from typing import Any

# Simplified recovery: list interrupted runs (none tracked in Python yet) and resume stub.


def list_interrupted_runs(conversation_id: str | None = None) -> list[dict[str, Any]]:
    return []


def resume_run(run_id: str, opts: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"ok": False, "error": f"There is no interrupted run called \"{run_id}\"."}
