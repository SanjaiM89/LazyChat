from __future__ import annotations

import hashlib
import re
from typing import Any

from core.logging import get_logger
from services.graph import FalkorClient
from .memory_session import now_iso

logger = get_logger("brain.procedures")

SLOT_ARGS = {
    "service": "$service", "topic": "$topic", "name": "$name",
    "from_service": "$from_service", "to_service": "$to_service", "node_id": "$node_id",
}

STOPWORDS = {
    "the", "a", "an", "what", "which", "who", "whom", "whose", "when", "why",
    "how", "does", "do", "did", "is", "are", "was", "were", "if", "and", "or",
    "of", "for", "to", "in", "on", "at", "by", "with", "from", "about", "tell",
    "me", "we", "our", "i", "my", "us", "it", "that", "this", "these", "those",
    "can", "could", "should", "would", "there", "any", "some", "much", "many",
    "most", "all", "please", "give", "show", "list", "need", "want",
}

TOOL_TASK = {
    "impact_of_failure": "blast radius of a service failing",
    "find_bottlenecks": "services that are bottlenecks",
    "central_services": "most central services",
    "team_clusters": "how the org clusters by team",
    "pagerank": "most central nodes overall",
    "bridge_services": "services on many dependency paths",
    "shortest_path": "route between two services",
    "find_experts": "who knows a service",
    "tickets_blocked_by": "what is blocked behind a decision",
    "get_decision_context": "why a decision was made",
    "tickets_for_service": "tickets for a service",
    "find_people": "who a person is and what they own",
    "trace_dependencies": "what a service depends on",
    "graph_context": "the neighbourhood of a node",
    "run_cypher": "an open graph question",
}


def normalize_question(question: str) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9-]*", question or "")
    out = []
    for w in words:
        wl = w.lower()
        if wl in STOPWORDS or len(wl) < 3:
            continue
        if wl not in out:
            out.append(wl)
    return out


def generalize_arguments(args: dict[str, Any] | None) -> dict[str, Any]:
    out = {}
    for key, value in (args or {}).items():
        if key in SLOT_ARGS and isinstance(value, str) and value:
            out[key] = SLOT_ARGS[key]
        else:
            out[key] = value
    return out


def describe_task(question: str, tools: list[str]) -> str:
    from_tools = [TOOL_TASK[t] for t in set(tools) if t in TOOL_TASK]
    words = normalize_question(question)[:3]
    if from_tools:
        return " / ".join(from_tools[:2])
    return " ".join(words) or "an open graph question"


def procedure_id(user_id: str, task_pattern: str, steps: list[str]) -> str:
    sig = task_pattern + "|" + "|".join(steps)
    digest = hashlib.sha1(sig.encode()).hexdigest()[:12]
    return f"procedural:{user_id}:learned:{digest}"


def parse_reflection(text: str) -> dict[str, Any] | None:
    out: dict[str, Any] = {}
    fields = [("TASK:", "task_pattern"), ("WHY:", "rationale"), ("WHEN:", "applies_when"), ("NOT:", "avoid_when")]
    for raw_line in (text or "").split("\n"):
        line = raw_line.strip()
        for key, field in fields:
            if line.upper().startswith(key):
                value = line[len(key):].strip()
                if value:
                    out[field] = value
    if "task_pattern" not in out:
        return None
    task = out["task_pattern"].lower()
    task = re.sub(r"[^a-z0-9 -]", "", task).strip()
    if len(task) < 3 or len(task) > 60:
        return None
    return {
        "task_pattern": task,
        "rationale": out.get("rationale", ""),
        "applies_when": out.get("applies_when", ""),
        "avoid_when": out.get("avoid_when", ""),
    }


def fallback_reflection(tools: list[str]) -> dict[str, Any]:
    labels = [TOOL_TASK[t] for t in set(tools) if t in TOOL_TASK]
    # describeTaskFrom equivalent
    labels2 = [TOOL_TASK[t] for t in set(tools) if t in TOOL_TASK]
    task2 = " / ".join(labels2[:2]) if labels2 else "an open graph question"
    return {
        "task_pattern": task2,
        "rationale": (f"Answered with {', '.join(labels)}; each step returned graph rows that directly carry the answer." if labels else "Answered with a custom read-only query over the graph."),
        "applies_when": (f"Use when the question is about {', '.join(labels)}." if labels else "Use for an open-ended question about the graph."),
        "avoid_when": "Do not use when the question concerns a different kind of node or relationship.",
    }


def describe_task_from(tools: list[str]) -> str:
    labels = [TOOL_TASK[t] for t in set(tools) if t in TOOL_TASK]
    return " / ".join(labels[:2]) if labels else "an open graph question"


def recipe_steps(trace: list[dict[str, Any]]) -> dict[str, Any]:
    steps: list[str] = []
    tools: list[str] = []
    for step in trace or []:
        if step.get("error"):
            continue
        if not (step.get("row_count") or 0):
            continue
        name = step.get("tool")
        args = generalize_arguments(step.get("arguments") or {})
        rendered = ", ".join(f"{k}={v!r}" for k, v in args.items())
        steps.append(f"{name}({rendered})")
        if name not in tools:
            tools.append(name)
    return {"steps": steps, "tools": tools}


def _repr(value: Any) -> str:
    if isinstance(value, str):
        return f"'{value}'"
    return str(value)


async def reflect(llm, question: str, tools: list[str], steps: list[str]) -> dict[str, Any]:
    fallback = fallback_reflection(tools)
    if llm is None:
        return fallback
    prompt = (
        "A question-answering agent answered a question using graph queries.\n\n"
        f"Question: {question}\n"
        f"Queries run: {'; '.join(steps)}\n\n"
        "Reply with exactly these four lines and nothing else:\n"
        "TASK: <the kind of question, at most 8 words, lowercase>\n"
        "WHY: <one sentence on why these queries answer that kind of question>\n"
        "WHEN: <one line saying what such a question looks like>\n"
        "NOT: <one line saying when these queries would be the wrong choice>"
    )
    try:
        resp = await llm.complete([{"role": "user", "content": prompt}], "reflect", [])
        text = resp.get("text", "") if isinstance(resp, dict) else str(resp)
        parsed = parse_reflection(text)
        if parsed:
            return parsed
    except Exception:  # noqa: BLE001, S110
        pass
    return fallback


async def learn_from_turn(client: FalkorClient, user_id: str, question: str, trace: list[dict[str, Any]], opts: dict[str, Any] | None = None) -> dict[str, Any] | None:
    opts = opts or {}
    rs = recipe_steps(trace)
    steps = rs["steps"]
    tools = rs["tools"]
    if not steps:
        return None
    reflection = await reflect(opts.get("llm"), question, tools, steps)
    task_pattern = reflection["task_pattern"]
    pid = procedure_id(user_id, task_pattern, steps)
    ts = now_iso()
    await client.write(
        "MERGE (p:ProceduralMemory {id: $pid}) SET p.user_id = $uid, p.task_pattern = $pattern, p.steps = $steps, "
        "p.tools = $tools, p.timestamp = $ts, p.source = $source, p.learned = true, "
        "p.rationale = $rationale, p.applies_when = $applies_when, p.avoid_when = $avoid_when, "
        "p.uses = coalesce(p.uses, 0) + 1",
        {"pid": pid, "uid": user_id, "pattern": task_pattern, "steps": steps, "tools": tools, "ts": ts, "source": opts.get("session_id", ""), "rationale": reflection["rationale"], "applies_when": reflection["applies_when"], "avoid_when": reflection["avoid_when"]},
    )
    return {
        "id": pid,
        "task_pattern": task_pattern,
        "steps": steps,
        "tools": tools,
        "rationale": reflection["rationale"],
        "applies_when": reflection["applies_when"],
        "avoid_when": reflection["avoid_when"],
    }


async def recall_procedures(client: FalkorClient, user_id: str, question: str, limit: int = 4) -> list[dict[str, Any]]:
    rows = await client.query(
        "MATCH (p:ProceduralMemory) WHERE p.user_id = $uid OR p.user_id = 'system' "
        "RETURN p.id AS id, p.task_pattern AS pattern, p.steps AS steps, coalesce(p.uses,0) AS uses, "
        "coalesce(p.learned,false) AS learned, coalesce(p.rationale,'') AS rationale, "
        "coalesce(p.applies_when,'') AS applies_when, coalesce(p.avoid_when,'') AS avoid_when "
        "ORDER BY coalesce(p.uses,0) DESC",
        {"uid": user_id},
    )
    if not rows:
        return []
    words = set(normalize_question(question))
    scored = []
    for r in rows:
        pattern_words = set(normalize_question(r.get("pattern") or ""))
        overlap = len([w for w in words if w in pattern_words])
        uses = int(r.get("uses") or 0)
        learned = bool(r.get("learned"))
        score = overlap + (0.5 if learned and overlap else 0) + uses * 0.1
        scored.append({
            "id": r.get("id"),
            "task_pattern": r.get("pattern"),
            "steps": r.get("steps") or [],
            "uses": uses,
            "learned": learned,
            "rationale": r.get("rationale") or "",
            "applies_when": r.get("applies_when") or "",
            "avoid_when": r.get("avoid_when") or "",
            "score": score,
        })
    scored.sort(key=lambda x: x.get("score", 0), reverse=True)
    relevant = [p for p in scored if (p.get("score") or 0) > 0]
    return (relevant if relevant else scored)[:limit]


def format_for_prompt(procedures: list[dict[str, Any]]) -> str:
    if not procedures:
        return ""
    lines = ["## Procedures you have used before"]
    for p in procedures:
        origin = "learned" if p.get("learned") else "seeded"
        lines.append(f"- {p.get('task_pattern')} [{origin}]")
        if p.get("rationale"):
            lines.append(f"    why: {p.get('rationale')}")
        if p.get("applies_when"):
            lines.append(f"    applies when: {p.get('applies_when')}")
        if p.get("avoid_when"):
            lines.append(f"    not when: {p.get('avoid_when')}")
        for step in (p.get("steps") or [])[:6]:
            lines.append(f"    {step}")
    lines.append(
        "Reuse a recipe when the question matches its *applies when* condition. "
        "Substitute the current question's values for the $slots."
    )
    return "\n".join(lines)


async def record_use(client: FalkorClient, user_id: str, procedure_id_value: str, success: bool) -> None:
    await client.write(
        "MATCH (p:ProceduralMemory {id: $pid}) SET p.applied = coalesce(p.applied, 0) + 1, p.successes = coalesce(p.successes, 0) + $ok",
        {"pid": procedure_id_value, "ok": 1 if success else 0},
    )
