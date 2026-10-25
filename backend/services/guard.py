from __future__ import annotations

# Result guard: ensure tool results don't exceed limits
MAX_RESULT_CHARS = 50000


def guard_result(text: str, max_chars: int = MAX_RESULT_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + f"\n... [truncated, {len(text) - max_chars} chars omitted]"
