from __future__ import annotations

from typing import Any


def session_stats(events: list[dict[str, Any]]) -> dict[str, Any]:
    turns = 0
    steps = 0
    llm_ms = 0
    tool_ms = 0
    ttft_ms = 0
    ttft_steps = 0
    decode_ms = 0
    decode_tokens = 0
    for e in events:
        t = e.get("type")
        if t == "turn/start":
            turns += 1
        if t == "step/end":
            steps += 1
        d = e.get("data") or {}
        if isinstance(d, dict):
            llm_ms += int(d.get("llm_ms") or 0)
            tool_ms += int(d.get("tool_ms") or 0)
            if d.get("ttft_ms") is not None:
                ttft_ms += int(d.get("ttft_ms") or 0)
                ttft_steps += 1
            decode_ms += int(d.get("decode_ms") or 0)
            decode_tokens += int(d.get("decode_tokens") or 0)
    return {
        "turns": turns,
        "steps": steps,
        "llmMs": llm_ms,
        "toolMs": tool_ms,
        "ttftMs": ttft_ms,
        "ttftSteps": ttft_steps,
        "decodeMs": decode_ms,
        "decodeTokens": decode_tokens,
    }
