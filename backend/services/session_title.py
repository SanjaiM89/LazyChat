from __future__ import annotations

DEFAULTS = {"fallbackMaxWords": 8, "fallbackMaxBytes": 96, "maxTitleBytes": 120}


def _byte_len(s: str) -> int:
    return len(s.encode("utf-8"))


def clip(text: str, max_bytes: int) -> str:
    if _byte_len(text) <= max_bytes:
        return text
    out = text
    while out and _byte_len(out) > max_bytes:
        out = out[:-1]
    return out


def fallback_title(text: str, max_words: int, max_bytes: int) -> str:
    words = text.replace(r"\s+", " ").strip().split(" ")
    words = [w for w in words if w]
    title = " ".join(words[:max_words])
    while title and _byte_len(title) > max_bytes:
        parts = title.split(" ")
        parts = parts[:-1]
        title = " ".join(parts)
    return title


def fold_session_title(events: list[dict], limits: dict | None = None) -> str | None:
    bounds = {**DEFAULTS, **(limits or {})}
    # user-set title (latest wins)
    for i in range(len(events) - 1, -1, -1):
        ev = events[i]
        if ev.get("type") != "session/title":
            continue
        d = ev.get("data") or {}
        title = (d.get("title") or "").strip()
        if title:
            return clip(title, bounds["maxTitleBytes"])
    # fallback: first eligible user message
    for ev in events:
        if ev.get("type") != "user/message":
            continue
        d = ev.get("data") or {}
        text = (d.get("text") or "").strip()
        if text:
            return fallback_title(text, bounds["fallbackMaxWords"], bounds["fallbackMaxBytes"])
    return None
