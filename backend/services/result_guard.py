from __future__ import annotations

from typing import Any

from .compaction import prune_text
from .spill import spill_text


def guard_result(conversation_id: str, run_id: str, name: str, value: Any, spill_threshold: int | None = None, prune_threshold: int | None = None) -> Any:
    if isinstance(value, dict) and value.get("denied"):
        return value
    text = str(value)
    spilled = spill_text(conversation_id, text, threshold_chars=spill_threshold, run_id=run_id, name=name)
    if spilled:
        return spilled
    if isinstance(value, str):
        return prune_text(value, threshold_chars=prune_threshold or 8192)
    return value
