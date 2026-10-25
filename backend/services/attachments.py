from __future__ import annotations

import os
import uuid
from typing import Any

DATA_DIR = os.getenv("DATA_DIR", "./data")


def detect_mime_type(data: bytes) -> str | None:
    if len(data) >= 8 and data[:8] == bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]):
        return "image/png"
    if len(data) >= 3 and data[0] == 0xFF and data[1] == 0xD8 and data[2] == 0xFF:
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if len(data) >= 6 and data[:6].startswith(b"GIF8"):
        return "image/gif"
    if len(data) >= 2 and data[0] == 0x50 and data[1] == 0x4B:
        return "application/zip"
    if len(data) >= 4 and data[:4] == b"%PDF":
        return "application/pdf"
    return None


IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]


def store_attachment(name: str, mime_type: str | None, data: bytes) -> dict[str, Any]:
    detected = detect_mime_type(data)
    claimed = (mime_type or "").split(";")[0].strip()
    if claimed in IMAGE_MIME_TYPES and (not detected or detected != claimed):
        raise ValueError(f'The file "{name}" claims to be {claimed} but its bytes say {detected or "something else"}.')
    att_id = f"att_{uuid.uuid4().hex[:16]}"
    dir_path = os.path.join(DATA_DIR, "attachments")
    os.makedirs(dir_path, exist_ok=True)
    fpath = os.path.join(dir_path, att_id)
    with open(fpath, "wb") as f:
        f.write(data)
    return {
        "id": att_id,
        "name": name,
        "mime_type": mime_type or (detected or "application/octet-stream"),
        "bytes": len(data),
        "created_at": int(__import__("time").time() * 1000),
        "verified": detected is not None,
    }
