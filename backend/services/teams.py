from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from typing import Any

DATA_DIR = os.getenv("DATA_DIR", "./data")
DB_PATH = os.path.join(DATA_DIR, "teams.db")

_members: dict[str, dict[str, Any]] = {}
_member_subagents: dict[str, str] = {}


def _db():
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS team_tasks (
            id TEXT PRIMARY KEY,
            subject TEXT NOT NULL,
            description TEXT NOT NULL,
            status TEXT NOT NULL,
            owner_name TEXT,
            blocked_by TEXT NOT NULL DEFAULT '[]',
            write_scopes TEXT NOT NULL DEFAULT '[]',
            revision INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """)
    conn.commit()
    return conn


def _parse_list(v) -> list[str]:
    try:
        parsed = json.loads(v or "[]")
        return [str(x) for x in parsed] if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _row_to_task(row) -> dict[str, Any]:
    return {
        "id": row[0], "subject": row[1], "description": row[2], "status": row[3],
        "ownerName": row[4], "blockedBy": _parse_list(row[5]), "writeScopes": _parse_list(row[6]),
        "revision": row[7], "createdAt": row[8], "updatedAt": row[9],
    }


NO_ACTIVE_PEER_MESSAGE = "No other Team member is running or provisioning."


def lead_key(conv_id: str) -> str:
    return f"lead:{conv_id}"


def list_members(conv_id: str) -> list[dict[str, Any]]:
    out = []
    lead = _members.get(lead_key(conv_id))
    if lead:
        out.append(lead)
    for name, m in _members.items():
        if m.get("role") != "teammate":
            continue
        if name not in _member_subagents:
            continue
        out.append(m)
    return out


def get_member(name: str) -> dict[str, Any] | None:
    for m in _members.values():
        if m.get("name") == name:
            return m
    return None


def ensure_lead(conv_id: str) -> dict[str, Any]:
    key = lead_key(conv_id)
    if key in _members:
        return _members[key]
    lead = {"name": "lead", "description": "The agent that coordinates the team.", "role": "lead", "status": "running", "revision": 1, "createdAt": int(time.time()*1000)}
    _members[key] = lead
    return lead


def spawn_teammate(conv_id: str, name: str, description: str, parent_run_id: str | None = None) -> dict[str, Any]:
    existing = get_member(name)
    if existing and existing.get("role") == "teammate":
        raise ValueError(f'There is already a teammate called "{name}".')
    member = {"name": name, "description": description, "role": "teammate", "status": "running", "revision": 1, "createdAt": int(time.time()*1000)}
    _members[name] = member
    _member_subagents[name] = f"sub-{name}"
    member["subagentId"] = _member_subagents[name]
    return member


def send_to_member(name: str, message: str, conv_id: str | None = None, parent_run_id: str | None = None) -> dict[str, Any]:
    member = get_member(name)
    if not member:
        return {"delivered": False, "queued": False, "error": f'There is no member called "{name}".'}
    subagent_id = _member_subagents.get(name)
    if not subagent_id:
        return {"delivered": False, "queued": False, "error": "The lead cannot receive messages."}
    return {"delivered": True, "queued": False}


def interrupt_member(name: str) -> bool:
    member = get_member(name)
    if not member or member.get("role") != "teammate":
        return False
    member["status"] = "inactive"
    return True


def create_task(conv_id: str, subject: str, description: str, blocked_by: list[str] | None = None, write_scopes: list[str] | None = None, run_id: str | None = None) -> dict[str, Any]:
    conn = _db()
    tid = f"task-{uuid.uuid4().hex[:8]}"
    now = int(time.time() * 1000)
    conn.execute("INSERT INTO team_tasks (id, subject, description, status, owner_name, blocked_by, write_scopes, revision, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (tid, subject, description, "pending", None, json.dumps(blocked_by or []), json.dumps(write_scopes or []), 1, now, now))
    conn.commit()
    conn.close()
    return get_task(tid)


def get_task(task_id: str) -> dict[str, Any] | None:
    conn = _db()
    row = conn.execute("SELECT * FROM team_tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return _row_to_task(row)


def list_tasks(status=None, owner=None, ready=None, limit=50, offset=0) -> list[dict[str, Any]]:
    conn = _db()
    rows = conn.execute("SELECT * FROM team_tasks WHERE status != 'deleted' ORDER BY created_at ASC").fetchall()
    conn.close()
    tasks = [_row_to_task(r) for r in rows]
    if status:
        tasks = [t for t in tasks if t["status"] == status]
    if owner:
        tasks = [t for t in tasks if (owner == "unowned" and not t["ownerName"]) or t["ownerName"] == owner]
    if ready is not None:
        tasks = [t for t in tasks if is_task_ready(t) == ready]
    off = offset or 0
    lim = min(limit or 50, 100)
    return tasks[off:off+lim]


def is_task_ready(task: dict[str, Any]) -> bool:
    if task["status"] != "pending" or task.get("ownerName"):
        return False
    for bid in task.get("blockedBy", []):
        blocker = get_task(bid)
        if blocker and blocker["status"] != "completed":
            return False
    return True


def update_task(conv_id: str, task_id: str, expected_revision: int, action: str, subject: str | None = None, description: str | None = None, blocked_by: list | None = None, write_scopes: list | None = None, owner: str | None = None, run_id: str | None = None) -> dict[str, Any]:
    task = get_task(task_id)
    if not task:
        return {"ok": False, "error": f'There is no task called "{task_id}".'}
    if task["revision"] != expected_revision:
        return {"ok": False, "error": f'That task moved on: it is at revision {task["revision"]}, not {expected_revision}. Read it again.', "current": task}
    next_task = dict(task)
    next_task["revision"] = task["revision"] + 1
    next_task["updatedAt"] = int(time.time() * 1000)
    if action == "claim":
        if task.get("ownerName") and task["ownerName"] != owner:
            return {"ok": False, "error": f'"{task["ownerName"]}" already owns that task.', "current": task}
        next_task["ownerName"] = owner
        next_task["status"] = "in_progress"
    elif action == "release":
        next_task["ownerName"] = None
        next_task["status"] = "pending"
    elif action == "edit":
        if subject is not None:
            next_task["subject"] = subject
        if description is not None:
            next_task["description"] = description
        if write_scopes is not None:
            next_task["writeScopes"] = write_scopes
    elif action == "set_dependencies":
        next_task["blockedBy"] = blocked_by or []
    elif action == "complete":
        next_task["status"] = "completed"
    elif action == "reopen":
        next_task["status"] = "in_progress"
    elif action == "reassign":
        next_task["ownerName"] = owner
    elif action == "delete":
        next_task["status"] = "deleted"
    conn = _db()
    conn.execute("UPDATE team_tasks SET subject=?, description=?, status=?, owner_name=?, blocked_by=?, write_scopes=?, revision=?, updated_at=? WHERE id=?",
        (next_task["subject"], next_task["description"], next_task["status"], next_task["ownerName"], json.dumps(next_task["blockedBy"]), json.dumps(next_task["writeScopes"]), next_task["revision"], next_task["updatedAt"], next_task["id"]))
    conn.commit()
    conn.close()
    return {"ok": True, "task": next_task}


def active_member_count(conv_id: str) -> int:
    return len([m for m in list_members(conv_id) if m.get("status") in ("running", "provisioning")])


def reap_members(max_age_ms: int = 60 * 60 * 1000) -> int:
    now = int(time.time() * 1000)
    removed = 0
    for name in list(_members.keys()):
        m = _members[name]
        if m.get("role") != "teammate":
            continue
        if now - m.get("createdAt", 0) < max_age_ms:
            continue
        del _members[name]
        _member_subagents.pop(name, None)
        removed += 1
    return removed
