from __future__ import annotations

import json
import os

DATA_DIR = os.getenv("DATA_DIR", "./data")


def record_feedback(conversation_id: str, message_id: str, rating: str, comment: str | None = None) -> None:
    d = os.path.join(DATA_DIR, "feedback")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "feedback.jsonl")
    rec = {"conversation_id": conversation_id, "message_id": message_id, "rating": rating, "comment": comment}
    with open(path, "a") as f:
        f.write(json.dumps(rec) + "\n")
