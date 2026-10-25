from __future__ import annotations

import json
import os
from typing import Any

NAME = "session-state.json"


def _path() -> str:
    return os.path.join(os.getenv("DATA_DIR", "./data"), NAME)


def _load() -> dict[str, Any]:
    p = _path()
    if not os.path.exists(p):
        return {"pinned": [], "archived": []}
    try:
        with open(p) as f:
            raw = json.load(f)
    except Exception:  # noqa: BLE001
        return {"pinned": [], "archived": []}
    if not isinstance(raw, dict):
        return {"pinned": [], "archived": []}
    pinned = [x for x in (raw.get("pinned") or []) if isinstance(x, str)]
    archived = [x for x in (raw.get("archived") or []) if isinstance(x, str)]
    return {"pinned": pinned, "archived": archived}


def _save(state: dict[str, Any]) -> None:
    p = _path()
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    with open(p, "w") as f:
        json.dump(state, f, indent=2)


def read_session_state() -> dict[str, Any]:
    return _load()


def pin_session(sid: str) -> dict[str, Any]:
    state = _load()
    pinned = [sid] + [x for x in state["pinned"] if x != sid]
    archived = [x for x in state["archived"] if x != sid]
    new = {"pinned": pinned, "archived": archived}
    _save(new)
    return new


def unpin_session(sid: str) -> dict[str, Any]:
    state = _load()
    new = {"pinned": [x for x in state["pinned"] if x != sid], "archived": state["archived"]}
    _save(new)
    return new


def archive_session(sid: str) -> dict[str, Any]:
    state = _load()
    pinned = [x for x in state["pinned"] if x != sid]
    archived = state["archived"] if sid in state["archived"] else state["archived"] + [sid]
    new = {"pinned": pinned, "archived": archived}
    _save(new)
    return new


def unarchive_session(sid: str) -> dict[str, Any]:
    state = _load()
    new = {"pinned": state["pinned"], "archived": [x for x in state["archived"] if x != sid]}
    _save(new)
    return new
