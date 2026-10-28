from __future__ import annotations

import asyncio
import base64
import contextlib
import os
import time

from core.logging import get_logger

from .graph import FalkorClient
from .observation_policy import guard_edit, guard_write, record_observation
from .shell_env import collect
from .workspace_memory import (
    add_todo,
    build_memory_context,
    list_todos,
    set_todo_status,
    store_shared,
    write_workspace_record,
)
from .workspaces import get_workspace

logger = get_logger("workspace_tools")

GLOB_MAX = 100
GREP_MAX = 250
IMAGE_MAX_BYTES = 10 * 1024 * 1024

IMAGE_MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
    ".tiff": "image/tiff", ".svg": "image/svg+xml",
}


def _root_of(ctx) -> str:
    root = ctx["root"]
    if callable(root):
        root = root()
    return str(root)


def resolve_in(root: str, rel: str) -> str:
    base = os.path.realpath(root)
    target = os.path.realpath(os.path.join(base, rel or "."))
    if target != base and not target.startswith(base + os.sep):
        raise ValueError(f"Path escapes the workspace: {rel}")
    return target


def _walk_files(directory: str, acc: list) -> None:
    try:
        entries = os.listdir(directory)
    except OSError:
        return
    for name in entries:
        if name in (".git", "node_modules"):
            continue
        full = os.path.join(directory, name)
        if os.path.isdir(full) and not os.path.islink(full):
            _walk_files(full, acc)
        elif os.path.isfile(full):
            acc.append(os.path.relpath(full, directory))


def _glob_to_regex(pattern: str):
    import re as _re
    result = "^"
    i = 0
    n = len(pattern)
    while i < n:
        c = pattern[i]
        if c == "*":
            if i + 1 < n and pattern[i + 1] == "*":
                result += ".*"
                i += 1
                if i + 1 < n and pattern[i + 1] == "/":
                    i += 1
            else:
                result += "[^/]*"
        elif c == "?":
            result += "[^/]"
        elif c in ".+^${}()|[]\\":
            result += "\\" + c
        else:
            result += c
        i += 1
    result += "$"
    return _re.compile(result)


def match_glob(pattern: str, rel_path: str) -> bool:
    if "/" not in pattern:
        return bool(_glob_to_regex(pattern).match(os.path.basename(rel_path)))
    return bool(_glob_to_regex(pattern).match(rel_path))


def _truncate(text: str, max_chars: int = 12000) -> str:
    if len(text) <= max_chars:
        return text
    return text[:6000] + f"\n... [{len(text) - max_chars} chars cut] ...\n" + text[-6000:]


def _brain():
    try:
        return FalkorClient.get()
    except Exception:
        return None


class WorkspaceToolCtx:
    def __init__(self, workspace_id, root, session_id, on_before_write=None):
        self.workspace_id = workspace_id
        self.root = root
        self.session_id = session_id
        self.on_before_write = on_before_write


def build_workspace_tools(ctx: WorkspaceToolCtx) -> dict:
    workspace_id = ctx.workspace_id
    session_id = ctx.session_id
    def root_of():
        return ctx.root() if callable(ctx.root) else str(ctx.root)

    def remember(kind, data):
        try:
            c = _brain()
            if c:
                import asyncio
                _t = asyncio.ensure_future(write_workspace_record(c, workspace_id, kind, data))
                _ = _t
        except Exception:
            pass

    tools = {}

    async def ws_list(rel=""):
        target = resolve_in(root_of(), rel)
        out = []
        try:
            names = os.listdir(target)
        except OSError:
            names = []
        for name in names[:300]:
            if name in (".git", "node_modules"):
                continue
            try:
                st = os.stat(os.path.join(target, name))
                out.append({"name": name, "dir": os.path.isdir(os.path.join(target, name)), "size": None if os.path.isdir(os.path.join(target, name)) else st.st_size})
            except OSError:
                pass
        out.sort(key=lambda x: (-int(x["dir"]), x["name"]))
        return {"path": rel or ".", "entries": out}

    async def ws_read(rel):
        target = resolve_in(root_of(), rel)
        st = os.stat(target)
        if not os.path.isfile(target):
            raise ValueError(f"Not a file: {rel}")
        if st.st_size > 2_000_000:
            raise ValueError(f"File too large ({st.st_size} bytes): {rel}")
        with open(target, encoding="utf-8") as f:
            content = f.read()[:20000]
        record_observation(session_id, target)
        return {"path": rel, "size": st.st_size, "content": content}

    async def ws_write(rel, content):
        target = resolve_in(root_of(), rel)
        guard = guard_write(session_id, target)
        if not guard.get("ok"):
            return {"error": guard.get("reason"), "code": guard.get("code"), "path": rel}
        if ctx.on_before_write:
            ctx.on_before_write(target)
        os.makedirs(os.path.dirname(target) or ".", exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(content)
        record_observation(session_id, target)
        remember("change", {"files": [rel], "summary": f"Wrote {rel} ({len(content)} chars)"})
        return {"path": rel, "bytes": len(content)}

    async def ws_shell(command, timeout_s=120):
        import time as _t
        started = int(_t.time() * 1000)
        env = dict(os.environ)
        with contextlib.suppress(Exception):
            env.update(collect({"cwd": root_of()}))
        proc = await asyncio.create_subprocess_shell(command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=root_of(), env=env)
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
        except TimeoutError:
            proc.kill()
            return {"exit_code": -1, "output": "timeout"}
        out = (stdout.decode(errors="replace")) + (("\n[stderr]\n" + stderr.decode(errors="replace")) if stderr else "")
        out = _truncate(out)
        remember("command", {"command": command[:2000], "output": out[:8000], "exit_code": proc.returncode, "duration_ms": int(_t.time()*1000) - started})
        return {"exit_code": proc.returncode, "duration_ms": int(_t.time()*1000) - started, "output": out}

    async def ws_todo(op, text=None, tid=None):
        c = _brain()
        if c is None:
            raise RuntimeError("Workspace memory is unavailable (FalkorDB down).")
        if op == "add":
            if not (text or "").strip():
                raise ValueError("TODO text is required.")
            return {"todo": await add_todo(c, workspace_id, text)}
        if op in ("done", "doing"):
            if not tid:
                raise ValueError("TODO id is required.")
            await set_todo_status(c, tid, op)
            return {"id": tid, "status": op}
        return {"todos": await list_todos(c, workspace_id)}

    async def ws_remember(kind, text, slot=None, scope="workspace"):
        c = _brain()
        if c is None:
            raise RuntimeError("Workspace memory is unavailable (FalkorDB down).")
        if kind == "error":
            parts = text.split("|||")
            error = parts[0].strip() if parts else text
            fix = parts[1].strip() if len(parts) > 1 else ""
            rid = await write_workspace_record(c, workspace_id, "error", {"error": error, "fix": fix})
            return {"id": rid}
        if kind in ("plan", "decision", "summary"):
            title = text.split("\n")[0][:120]
            data = {"summary": text} if kind == "summary" else {"title": title, "body": text}
            rid = await write_workspace_record(c, workspace_id, kind, data)
            return {"id": rid}
        sc = "global" if scope == "global" else f"workspace:{workspace_id}"
        kind2 = "preference" if kind == "preference" else "note"
        mem = await store_shared(c, sc, kind2, text, slot, None)
        return {"id": mem.get("id")}

    async def ws_glob(pattern, rel_dir=""):
        directory = resolve_in(root_of(), rel_dir or ".")
        all_files = []
        _walk_files(directory, all_files)
        def mtime(p):
            try:
                return os.path.getmtime(os.path.join(directory, p))
            except OSError:
                return 0
        all_files.sort(key=mtime, reverse=True)
        matches = [p for p in all_files if match_glob(pattern, p)]
        truncated = len(matches) > GLOB_MAX
        if truncated:
            spill_path = os.path.join(root_of(), f".glob-results-{int(time.time()*1000)}.txt")
            with open(spill_path, "w") as f:
                f.write("\n".join(matches))
            matches = matches[:GLOB_MAX]
            return {"pattern": pattern, "count": len(matches), "truncated": True, "spillPath": os.path.relpath(spill_path, root_of()), "paths": matches}
        return {"pattern": pattern, "count": len(matches), "truncated": False, "paths": matches}

    async def ws_grep(pattern, rel="", include=None):
        target = resolve_in(root_of(), rel or ".")
        try:
            os.stat(target)
        except OSError:
            raise ValueError(f"No such path: {rel or chr(46)}") from None
        files = []
        if os.path.isfile(target):
            files.append(target)
        else:
            _walk_files(target, files)
            files = [os.path.join(target, f) if not os.path.isabs(f) else f for f in files]
        import re as _re
        regex = _re.compile(pattern)
        results = []
        total = 0
        for entry in files:
            f = entry if os.path.isabs(entry) else os.path.join(target, entry)
            if total >= GREP_MAX:
                break
            try:
                st2 = os.stat(f)
                if st2.st_size > 2_000_000:
                    continue
                if include and not match_glob(include, os.path.basename(f)):
                    continue
                with open(f, encoding="utf-8") as fh:
                    content = fh.read()
                lines = content.split("\n")
                file_matches = []
                for i, line in enumerate(lines):
                    if total >= GREP_MAX:
                        break
                    if regex.search(line):
                        file_matches.append({"line": i + 1, "text": _truncate(line, 300)})
                        total += 1
                if file_matches:
                    results.append({"file": os.path.relpath(f, root_of()), "matches": file_matches})
            except (OSError, UnicodeDecodeError):
                pass
        return {"pattern": pattern, "count": total, "truncated": total >= GREP_MAX, "results": results}

    async def ws_read_image(rel):
        target = resolve_in(root_of(), rel)
        st = os.stat(target)
        if not os.path.isfile(target):
            raise ValueError(f"Not a file: {rel}")
        if st.st_size > IMAGE_MAX_BYTES:
            raise ValueError(f"Image too large ({st.st_size} bytes): {rel}")
        ext = os.path.splitext(target)[1].lower()
        mime = IMAGE_MIME.get(ext)
        if not mime:
            raise ValueError(f"Unsupported image type: {ext}")
        with open(target, "rb") as f:
            buf = f.read()
        b64 = base64.b64encode(buf).decode()
        return {"path": rel, "mime": mime, "data": f"data:{mime};base64,{b64}"}

    async def ws_str_replace_editor(command, path_rel, file_text=None, old_str=None, new_str=None, insert_line=None, view_range=None):
        target = resolve_in(root_of(), path_rel)
        if command == "view":
            if not os.path.exists(target):
                raise ValueError(f"File not found: {path_rel}")
            os.stat(target)
            if os.path.isdir(target):
                names = [n for n in os.listdir(target) if not n.startswith(".")]
                return {"path": path_rel, "dir": True, "entries": names}
            with open(target, encoding="utf-8") as f:
                all_lines = f.read().split("\n")
            record_observation(session_id, target)
            if view_range:
                s, e = view_range
                content = "\n".join(f"{s + i}: {ln}" for i, ln in enumerate(all_lines[s-1:e]))
                return {"path": path_rel, "content": content}
            content = "\n".join(f"{i+1}: {ln}" for i, ln in enumerate(all_lines))
            return {"path": path_rel, "content": content}
        if command == "create":
            if not file_text:
                raise ValueError("file_text is required for create")
            if os.path.exists(target):
                raise ValueError(f"File already exists: {path_rel}")
            if ctx.on_before_write:
                ctx.on_before_write(target)
            os.makedirs(os.path.dirname(target) or ".", exist_ok=True)
            with open(target, "w", encoding="utf-8") as f:
                f.write(file_text)
            record_observation(session_id, target)
            remember("change", {"files": [path_rel], "summary": f"Created {path_rel}"})
            return {"path": path_rel, "bytes": len(file_text)}
        if command == "str_replace":
            if not old_str:
                raise ValueError("old_str is required for str_replace")
            if new_str is None:
                raise ValueError("new_str is required for str_replace")
            guard = guard_edit(session_id, target)
            if not guard.get("ok"):
                return {"error": guard.get("reason"), "code": guard.get("code"), "path": path_rel}
            if ctx.on_before_write:
                ctx.on_before_write(target)
            with open(target, encoding="utf-8") as f:
                content = f.read()
            count = content.count(old_str)
            if count != 1:
                raise ValueError(f"old_str must match exactly once (found {count} matches)")
            updated = content.replace(old_str, new_str)
            with open(target, "w", encoding="utf-8") as f:
                f.write(updated)
            record_observation(session_id, target)
            remember("change", {"files": [path_rel], "summary": f"str_replace in {path_rel}"})
            return {"path": path_rel, "replacements": 1}
        if command == "insert":
            if new_str is None:
                raise ValueError("new_str is required for insert")
            if insert_line is None:
                raise ValueError("insert_line is required for insert")
            guard = guard_edit(session_id, target)
            if not guard.get("ok"):
                return {"error": guard.get("reason"), "code": guard.get("code"), "path": path_rel}
            if ctx.on_before_write:
                ctx.on_before_write(target)
            with open(target, encoding="utf-8") as f:
                content = f.read()
            lines = content.split("\n")
            idx = max(0, min(insert_line, len(lines)))
            lines[idx:idx] = new_str.split("\n")
            with open(target, "w", encoding="utf-8") as f:
                f.write("\n".join(lines))
            record_observation(session_id, target)
            return {"path": path_rel, "inserted_at": idx + 1}
        raise ValueError(f"Unknown command: {command}")

    tools["ws_list"] = {"description": "List files", "execute": lambda args: ws_list(args.get("path", ""))}
    tools["ws_read"] = {"description": "Read file", "execute": lambda args: ws_read(args["path"])}
    tools["ws_write"] = {"description": "Write file", "execute": lambda args: ws_write(args["path"], args["content"])}
    tools["ws_shell"] = {"description": "Run shell", "execute": lambda args: ws_shell(args["command"], args.get("timeout_s", 120))}
    tools["ws_todo"] = {"description": "Todo", "execute": lambda args: ws_todo(args["op"], args.get("text"), args.get("id"))}
    tools["ws_remember"] = {"description": "Remember", "execute": lambda args: ws_remember(args["kind"], args["text"], args.get("slot"), args.get("scope", "workspace"))}
    tools["ws_glob"] = {"description": "Glob", "execute": lambda args: ws_glob(args["pattern"], args.get("path", ""))}
    tools["ws_grep"] = {"description": "Grep", "execute": lambda args: ws_grep(args["pattern"], args.get("path", ""), args.get("include"))}
    tools["ws_read_image"] = {"description": "Read image", "execute": lambda args: ws_read_image(args["path"])}
    tools["ws_str_replace_editor"] = {"description": "Edit file", "execute": lambda args: ws_str_replace_editor(args["command"], args["path"], args.get("file_text"), args.get("old_str"), args.get("new_str"), args.get("insert_line"), args.get("view_range"))}

    return tools


async def workspace_briefing(workspace_id: str, max_chars: int = 4000) -> dict | None:
    c = _brain()
    if c is None:
        return None
    ws = await get_workspace(c, workspace_id)
    if ws is None:
        return None
    ctx_text = await build_memory_context(c, workspace_id, max_chars)
    head = f"## Active workspace: {ws.title}\nWorking directory for all file and shell tools: {ws.path}\n"
    if getattr(ws, "description", ""):
        head += f"About: {ws.description}\n"
    briefing = (head + "\n" + ctx_text) if ctx_text else head
    return {"briefing": briefing, "root": ws.path, "name": ws.title}
