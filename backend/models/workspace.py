from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class WorkspaceStatus(str, Enum):
    active = "active"
    archived = "archived"


class WorkspaceDirStatus(str, Enum):
    ok = "ok"
    missing_dir = "missing-dir"


class Workspace(BaseModel):
    id: str
    title: str
    path: str
    description: str = ""
    owner: str = ""
    tags: list[str] = Field(default_factory=list)
    status: WorkspaceStatus = WorkspaceStatus.active
    dir_status: WorkspaceDirStatus = WorkspaceDirStatus.ok
    position: int = 0
    created_at: str = ""
    updated_at: str = ""


class MemoryRecord(BaseModel):
    id: str
    scope: str
    kind: str
    text: str
    slot: str | None = None
    tags: list[str] = Field(default_factory=list)
    use_count: int = 0
    created_at: str = ""
    updated_at: str = ""


class TodoStatus(str, Enum):
    open = "open"
    doing = "doing"
    done = "done"


class TodoItem(BaseModel):
    id: str
    workspace_id: str
    text: str
    status: TodoStatus = TodoStatus.open
    sort: int = 0
    created_at: str = ""
    updated_at: str = ""


class CommandRun(BaseModel):
    id: str
    workspace_id: str
    session_id: str | None = None
    run_id: str | None = None
    command: str
    exit_code: int | None = None
    output: str | None = None
    started_at: str = ""
    duration_ms: int | None = None


class AgentSessionStatus(str, Enum):
    running = "running"
    ended = "ended"
    failed = "failed"


class AgentSession(BaseModel):
    id: str
    workspace_id: str
    goal: str = ""
    status: AgentSessionStatus = AgentSessionStatus.running
    hidden: bool = False
    started_at: str = ""
    ended_at: str | None = None


class AgentRunStatus(str, Enum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"
    stopped = "stopped"


class AgentRun(BaseModel):
    id: str
    workspace_id: str
    session_id: str
    task: str
    status: AgentRunStatus = AgentRunStatus.queued
    pid: int | None = None
    exit_code: int | None = None
    started_at: str = ""
    ended_at: str | None = None