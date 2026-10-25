from __future__ import annotations

import json
from typing import Any

CHARS_PER_TOKEN = 4
MESSAGE_OVERHEAD_TOKENS = 4


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, (len(text) + CHARS_PER_TOKEN - 1) // CHARS_PER_TOKEN)


def measure_text(text: str) -> dict[str, int]:
    return {"chars": len(text), "tokens": estimate_tokens(text)}


def measure_value(value: Any) -> dict[str, int]:
    if isinstance(value, str):
        return measure_text(value)
    if value is None:
        return {"chars": 0, "tokens": 0}
    try:
        return measure_text(json.dumps(value))
    except (TypeError, ValueError):
        return measure_text(str(value))
