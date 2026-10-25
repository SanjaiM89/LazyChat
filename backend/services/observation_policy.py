from __future__ import annotations

import os
from typing import Any

_observations: dict[str, dict[str, Any]] = {}
MAX_SESSIONS = 512


def version_of(target: str) -> str | None:
    try:
        st = os.stat(target)
        if not os.path.isfile(target):
            return None
        return f"{st.st_size}:{int(st.st_mtime * 1000)}"
    except OSError:
        return None


def _bucket(owner: str) -> dict[str, Any]:
    if owner not in _observations:
        _observations[owner] = {}
        while len(_observations) > MAX_SESSIONS:
            oldest = next(iter(_observations))
            del _observations[oldest]
    return _observations[owner]


def record_observation(owner: str, target: str) -> dict[str, Any]:
    version = version_of(target)
    obs = {"kind": "present", "version": version} if version else {"kind": "absent"}
    _bucket(owner)[target] = obs
    return obs


def observation_of(owner: str, target: str) -> dict[str, Any] | None:
    return _observations.get(owner, {}).get(target)


def clear_observations(owner: str) -> None:
    _observations.pop(owner, None)


def guard_write(owner: str, target: str) -> dict[str, Any]:
    version = version_of(target)
    if version is None:
        seen = observation_of(owner, target)
        if seen and seen.get("kind") == "present":
            return {"ok": False, "code": "FS_STALE_VERSION", "reason": f'cannot modify "{target}": the file appeared since it was read'}
        return {"ok": True}
    seen = observation_of(owner, target)
    if not seen:
        return {"ok": False, "code": "FS_NOT_OBSERVED", "reason": f'cannot modify "{target}": file has not been read — read the file, then retry'}
    if seen.get("kind") == "absent":
        return {"ok": False, "code": "FS_STALE_VERSION", "reason": f'cannot modify "{target}": the file appeared since it was read'}
    if seen.get("version") != version:
        return {"ok": False, "code": "FS_STALE_VERSION", "reason": f'cannot modify "{target}": the file changed since it was read — read the file, then retry'}
    return {"ok": True}


def guard_edit(owner: str, target: str) -> dict[str, Any]:
    seen = observation_of(owner, target)
    if not seen:
        return {"ok": False, "code": "FS_NOT_OBSERVED", "reason": f'cannot modify "{target}": file has not been read — read the file, then retry'}
    if seen.get("kind") == "absent":
        return {"ok": False, "code": "FS_NOT_FOUND", "reason": f'cannot modify "{target}": the file was read as missing'}
    version = version_of(target)
    if version is None or version != seen.get("version"):
        return {"ok": False, "code": "FS_STALE_VERSION", "reason": f'cannot modify "{target}": the file changed since it was read — read the file, then retry'}
    return {"ok": True}
