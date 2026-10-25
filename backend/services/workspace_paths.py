from __future__ import annotations

import os
from pathlib import Path


def fully_qualified_workspace_path(candidate: str) -> bool:
    return os.path.isabs(candidate)


def realpath_normalize(candidate: str) -> str:
    if not fully_qualified_workspace_path(candidate):
        raise TypeError(f"Workspace path is not fully qualified: '{candidate}'")
    return str(Path(candidate).resolve(strict=True))


def default_workspace_title(candidate: str) -> str:
    base = os.path.basename(candidate.rstrip("/"))
    return base if base else os.path.splitdrive(candidate)[1] or candidate


def workspace_dir_status(path: str) -> str:
    try:
        return "ok" if Path(path).is_dir() else "missing-dir"
    except OSError:
        return "missing-dir"