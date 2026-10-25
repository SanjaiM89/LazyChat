from __future__ import annotations

import time
import uuid
from typing import Any

_members: dict[str, list[dict[str, Any]]] = {}
_tasks: dict[str, list[dict[str, Any]]] = {}


def create_team(team_id: str) -> dict[str, Any]:
    if team_id not in _members:
        _members[team_id] = []
        _tasks[team_id] = []
    return {"team_id": team_id, "members": _members[team_id], "tasks": _tasks[team_id]}


def add_member(team_id: str, name: str, description: str = "", role: str = "teammate") -> dict[str, Any]:
    create_team(team_id)
    m = {"name": name, "description": description, "role": role, "status": "inactive", "revision": 1, "createdAt": int(time.time()*1000)}
    _members[team_id].append(m)
    return m


def add_task(team_id: str, subject: str, description: str = "") -> dict[str, Any]:
    create_team(team_id)
    t = {"id": uuid.uuid4().hex[:8], "subject": subject, "description": description, "status": "pending", "ownerName": None, "blockedBy": [], "writeScopes": [], "revision": 1, "createdAt": int(time.time()*1000), "updatedAt": int(time.time()*1000)}
    _tasks[team_id].append(t)
    return t


def list_tasks(team_id: str) -> list[dict[str, Any]]:
    create_team(team_id)
    return _tasks[team_id]


def update_task(team_id: str, task_id: str, status: str | None = None, owner: str | None = None) -> dict[str, Any] | None:
    create_team(team_id)
    for t in _tasks[team_id]:
        if t["id"] == task_id:
            if status:
                t["status"] = status
            if owner is not None:
                t["ownerName"] = owner
            t["revision"] += 1
            t["updatedAt"] = int(time.time()*1000)
            return t
    return None
