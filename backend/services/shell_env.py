from __future__ import annotations

import os
from typing import Any

DATA_DIR = os.getenv("DATA_DIR", "./data")
_contributors: dict[str, dict[str, Any]] = {}
_key_owners: dict[str, str] = {}


def register_contributor(name: str, variables: dict[str, dict[str, str]], resolve) -> None:
    if name in _contributors:
        raise ValueError(f"shell environment contributor '{name}' is already registered")
    for key in variables:
        if not key.startswith("DSH_"):
            raise ValueError(f"shell environment key '{key}' is not in the DSH_ namespace")
        if key in _key_owners:
            raise ValueError(f"shell environment key '{key}' is already owned by '{_key_owners[key]}'")
    for key in variables:
        _key_owners[key] = name
    _contributors[name] = {"name": name, "variables": variables, "resolve": resolve}


def collect(execution: dict[str, Any] | None = None) -> dict[str, str]:
    execution = execution or {}
    env: dict[str, str] = {}
    for name, c in _contributors.items():
        resolved = c["resolve"](execution)
        for key, val in resolved.items():
            if key not in c["variables"]:
                raise ValueError(f"undeclared key '{key}' from '{name}'")
            if not isinstance(val, str):
                raise TypeError(f"non-string value for {key}")
            if key in env:
                raise ValueError(f"duplicate key '{key}'")
            env[key] = val
    return env
