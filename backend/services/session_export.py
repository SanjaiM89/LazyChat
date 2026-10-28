from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any

from .zip_util import build_zip


def build_session_archive(conversation_id: str, title: str | None = None, messages: list | None = None, events: list[dict] | None = None) -> dict[str, Any]:
    title = (title or "").strip() or "session"
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "-", title).strip("-") or "session"
    stamp = datetime.now(UTC).date().isoformat()
    events = events or []
    jsonl = "\n".join(json.dumps({"seq": e.get("seq"), "type": e.get("type"), "run_id": e.get("run_id"), "created_at": e.get("created_at"), "data": e.get("data")}) for e in events)
    transcript_text = _transcript(conversation_id, title, events)
    entries = [
        {"name": "session.json", "data": json.dumps({"conversation_id": conversation_id, "title": title, "messages": messages or []}, indent=2)},
        {"name": "events.jsonl", "data": jsonl},
        {"name": "transcript.md", "data": transcript_text},
    ]
    data = build_zip(entries)
    return {"data": data, "filename": f"{safe}-{stamp}.zip", "entries": [e["name"] for e in entries]}


def _transcript(conversation_id: str, title: str, events: list[dict]) -> str:
    lines = [f"# {title}", "", f"Conversation: {conversation_id}", ""]
    for ev in events:
        d = ev.get("data") or {}
        if not isinstance(d, dict):
            d = {}
        if ev.get("type") == "user/message":
            lines += ["## You", "", str(d.get("text", "")), ""]
        elif ev.get("type") == "assistant/message":
            lines += ["## Assistant", "", str(d.get("text", "")), ""]
        elif ev.get("type") == "tool/call":
            lines += [f"### Tool: {d.get('tool') or d.get('name') or 'tool'}", "", "```json", json.dumps(d.get("input", {}), indent=2), "```", ""]
        elif ev.get("type") == "tool/result":
            lines += [f"### Result: {d.get('tool') or d.get('name') or 'tool'} ({d.get('status', 'completed')})", ""]
    return "\n".join(lines)
