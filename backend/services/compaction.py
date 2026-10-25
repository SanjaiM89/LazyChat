from __future__ import annotations

PRUNE_THRESHOLD_CHARS = 8192
PRUNE_HEAD_CHARS = 4096
PRUNE_TAIL_CHARS = 1024
SPILL_THRESHOLD_CHARS = 20000
COMPACT_THRESHOLD_RATIO = 0.8
RETAIN_RATIO = 0.3
MIN_KEEP_MESSAGES = 6
MAX_OVERFLOW_RETRIES = 2


def context_window(provider: str, model: str) -> int:
    # Default fallback; real lookup would query models
    return 128000


def pressure_ratio(input_tokens: int, provider: str, model: str) -> float:
    window = context_window(provider, model)
    if not window:
        return 0.0
    return input_tokens / window


def should_compact(input_tokens: int, provider: str, model: str, threshold_ratio: float = COMPACT_THRESHOLD_RATIO, headroom_tokens: int | None = None) -> bool:
    window = context_window(provider, model)
    if not window:
        return False
    ratio = threshold_ratio
    headroom = headroom_tokens if headroom_tokens is not None else int(window * 0.1)
    return (input_tokens + headroom) / window >= ratio


def prune_text(text: str, threshold_chars: int = PRUNE_THRESHOLD_CHARS, head_chars: int = PRUNE_HEAD_CHARS, tail_chars: int = PRUNE_TAIL_CHARS) -> str:
    if len(text) <= threshold_chars:
        return text
    head = text[:head_chars]
    tail = text[-tail_chars:] if tail_chars > 0 else ""
    cut = len(text) - head_chars - tail_chars
    return f"{head}\n... [{cut} chars cut] ...\n{tail}"
