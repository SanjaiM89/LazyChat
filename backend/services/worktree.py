from __future__ import annotations

import os
import re
import subprocess
from typing import Any

DATA_DIR = os.getenv("DATA_DIR", "./data")


def worktree_root() -> str:
    d = os.getenv("OMNIA_WORKTREE_DIR") or os.path.join(DATA_DIR, "worktrees")
    os.makedirs(d, exist_ok=True)
    return d


def _git(args: list[str], cwd: str) -> str:
    res = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=False)
    if res.returncode != 0:
        raise RuntimeError((res.stderr or res.stdout or "git failed").strip())
    return (res.stdout or "").strip()


async def create_worktree(cwd: str, name: str | None = None, from_ref: str = "HEAD") -> dict[str, Any]:
    import asyncio
    loop = asyncio.get_event_loop()
    def _do():
        repo_root = _git(["rev-parse", "--show-toplevel"], cwd)
        base_commit = _git(["rev-parse", from_ref], repo_root)
        wname = (name or "").strip() or f"worktree-{int(__import__('time').time())}"
        if not re.match(r"^[\w.-]+$", wname):
            raise ValueError(f'"{wname}" is not a usable branch name.')
        existing = _git(["branch", "--list", wname], repo_root)
        if existing:
            raise ValueError(f'A branch called "{wname}" already exists.')
        target = os.path.join(worktree_root(), wname)
        if os.path.exists(target):
            raise ValueError(f'A worktree called "{wname}" already exists.')
        _git(["worktree", "add", "-b", wname, target, base_commit], repo_root)
        return {"path": os.path.realpath(target), "branch": wname, "baseCommit": base_commit, "repositoryRoot": repo_root}
    return await loop.run_in_executor(None, _do)


async def list_worktrees(cwd: str) -> list[dict[str, Any]]:
    import asyncio
    loop = asyncio.get_event_loop()
    def _do():
        repo_root = _git(["rev-parse", "--show-toplevel"], cwd)
        raw = _git(["worktree", "list", "--porcelain"], repo_root)
        out = []
        current = None
        for line in raw.split("\n"):
            if line.startswith("worktree "):
                if current:
                    out.append(current)
                current = {"path": line[len("worktree "):], "branch": "", "head": "", "detached": False}
            elif line.startswith("HEAD ") and current:
                current["head"] = line[len("HEAD "):]
            elif line.startswith("branch ") and current:
                current["branch"] = line[len("branch "):].replace("refs/heads/", "")
            elif line.strip() == "detached" and current:
                current["detached"] = True
        if current:
            out.append(current)
        return out
    return await loop.run_in_executor(None, _do)
