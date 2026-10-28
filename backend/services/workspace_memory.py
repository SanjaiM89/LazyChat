from __future__ import annotations

import hashlib
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from core.logging import get_logger

from .graph import FalkorClient

logger = get_logger("workspace_memory")


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def uid(prefix: str) -> str:
    return f"{prefix}:{uuid.uuid4().hex[:8]}{int(datetime.now().timestamp()) % 10000}"


def redact_secrets(text: str) -> str:
    patterns = [
        (re.compile(r"sk-[A-Za-z0-9]{20,}"), "sk-***"),
        (re.compile(r"ghp_[A-Za-z0-9]{20,}"), "ghp_***"),
        (re.compile(r"AKIA[0-9A-Z]{16}"), "AKIA***"),
    ]
    for pat, repl in patterns:
        text = pat.sub(repl, text)
    return text


def content_id(scope: str, kind: str, text: str) -> str:
    h = hashlib.sha256(f"{scope}|{kind}|{text}".encode()).hexdigest()[:16]
    return f"mem:{h}"


def row_to_memory(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r.get("id"),
        "scope": r.get("scope") or "global",
        "kind": r.get("kind") or "note",
        "text": r.get("text") or "",
        "slot": r.get("slot"),
        "tags": r.get("tags") if isinstance(r.get("tags"), list) else [],
        "use_count": int(r.get("use_count") or 0),
        "created_at": r.get("created_at") or "",
        "updated_at": r.get("updated_at") or "",
    }


async def store_shared(client: FalkorClient, scope: str, kind: str, text: str, slot: str | None = None, tags: list[str] | None = None) -> dict[str, Any]:
    text = redact_secrets(text).strip()[:4000]
    if not text:
        raise ValueError("Cannot store empty memory.")
    kind = (kind or "note").strip().lower()[:40] or "note"
    slot = (slot or "").strip() or None
    tags = [(t or "").strip().lower() for t in (tags or [])]
    tags = [t for t in tags if t][:12]
    ts = now_iso()
    mid = content_id(scope, kind, text)
    dupe = await client.query("MATCH (m:SharedMemory {id: $id}) RETURN m.id AS id LIMIT 1", {"id": mid})
    if dupe:
        await client.write("MATCH (m:SharedMemory {id: $id}) SET m.use_count = coalesce(m.use_count, 0) + 1, m.updated_at = $ts", {"id": mid, "ts": ts})
        rows = await client.query(
            "MATCH (m:SharedMemory {id: $id}) RETURN m.id AS id, m.scope AS scope, m.kind AS kind, m.text AS text, m.slot AS slot, m.tags AS tags, m.use_count AS use_count, m.created_at AS created_at, m.updated_at AS updated_at LIMIT 1",
            {"id": mid},
        )
        return row_to_memory(rows[0]) if rows else {}
    if slot:
        conflicts = await client.query("MATCH (m:SharedMemory) WHERE m.scope = $scope AND m.slot = $slot AND m.id <> $id RETURN m.id AS id", {"scope": scope, "slot": slot, "id": mid})
        await client.write(
            "MERGE (m:SharedMemory {id: $id}) SET m.scope = $scope, m.kind = $kind, m.text = $text, m.slot = $slot, m.tags = $tags, m.use_count = 0, m.created_at = $ts, m.updated_at = $ts",
            {"id": mid, "scope": scope, "kind": kind, "text": text, "slot": slot, "tags": tags, "ts": ts},
        )
        for c in conflicts:
            await client.write("MATCH (old:SharedMemory {id: $old}), (new:SharedMemory {id: $new}) MERGE (old)-[:REPLACED_BY]->(new)", {"old": c["id"], "new": mid})
    else:
        await client.write(
            "MERGE (m:SharedMemory {id: $id}) SET m.scope = $scope, m.kind = $kind, m.text = $text, m.slot = $slot, m.tags = $tags, m.use_count = 0, m.created_at = $ts, m.updated_at = $ts",
            {"id": mid, "scope": scope, "kind": kind, "text": text, "slot": slot, "tags": tags, "ts": ts},
        )
    rows = await client.query(
        "MATCH (m:SharedMemory {id: $id}) RETURN m.id AS id, m.scope AS scope, m.kind AS kind, m.text AS text, m.slot AS slot, m.tags AS tags, m.use_count AS use_count, m.created_at AS created_at, m.updated_at AS updated_at LIMIT 1",
        {"id": mid},
    )
    return row_to_memory(rows[0]) if rows else {}


async def recall_shared(client: FalkorClient, workspace_id: str, query: str = "", limit: int = 12) -> list[dict[str, Any]]:
    import os as _os
    user = _os.getenv("LAZYCHAT_USER", "")
    global_scope = f"global:{user}" if user else "global"
    scopes = [global_scope, f"workspace:{workspace_id}"]
    rows = await client.query(
        "MATCH (m:SharedMemory) WHERE m.scope IN $scopes RETURN m.id AS id, m.scope AS scope, m.kind AS kind, m.text AS text, m.slot AS slot, m.tags AS tags, m.use_count AS use_count, m.created_at AS created_at, m.updated_at AS updated_at ORDER BY m.updated_at DESC LIMIT 200",
        {"scopes": scopes},
    )
    terms = {w for w in __import__("re").split(r"\s+", query.lower()) if len(w) > 3}
    scored = []
    for r in rows:
        mem = row_to_memory(r)
        hay = f"{mem['text']} {' '.join(mem['tags'])} {mem['kind']}".lower()
        overlap = sum(1 for t in terms if t in hay)
        score = overlap + (0.1 if str(mem["scope"]).startswith("global") else 0)
        scored.append({"mem": mem, "score": score})
    scored.sort(key=lambda x: x["score"], reverse=True)
    relevant = [s for s in scored if s["score"] > 0.1]
    picked = (relevant if relevant else scored)[:limit]
    picked_mems = [p["mem"] for p in picked]
    if picked_mems:
        await client.write("MATCH (m:SharedMemory) WHERE m.id IN $ids SET m.use_count = coalesce(m.use_count, 0) + 1", {"ids": [m["id"] for m in picked_mems]})
    return picked_mems


async def update_shared(client: FalkorClient, mem_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    sets = ["m.updated_at = $ts"]
    params: dict[str, Any] = {"id": mem_id, "ts": now_iso()}
    if patch.get("text") is not None:
        sets.append("m.text = $text")
        params["text"] = redact_secrets(patch["text"]).strip()[:4000]
    if patch.get("tags") is not None:
        sets.append("m.tags = $tags")
        params["tags"] = [t.strip().lower() for t in patch["tags"] if t.strip()][:12]
    await client.write(f"MATCH (m:SharedMemory {{id: $id}}) SET {', '.join(sets)}", params)
    rows = await client.query(
        "MATCH (m:SharedMemory {id: $id}) RETURN m.id AS id, m.scope AS scope, m.kind AS kind, m.text AS text, m.slot AS slot, m.tags AS tags, m.use_count AS use_count, m.created_at AS created_at, m.updated_at AS updated_at LIMIT 1",
        {"id": mem_id},
    )
    return row_to_memory(rows[0]) if rows else None


async def delete_shared(client: FalkorClient, mem_id: str) -> bool:
    rows = await client.query("MATCH (m:SharedMemory {id: $id}) DETACH DELETE m RETURN 1 AS n", {"id": mem_id})
    return len(rows) > 0

async def build_memory_context(client, workspace_id: str, max_chars: int = 6000) -> str:
    parts = []
    shared = await recall_shared(client, workspace_id, "", 12)
    if shared:
        parts.append("## Shared memory (applies across workspaces)\n" + "\n".join(f"- [{m.get('kind')}] {(m.get('text') or '')[:300]}" for m in shared))
    for kind in ["summary", "decision", "plan", "error", "preference"]:
        # read workspace records - best effort
        try:
            rows = await client.query("MATCH (n) WHERE n.workspace_id = $wid AND labels(n)[0] CONTAINS $kind RETURN properties(n) AS n ORDER BY n.updated_at DESC LIMIT 6", {"wid": workspace_id, "kind": kind})
        except Exception:
            rows = []
        recs = [r.get("n") for r in rows if isinstance(r.get("n"), dict)]
        if not recs:
            continue
        lines = []
        for s in recs:
            text = s.get("summary") or s.get("body") or s.get("text") or s.get("title") or ""
            title = f"{s.get('title')}: " if isinstance(s.get("title"), str) and text != s.get("title") else ""
            extra = f" Fix: {str(s.get('fix'))[:200]}" if kind == "error" and s.get("fix") else ""
            pref = f"{s.get('key')}: " if kind == "preference" and s.get("key") else ""
            lines.append(f"- {pref}{title}{str(text)[:300]}{extra}")
        parts.append(f"## Workspace {kind}s\n" + "\n".join(lines))
    joined = "\n\n".join(parts)[:max_chars]
    return ("## Relevant memory (loaded automatically: shared global + this workspace)\n" + joined) if joined else ""


async def add_todo(client, workspace_id: str, text: str) -> dict[str, Any]:
    existing = await client.query("MATCH (t:Todo) WHERE t.workspace_id = $wid RETURN count(t) AS n", {"wid": workspace_id})
    n = int((existing[0].get("n") if existing else 0) or 0)
    tid = uid("todo") if False else __import__("uuid").uuid4().hex[:8]
    ts = now_iso()
    await client.write(
        "CREATE (t:Todo {id: $id, workspace_id: $wid, text: $text, status: 'open', sort: $sort, created_at: $ts, updated_at: $ts}) WITH t MATCH (w:Workspace {id: $wid}) MERGE (t)-[:IN_WORKSPACE]->(w)",
        {"id": tid, "wid": workspace_id, "text": redact_secrets(text)[:2000], "sort": n, "ts": ts},
    )
    return {"id": tid, "workspace_id": workspace_id, "text": text, "status": "open", "sort": 0, "created_at": ts, "updated_at": ts}


async def set_todo_status(client, todo_id: str, status: str) -> None:
    await client.write("MATCH (t:Todo {id: $id}) SET t.status = $status, t.updated_at = $ts", {"id": todo_id, "status": status, "ts": now_iso()})


async def list_todos(client, workspace_id: str) -> list[dict[str, Any]]:
    rows = await client.query("MATCH (t:Todo) WHERE t.workspace_id = $wid RETURN t.id AS id, t.text AS text, t.status AS status, t.sort AS sort, t.created_at AS created_at, t.updated_at AS updated_at ORDER BY t.sort ASC", {"wid": workspace_id})
    out = []
    for r in rows:
        st = r.get("status")
        out.append({"id": r.get("id"), "workspace_id": workspace_id, "text": r.get("text") or "", "status": "doing" if st == "doing" else ("done" if st == "done" else "open"), "sort": int(r.get("sort") or 0), "created_at": r.get("created_at") or "", "updated_at": r.get("updated_at") or ""})
    return out


async def record_command_run(client, workspace_id: str, command: str, output: str, exit_code: int, duration_ms: int, session_id: str | None = None, run_id: str | None = None) -> str:
    import uuid as _u
    MAX = 8000
    kept = output or ""
    if len(kept) > MAX:
        kept = kept[:4000] + f"\n... [{len(kept)-8000} chars cut] ...\n" + kept[-4000:]
    rid = _u.uuid4().hex[:8]
    ts = now_iso()
    await client.write("CREATE (n:CommandRun {id: $id}) SET n.workspace_id = $wid, n.command = $cmd, n.output = $out, n.exit_code = $ec, n.duration_ms = $dm, n.run_id = $runid, n.created_at = $ts, n.updated_at = $ts", {"id": rid, "wid": workspace_id, "cmd": redact_secrets(command)[:2000], "out": redact_secrets(kept), "ec": exit_code, "dm": duration_ms, "runid": run_id or "", "ts": ts})
    return rid


async def recent_commands(client, workspace_id: str, limit: int = 20) -> list[dict[str, Any]]:
    rows = await client.query("MATCH (n:CommandRun) WHERE n.workspace_id = $wid RETURN n ORDER BY n.created_at DESC LIMIT $limit", {"wid": workspace_id, "limit": limit})
    out = []
    for r in rows:
        n = r.get("n") if isinstance(r.get("n"), dict) else r
        out.append({"id": n.get("id"), "workspace_id": workspace_id, "command": n.get("command") or "", "exit_code": n.get("exit_code"), "output": n.get("output") or "", "started_at": n.get("created_at") or "", "duration_ms": n.get("duration_ms")})
    return out


RECORD_LABELS = {
    "plan": "WorkspacePlan", "decision": "WorkspaceDecision", "change": "CodeChange",
    "command": "CommandRun", "error": "ErrorFix", "dependency": "Dependency",
    "todo": "Todo", "preference": "WsPreference", "link": "WsLink", "summary": "SessionSummary",
}


async def write_workspace_record(client, workspace_id: str, kind: str, data: dict, session_id: str | None = None) -> str:
    import uuid as _u
    label = RECORD_LABELS.get(kind, "WorkspaceRecord")
    rid = f"wr:{_u.uuid4().hex[:8]}"
    ts = now_iso()
    clean = {}
    for k, v in (data or {}).items():
        clean[k] = redact_secrets(v)[:20000] if isinstance(v, str) else v
    await client.write(
        f"CREATE (n:{label} {{id: $id}}) SET n += $props, n.workspace_id = $wid, n.created_at = $ts, n.updated_at = $ts WITH n MATCH (w:Workspace {{id: $wid}}) MERGE (n)-[:IN_WORKSPACE]->(w)",
        {"id": rid, "props": clean, "wid": workspace_id, "ts": ts},
    )
    if session_id:
        await client.write("MATCH (n {id: $id}), (s:AgentSession {id: $sid}) MERGE (n)-[:RECORDED_IN]->(s)", {"id": rid, "sid": session_id})
    return rid


async def read_workspace_records(client, workspace_id: str, kind: str, limit: int = 50) -> list[dict]:
    label = RECORD_LABELS.get(kind, "WorkspaceRecord")
    rows = await client.query(f"MATCH (n:{label}) WHERE n.workspace_id = $wid RETURN properties(n) AS n ORDER BY n.updated_at DESC, n.created_at DESC LIMIT $limit", {"wid": workspace_id, "limit": limit})
    return [r.get("n") for r in rows if isinstance(r.get("n"), dict)]
