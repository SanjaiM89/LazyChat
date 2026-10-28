from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any

from ..core.logging import get_logger

logger = get_logger("schedules")

SCHEDULES_FILE = "schedules.json"
PENDING_FILE = "pending-reminders.json"


def _path(name: str) -> str:
    return os.path.join(os.getenv("DATA_DIR", "./data"), name)


def _load(name: str) -> list[Any]:
    p = _path(name)
    if not os.path.exists(p):
        return []
    try:
        return json.load(open(p))
    except Exception:
        return []


def _save(name: str, data: Any) -> None:
    p = _path(name)
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    with open(p, "w") as f:
        json.dump(data, f, indent=2)


def load_schedules() -> list[dict[str, Any]]:
    return _load(SCHEDULES_FILE)


def save_schedules(schedules: list[dict[str, Any]]) -> None:
    _save(SCHEDULES_FILE, schedules)


def get_pending_reminders(conversation_id: str | None = None) -> list[dict[str, Any]]:
    pending = _load(PENDING_FILE)
    if conversation_id:
        return [r for r in pending if r.get("conversationId") == conversation_id]
    return pending


def clear_pending_reminder(reminder_id: str) -> None:
    pending = _load(PENDING_FILE)
    _save(PENDING_FILE, [r for r in pending if r.get("id") != reminder_id])


def compute_next_delivery(timing: dict[str, Any], now_ms: int) -> int:
    kind = timing.get("kind")
    if kind == "once":
        return timing.get("at", now_ms)
    if kind == "every":
        interval = timing.get("everySeconds", 60) * 1000
        elapsed = (now_ms - timing.get("from", now_ms)) % interval
        return now_ms + (interval - elapsed)
    if kind in ("daily", "weekly"):
        # Simplified: next midnight-ish
        return now_ms + 24 * 60 * 60 * 1000
    if kind == "cron":
        return now_ms + 60 * 60 * 1000
    return now_ms


def create_schedule(conv_id: str | None, title: str, prompt: str, timing: dict[str, Any]) -> dict[str, Any]:
    now = int(time.time() * 1000)
    sched = {
        "id": uuid.uuid4().hex[:10],
        "conversationId": conv_id,
        "title": title,
        "prompt": prompt,
        "timing": timing,
        "nextDelivery": compute_next_delivery(timing, now),
        "deliveryCount": 0,
        "active": True,
        "createdAt": now,
        "updatedAt": now,
    }
    schedules = load_schedules()
    schedules.append(sched)
    save_schedules(schedules)
    return sched
