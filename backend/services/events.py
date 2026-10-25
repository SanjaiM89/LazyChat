from __future__ import annotations

import json
import os
import time
from typing import Any

DATA_DIR = os.getenv("DATA_DIR", "./data")


def append_event(event_type: str, data: Any, ctx: dict[str, Any] | None = None) -> None:
    ctx = ctx or {}
    conv_id = ctx.get("conversationId", "default")
    d = os.path.join(DATA_DIR, "events", conv_id.replace("/", "_"))
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "events.jsonl")
    record = {"type": event_type, "data": data, "ts": int(time.time() * 1000), "run_id": ctx.get("runId")}
    with open(path, "a") as f:
        f.write(json.dumps(record) + "\n")


def list_events(conv_id: str, limit: int = 2000) -> list[dict[str, Any]]:
    path = os.path.join(DATA_DIR, "events", conv_id.replace("/", "_"), "events.jsonl")
    if not os.path.exists(path):
        return []
    out = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return out[-limit:]
