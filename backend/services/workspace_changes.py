from __future__ import annotations

import subprocess
from typing import Any


def workspace_changes(cwd: str) -> dict[str, Any]:
    try:
        res = subprocess.run(["git", "diff", "--stat"], cwd=cwd, capture_output=True, text=True)
        return {"ok": True, "stat": res.stdout, "stderr": res.stderr}
    except Exception as e:
        return {"ok": False, "error": str(e)}
