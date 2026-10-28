from __future__ import annotations

from .workspaces import realpath_normalize


def canonical_path(p: str) -> str:
    try:
        return realpath_normalize(p)
    except Exception:  # noqa: BLE001
        import os
        return os.path.abspath(p)


def members_of(sessions: list[dict], workspace_path: str) -> list[dict]:
    target = canonical_path(workspace_path)
    out = []
    for s in sessions:
        cwd = s.get("cwd")
        if not cwd:
            continue
        try:
            if canonical_path(cwd) == target:
                out.append(s)
        except Exception:  # noqa: BLE001, S110
            pass
    return out
