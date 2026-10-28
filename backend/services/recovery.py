from __future__ import annotations

from typing import Any

from .events import list_events


def list_interrupted_runs(conversation_id: str | None = None) -> list[dict[str, Any]]:
    conversations = [conversation_id] if conversation_id else []
    # If no specific conversation, we can't enumerate without a store; return []
    if not conversations:
        return []
    found = []
    for cid in conversations:
        events = list_events(cid, limit=2000)
        # group by run_id
        by_run: dict[str, list] = {}
        for ev in events:
            rid = ev.get("run_id")
            if rid:
                by_run.setdefault(rid, []).append(ev)
        for run_id, run_events in by_run.items():
            started = next((e for e in run_events if e.get("type") == "turn/start"), None)
            if not started:
                continue
            ended = next((e for e in run_events if e.get("type") == "turn/end"), None)
            if ended:
                continue
            last = run_events[-1]
            user = None
            for e in reversed(run_events):
                if e.get("type") == "user/message":
                    user = e
                    break
            answered = set()
            for e in run_events:
                if e.get("type") == "tool/result":
                    d = e.get("data") or {}
                    if isinstance(d, dict) and d.get("toolCallId"):
                        answered.add(str(d["toolCallId"]))
            pending = None
            for e in run_events:
                if e.get("type") == "tool/call":
                    d = e.get("data") or {}
                    if isinstance(d, dict):
                        tcid = d.get("toolCallId")
                        if tcid and str(tcid) not in answered:
                            pending = {"name": d.get("tool") or "tool", "toolCallId": str(tcid), "input": d.get("input")}
                            break
            last_user_message = None
            if user:
                d = user.get("data") or {}
                if isinstance(d, dict) and isinstance(d.get("text"), str):
                    last_user_message = d["text"]
            found.append({
                "runId": run_id,
                "conversationId": cid,
                "startedAt": started.get("created_at", 0),
                "lastEventType": last.get("type", "turn/start"),
                "lastEventAt": last.get("created_at", started.get("created_at", 0)),
                "lastEventSeq": last.get("seq", started.get("seq", 0)),
                "pendingTool": pending,
                "lastUserMessage": last_user_message,
            })
    found.sort(key=lambda x: (-x["startedAt"], -x["lastEventSeq"]))
    return found


def resume_run(run_id: str, opts: dict | None = None) -> dict[str, Any]:
    opts = opts or {}
    interrupted = next((r for r in list_interrupted_runs() if r["runId"] == run_id), None)
    if not interrupted:
        return {"ok": False, "error": f'There is no interrupted run called "{run_id}".'}
    note = ""
    if interrupted.get("pendingTool"):
        note = f'The previous attempt was interrupted while "{interrupted["pendingTool"]["name"]}" was running. Check whether it actually did its work before repeating it, then carry on.'
    else:
        note = "The previous attempt was interrupted. Check what was already done, then carry on."
    return {"ok": True, "runId": run_id, "note": note}
