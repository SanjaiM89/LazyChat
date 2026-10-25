from __future__ import annotations

import io
import zipfile
from typing import Any


def build_zip(entries: list[dict[str, Any]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for e in entries:
            name = e.get("name", "")
            data = e.get("data", "")
            if isinstance(data, str):
                data = data.encode("utf-8")
            zf.writestr(name, data)
    return buf.getvalue()
