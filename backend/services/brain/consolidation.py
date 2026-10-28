from __future__ import annotations

import hashlib
import re
from typing import Any

from core.logging import get_logger
from services.graph import FalkorClient

from .memory_session import get_turns, now_iso, turn_count

logger = get_logger("brain.consolidation")

CONSOLIDATE_AFTER_TURNS = 4

SUBJECT = re.compile(r"\b(auth-service|payments-api|ledger-service|notification-service|search-api|recsys|event-pipeline|web-checkout|api-gateway|identity-sync|data-platform)\b", re.IGNORECASE)
DECISION = re.compile(r"\bdecision\b|\bADR\b|\bwe (decided|chose|adopted)\b", re.IGNORECASE)
RECALLED = re.compile(r"earlier sessions|\[episodic\]|\[semantic\]|\[procedural\]|remind me", re.IGNORECASE)


def normalize_fact(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()[:160]


def fact_id(user_id: str, text: str) -> str:
    digest = hashlib.sha1(normalize_fact(text).encode()).hexdigest()[:12]
    return f"semantic:{user_id}:{digest}"


def extract_facts(answer: str) -> list[str]:
    facts: list[str] = []
    if not answer:
        return facts
    for sentence in re.split(r"(?<=[.!?])\s+", answer):
        s = sentence.strip()
        if not s or len(s) < 25 or len(s) > 400:
            continue
        if RECALLED.search(s):
            continue
        if SUBJECT.search(s) or DECISION.search(s):
            facts.append(s)
    # dedupe
    seen = set()
    out = []
    for f in facts:
        key = normalize_fact(f)[:80]
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out


def strip_marker(line: str) -> str:
    return re.sub(r"^\s*(?:[-*•]|\d+[.)])?\s*", "", line).strip()


def significant(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) > 2}


def is_grounded(candidate: str, source_norm: str, source_tokens: set[str]) -> bool:
    norm = normalize_fact(candidate)
    if norm and source_norm and source_norm.find(norm[:60]) >= 0:
        return True
    tokens = significant(candidate)
    if not tokens:
        return False
    matched = sum(1 for t in tokens if t in source_tokens)
    return matched >= 3 and matched / len(tokens) >= 0.7


async def extract_facts_llm(text: str, llm) -> list[str]:
    if not text or llm is None:
        return []
    # Best-effort: delegate to llm.complete if available
    try:
        prompt = "Extract durable facts.\n\nTEXT:\n" + text[:3000]
        resp = await llm.complete([{"role": "user", "content": prompt}], "extract facts", [])
        out = []
        source_norm = normalize_fact(text)
        source_tokens = significant(text)
        for line in (resp.get("text", "") if isinstance(resp, dict) else str(resp)).split("\n"):
            cand = strip_marker(line)
            if not (25 <= len(cand) <= 400):
                continue
            if RECALLED.search(cand):
                continue
            if not is_grounded(cand, source_norm, source_tokens):
                continue
            out.append(cand)
        # dedupe
        seen = set()
        deduped = []
        for f in out:
            key = normalize_fact(f)[:80]
            if not key or key in seen:
                continue
            seen.add(key)
            deduped.append(f)
        return deduped
    except Exception:
        return []


async def consolidated_turns(client: FalkorClient, session_id: str) -> int:
    rows = await client.query("MATCH (s:Session {id: $sid}) RETURN coalesce(s.consolidated_turns, 0) AS c", {"sid": session_id})
    return int(rows[0].get("c") or 0) if rows else 0


async def should_consolidate(client: FalkorClient, session_id: str, threshold: int = CONSOLIDATE_AFTER_TURNS) -> bool:
    total = await turn_count(client, session_id)
    if total < threshold:
        return False
    return total - (await consolidated_turns(client, session_id)) >= threshold


async def summarize_session(client: FalkorClient, session_id: str, max_chars: int = 600) -> str:
    turns = await get_turns(client, session_id)
    if not turns:
        return ""
    questions = [t.get("content", "") for t in turns if t.get("role") == "user"]
    answers = [t.get("content", "") for t in turns if t.get("role") != "user"]
    parts = []
    if questions:
        parts.append("The user asked about: " + "; ".join(q[:120] for q in questions[:5]) + ".")
    if answers:
        parts.append("Findings: " + " ".join(a[:400] for a in answers[:3]))
    return " ".join(parts)[:max_chars]


async def mentioned_node_ids(client: FalkorClient, text: str) -> list[str]:
    if not text:
        return []
    words = (re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", text))[:12]
    if not words:
        return []
    try:
        rows = await client.query("MATCH (n) WHERE any(w IN $words WHERE toLower(n.name) CONTAINS toLower(w) OR toLower(coalesce(n.title,'')) CONTAINS toLower(w) OR toLower(coalesce(n.key,'')) = toLower(w)) RETURN DISTINCT n.id AS id LIMIT 12", {"words": words})
        return [r.get("id") for r in rows if r.get("id")]
    except Exception:
        return []


PROCEDURES = [
    {"task_pattern": "blast radius / what breaks if a service fails", "steps": ["impact_of_failure(service)", "group affected services by hop distance", "name the owning team for the nearest hop"]},
    {"task_pattern": "who knows about a service", "steps": ["find_experts(service)", "report each person's evidence"]},
    {"task_pattern": "what is blocked / what is stuck", "steps": ["tickets_blocked_by(topic)", "group blocked tickets by service"]},
    {"task_pattern": "why was this decided", "steps": ["get_decision_context(topic)", "cite discussion messages"]},
]


async def install_procedures(client: FalkorClient, user_id: str = "system") -> int:
    n = 0
    for proc in PROCEDURES:
        slug = re.sub(r"[^a-z0-9]+", "-", proc["task_pattern"].lower())[:40]
        pid = f"procedural:{user_id}:{slug}"
        ts = now_iso()
        await client.write(
            "MERGE (p:ProceduralMemory {id: $pid}) SET p.user_id = $uid, p.task_pattern = $pattern, p.steps = $steps, p.timestamp = $ts",
            {"pid": pid, "uid": user_id, "pattern": proc["task_pattern"], "steps": proc["steps"], "ts": ts},
        )
        n += 1
    return n


async def procedures_for_user(client: FalkorClient, user_id: str) -> list[dict[str, Any]]:
    rows = await client.query(
        "MATCH (p:ProceduralMemory) WHERE p.user_id = $uid OR p.user_id = 'system' RETURN p.id AS id, p.task_pattern AS pattern, p.steps AS steps, coalesce(p.uses,0) AS uses, coalesce(p.applied,0) AS applied, coalesce(p.successes,0) AS successes, coalesce(p.learned,false) AS learned ORDER BY coalesce(p.uses,0) DESC, p.task_pattern",
        {"uid": user_id},
    )
    return [
        {
            "id": r.get("id"),
            "task_pattern": r.get("pattern"),
            "steps": r.get("steps") or [],
            "uses": int(r.get("uses") or 0),
            "applied": int(r.get("applied") or 0),
            "successes": int(r.get("successes") or 0),
            "learned": bool(r.get("learned")),
        }
        for r in rows
    ]


async def consolidate_session(client: FalkorClient, session_id: str, user_id: str, opts: dict[str, Any] | None = None) -> dict[str, Any]:
    opts = opts or {}
    threshold = opts.get("threshold", CONSOLIDATE_AFTER_TURNS)
    llm = opts.get("llm")
    force = opts.get("force", False)
    # should consolidate check
    total = await turn_count(client, session_id)
    if not force and total < threshold:
        return {"consolidated": False, "reason": "not eligible yet"}
    if not force:
        ct = await consolidated_turns(client, session_id)
        if total - ct < threshold:
            return {"consolidated": False, "reason": "not eligible yet"}
    summary = await summarize_session(client, session_id)
    if not summary:
        return {"consolidated": False, "reason": "no turns"}
    # facts from findings best-effort: fall back to turns
    candidates = []
    # try crew readFindings not available; use turns
    turns = await get_turns(client, session_id)
    for t in turns:
        if t.get("role") == "user":
            continue
        content = t.get("content", "")
        llm_facts = await extract_facts_llm(content, llm)
        facts = llm_facts if llm_facts else extract_facts(content)
        if not facts:
            facts = extract_facts(summary)
        for f in facts:
            candidates.append({"fact": f, "about": []})
    if not candidates:
        candidates = [{"fact": f, "about": []} for f in extract_facts(summary)]
    about = await mentioned_node_ids(client, summary)
    ts = now_iso()
    turn_total = total
    eid = f"episodic:{session_id}"
    await client.write(
        "MATCH (s:Session {id: $sid}) MERGE (e:EpisodicMemory {id: $eid}) "
        "SET e.user_id = $uid, e.summary = $summary, e.timestamp = $ts, e.about = $about, e.turn_count = $turns "
        "MERGE (s)-[:CONSOLIDATED_INTO]->(e)",
        {"sid": session_id, "eid": eid, "uid": user_id, "summary": summary, "ts": ts, "about": about, "turns": turn_total},
    )
    facts_written = 0
    seen = set()
    for item in candidates:
        fact = item["fact"]
        key = normalize_fact(fact)[:80]
        if not key or key in seen:
            continue
        seen.add(key)
        links = about if about else item.get("about", [])
        fid = fact_id(user_id, fact)
        await client.write(
            "MERGE (m:SemanticMemory {id: $fid}) SET m.user_id = $uid, m.fact = $fact, m.source = $source, m.timestamp = $ts, m.about = $about",
            {"fid": fid, "uid": user_id, "fact": fact, "source": session_id, "ts": ts, "about": links},
        )
        facts_written += 1
    await client.write("MATCH (s:Session {id: $sid}) SET s.consolidated_turns = $turns", {"sid": session_id, "turns": turn_total})
    return {
        "consolidated": True,
        "episodic_id": eid,
        "episodic_summary": summary,
        "semantic_written": facts_written,
        "about": about,
        "turn_count": turn_total,
        "timestamp": ts,
    }
