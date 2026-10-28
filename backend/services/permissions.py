from __future__ import annotations

from dataclasses import dataclass

from .catalog import tool_effect as _catalog_effect

SandboxMode = str
ApprovalPolicy = str

DEFAULT_PERMISSIONS = None


@dataclass
class PermissionSettings:
    mode: str = "workspace-write"
    policy: str = "ask"


DEFAULT_PERMISSIONS = PermissionSettings(mode="workspace-write", policy="ask")


@dataclass
class PresetEntry:
    name: str
    label: str
    description: str
    mode: str
    policy: str


PERMISSION_PRESET_TABLE: list[PresetEntry] = [
    PresetEntry(name="read-only", label="Read only", description="Nothing may change.", mode="read-only", policy="ask"),
    PresetEntry(name="workspace-write", label="Workspace", description="May write inside the session's folder; commands need approval.", mode="workspace-write", policy="ask"),
    PresetEntry(name="workspace-write-never", label="Workspace, no prompts", description="May write inside the session's folder; commands are refused rather than asked about.", mode="workspace-write", policy="never"),
    PresetEntry(name="danger-full-access", label="Full access", description="May run commands and agents without asking.", mode="danger-full-access", policy="never"),
]

DEFAULT_PRESET = "workspace-write"
RESERVED_PRESET_NAMES = ["custom", "auto"]
ADAPTIVE_PRESET = "adaptive"


def adaptive_settings(has_workspace: bool) -> PermissionSettings:
    return PermissionSettings(mode="workspace-write" if has_workspace else "read-only", policy="ask")


def preset_matching(settings: PermissionSettings) -> PresetEntry | None:
    for e in PERMISSION_PRESET_TABLE:
        if e.mode == settings.mode and e.policy == settings.policy:
            return e
    return None


@dataclass
class CurrentPreset:
    name: str
    entry: PresetEntry | None
    settings: PermissionSettings


def current_preset(settings: PermissionSettings, recorded: str | None = None, has_workspace: bool = False) -> CurrentPreset:
    if recorded == ADAPTIVE_PRESET:
        adaptive = adaptive_settings(has_workspace)
        if adaptive.mode == settings.mode and adaptive.policy == settings.policy:
            return CurrentPreset(name=ADAPTIVE_PRESET, entry=None, settings=settings)
    if recorded:
        entry = next((e for e in PERMISSION_PRESET_TABLE if e.name == recorded), None)
        if entry and entry.mode == settings.mode and entry.policy == settings.policy:
            return CurrentPreset(name=entry.name, entry=entry, settings=settings)
    matching = preset_matching(settings)
    if matching:
        return CurrentPreset(name=matching.name, entry=matching, settings=settings)
    return CurrentPreset(name="custom", entry=None, settings=settings)


def preset_options(has_workspace: bool = False) -> list[dict]:
    return [{"name": ADAPTIVE_PRESET, "label": "Adaptive", "description": "Read only until a folder is attached."}] + [
        {"name": e.name, "label": e.label, "description": e.description} for e in PERMISSION_PRESET_TABLE
    ]


def apply_preset(name: str, has_workspace: bool = False) -> PermissionSettings | None:
    if name == ADAPTIVE_PRESET:
        return adaptive_settings(has_workspace)
    entry = next((e for e in PERMISSION_PRESET_TABLE if e.name == name), None)
    if not entry:
        return None
    return PermissionSettings(mode=entry.mode, policy=entry.policy)


def tool_effect(tool_name: str) -> str:
    return _catalog_effect(tool_name)


def decide_permission(tool_name: str, settings: PermissionSettings) -> dict:
    effect = tool_effect(tool_name)
    mode = settings.mode
    policy = settings.policy
    if effect in ("read", "network"):
        return {"outcome": "allow", "reason": "", "effect": effect}
    if mode == "danger-full-access":
        return {"outcome": "allow", "reason": "", "effect": effect}
    if mode == "read-only":
        return {"outcome": "deny", "reason": f'This session is read-only, so "{tool_name}" is not allowed.', "effect": effect}
    if effect == "write":
        return {"outcome": "allow", "reason": "", "effect": effect}
    if policy == "never":
        return {"outcome": "deny", "reason": f'The approval policy is "never", so "{tool_name}" cannot ask for permission and was not run.', "effect": effect}
    return {"outcome": "ask", "reason": f'Run "{tool_name}" on this machine?' if effect == "exec" else f'Start "{tool_name}"?', "effect": effect}


def describe_permissions(settings: PermissionSettings) -> str:
    if settings.mode == "read-only":
        return "Read only"
    if settings.mode == "workspace-write":
        return "Workspace" if settings.policy == "never" else "Workspace (ask)"
    if settings.mode == "danger-full-access":
        return "Full access"
    return "Custom"


def describe_preset(preset: CurrentPreset) -> str:
    if preset.name == "custom":
        return "Custom"
    if preset.name == ADAPTIVE_PRESET:
        return "Adaptive"
    return preset.entry.label if preset.entry else preset.name
