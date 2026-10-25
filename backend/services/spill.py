from __future__ import annotations

import os
from pathlib import Path
from typing import Any

DATA_DIR = os.getenv("DATA_DIR", "./data")
SPILL_THRESHOLD_CHARS = 8000
SPILL_DIR = "spill"


def _spill_dir(conversation_id: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "_-" else "_" for c in conversation_id)
    return Path(DATA_DIR) / SPILL_DIR / safe


def spill_text(conversation_id: str, text: str, threshold_chars: int | None = None, run_id: str | None = None, name: str | None = None) -> dict[str, Any] | None:
    threshold = threshold_chars if threshold_chars is not None else SPILL_THRESHOLD_CHARS
    if len(text) <= threshold:
        return None
    d = _spill_dir(conversation_id)
    d.mkdir(parents=True, exist_ok=True)
    fname = f"{name or 'result'}-{int(__import__('time').time()*1000)}-{__import__('uuid').uuid4().hex[:6]}.txt"
    fpath = d / fname
    fpath.write_text(text, encoding="utf-8")
    preview = text[:1200]
    return {
        "spilled": True,
        "path": str(fpath),
        "bytes": len(text.encode("utf-8")),
        "chars": len(text),
        "preview": preview,
        "note": "The full output was written to a file. Read it with spill_read using the path above.",
    }


def read_spill(file: str, max_chars: int = 20000) -> dict[str, Any] | None:
    resolved = os.path.realpath(file)
    root = os.path.realpath(os.path.join(DATA_DIR, SPILL_DIR))
    if not resolved.startswith(root + os.sep):
        return None
    try:
        with open(resolved, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None
    return {
        "path": resolved,
        "chars": len(text),
        "text": text[:max_chars],
        "truncated": len(text) > max_chars,
    }
