from __future__ import annotations

import contextlib
import json
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

DATA_DIR = os.getenv("DATA_DIR", "./data")

_domains: dict[str, StorageDomain] = {}
_listeners: set[Callable[[dict[str, Any]], None]] = set()
_caches: dict[str, dict[str, Any]] = {}


class StorageDomain:
    def __init__(self, name: str, schema: dict[str, Any]):
        self.name = name
        self.schema = schema

    def _file(self) -> Path:
        return Path(DATA_DIR) / "domains" / f"{self.name}.json"

    def _load(self) -> dict[str, Any]:
        if self.name in _caches:
            return _caches[self.name]
        store: dict[str, Any] = {}
        try:
            raw = self._file().read_text()
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                store.update(parsed)
        except (OSError, json.JSONDecodeError):
            pass
        _caches[self.name] = store
        return store

    def _persist(self, store: dict[str, Any]) -> None:
        f = self._file()
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(store, indent=2))
        os.replace(tmp, f)

    def get(self, key: str) -> Any:
        return self._load().get(key)

    def set(self, key: str, value: Any) -> None:
        # schema validation skipped for simplicity
        store = self._load()
        store[key] = value
        self._persist(store)
        for listener in list(_listeners):
            with contextlib.suppress(Exception):
                listener({"domain": self.name, "key": key, "value": value})

    def delete(self, key: str) -> bool:
        store = self._load()
        if key not in store:
            return False
        del store[key]
        self._persist(store)
        for listener in list(_listeners):
            with contextlib.suppress(Exception):
                listener({"domain": self.name, "key": key, "deleted": True})
        return True

    def list(self) -> list[Any]:
        return list(self._load().values())

    def keys(self) -> list[str]:
        return list(self._load().keys())


def on_domain_change(listener: Callable[[dict[str, Any]], None]) -> Callable[[], None]:
    _listeners.add(listener)
    return lambda: _listeners.discard(listener)


def declare_domain(name: str, schema: dict[str, Any] | None = None) -> StorageDomain:
    if name in _domains:
        return _domains[name]
    domain = StorageDomain(name, schema or {})
    _domains[name] = domain
    return domain


def domain(name: str) -> StorageDomain | None:
    return _domains.get(name)
