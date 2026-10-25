from __future__ import annotations

import os
from typing import Any


class SessionDirectory:
    def __init__(self, initial: str):
        self._cwd = usable_directory(initial)

    @property
    def cwd(self) -> str:
        return self._cwd

    def set(self, dir_path: str) -> dict[str, Any]:
        resolved = os.path.realpath(os.path.join(self._cwd, dir_path)) if not os.path.isabs(dir_path) else os.path.realpath(dir_path)
        # simpler: resolve
        resolved = os.path.abspath(os.path.join(self._cwd, dir_path))
        if not os.path.isdir(resolved):
            return {"error": f"cannot enter '{dir_path}': {resolved} does not exist."}
        try:
            self._cwd = os.path.realpath(resolved)
        except OSError:
            self._cwd = resolved
        return {"cwd": self._cwd}

    def read(self) -> dict[str, Any]:
        return {"cwd": self._cwd}


def usable_directory(dir_path: str) -> str:
    try:
        if os.path.isdir(dir_path):
            return os.path.realpath(dir_path)
    except OSError:
        pass
    return os.getcwd()
