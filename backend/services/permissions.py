from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PermissionSettings:
    mode: str = "workspace-write"
    policy: str = "ask"


DEFAULT_PERMISSIONS = PermissionSettings(mode="workspace-write", policy="ask")
