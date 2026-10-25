from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from core.logging import get_logger
from services.graph import FalkorClient

from .consolidation import (
    consolidate_session,
    fact_id,
    normalize_fact,
)
from .memory_session import ensure_session, recall_memories, record_turn
from .timeout import ms_from_env, with_budget

logger = get_logger("brain.omnia_memory")

NOT_A_NAME = {
    "maybe", "please", "later", "now", "here", "there", "soon", "today", "tomorrow",
    "sorry", "happy", "sad", "tired", "fine", "good", "bad", "okay", "ok", "sure",
    "right", "ready", "busy", "free", "back", "home", "away", "done", "glad",
    "hungry", "thirsty", "bored", "sick", "well", "lucky", "joking", "kidding",
    "honest", "serious", "cold", "hot",
}


def omnia_user() -> str:
    return "omnia"


def session_for(conversation_id: str) -> str:
    return f"omnia:{conversation_id}"


async def brain_client() -> FalkorClient | None:
    try:
        return FalkorClient.get()
    except Exception as e:  # noqa: BLE001
        logger.warning("graph unavailable", error=str(e))
        return None


def message_text(message: dict[str, Any]) -> str:
    parts = message.get("parts") or []
    return "\n".join(p.get("text", "") for p in parts if p.get("type") == "text").strip()


def title_case(name: str) -> str:
    return " ".join(w[:1].upper() + w[1:] if w else w for w in name.split())


def clean_phrase(text: str, max_len: int = 80) -> str:
    return text.strip().replace("  ", " ").rstrip(".?!;, ").strip()[:max_len]


def extract_name_mention(text: str) -> str | None:
    m = re.search(r"(?:my name is|call me|i am|i'm|this is)\s+([A-Za-z][A-Za-z'\u2019-]+(?:\s+[A-Za-z][A-Za-z'\u2019-]+){0,2})", text or "")
    if not m:
        return None
    raw = m.group(1)
    if raw.split()[0].lower() in NOT_A_NAME:
        return None
    clean = title_case(clean_phrase(raw, 40))
    return clean if len(clean) >= 2 else None


class PersonalFact:
    def __init__(self, fact: str, slot: str | None = None):
        self.fact = fact
        self.slot = slot


def extract_personal_facts(text: str) -> list[PersonalFact]:
    out: list[PersonalFact] = []
    if not text:
        return out
    mentioned = extract_name_mention(text)
    if mentioned:
        out.append(PersonalFact(fact=f"The user's name is {mentioned}.", slot="user.name"))
    work = re.search(r"(?:i work (?:at|for|on))\s+(.+?)(?:[.!?]|$)", text, re.IGNORECASE)
    if work:
        clean = clean_phrase(work.group(1))
        if len(clean) >= 2:
            out.append(PersonalFact(fact=f"The user works at {clean}.", slot="user.work"))
    role = re.search(r"(?:i'm a|i am a|i'm an|i am an)\s+(.+?)(?:[.!?]|$)", text, re.IGNORECASE)
    if role:
        clean = clean_phrase(role.group(1))
        if len(clean) >= 2 and not re.match(r"^(?:happy|okay|sad|tired|fine|good|bad|sorry)\b", clean, re.IGNORECASE):
            out.append(PersonalFact(fact=f"The user is a {clean}.", slot="user.role"))
    like = re.search(r"(?:i (?:like|love|prefer)|my favou?rite (?:\w+ is))\s+(.+?)(?:[.!?]|$)", text, re.IGNORECASE)
    if like:
        clean = clean_phrase(like.group(1))
        if len(clean) >= 2:
            out.append(PersonalFact(fact=f"The user likes {clean}.", slot=None))
    remember = re.search(r"(?:remember|note)(?:\s+that)?\s+(.+?)(?:[.!?]|$)|don't forget\s+(.+?)(?:[.!?]|$)|keep in mind\s+(.+?)(?:[.!?]|$)", text, re.IGNORECASE)
    if remember:
        remembered = remember.group(1) or remember.group(2) or remember.group(3)
        if remembered and not re.match(r"^me\b", remembered.strip(), re.IGNORECASE):
            clean = clean_phrase(remembered, 200)
            if len(clean) >= 4:
                out.append(PersonalFact(fact=clean + ("." if not clean.endswith(".") else ""), slot=None))
    return out


async def write_semantic_fact(client: FalkorClient, user_id: str, fact: str, source: str, slot: str | None = None) -> dict[str, Any]:
    norm = normalize_fact(fact)[:80]
    if not norm:
        return {"id": "", "stored": False, "replaced": False}
    ts = datetime.now(UTC).isoformat()
    if slot:
        rows = await client.query("MATCH (m:SemanticMemory) WHERE m.user_id = $uid AND m.slot = $slot RETURN m.id AS id, m.fact AS fact", {"uid": user_id, "slot": slot})
        same = next((r for r in rows if normalize_fact(r.get("fact") or "")[:80] == norm), None)
        if same:
            await client.write("MATCH (m:SemanticMemory {id: $id}) SET m.timestamp = $ts", {"id": same["id"], "ts": ts})
            return {"id": same["id"], "stored": False, "replaced": False}
        if rows:
            await client.write("MATCH (m:SemanticMemory) WHERE m.user_id = $uid AND m.slot = $slot DETACH DELETE m", {"uid": user_id, "slot": slot})
    fid = fact_id(user_id, fact)
    await client.write(
        "MERGE (m:SemanticMemory {id: $fid}) SET m.user_id = $uid, m.fact = $fact, m.source = $source, m.timestamp = $ts, m.about = [], m.slot = $slot",
        {"fid": fid, "uid": user_id, "fact": fact, "source": source, "ts": ts, "slot": slot},
    )
    return {"id": fid, "stored": True, "replaced": bool(slot)}


async def recall_for_omnia(question: str, limit: int = 4) -> str:
    if not (question or "").strip():
        return ""

    async def _remember():
        client = await brain_client()
        if not client:
            return ""
        memories = await recall_memories(client, omnia_user(), question, limit)
        if not memories:
            return ""
        lines = [f"- [{m.get('kind')}] {(m.get('summary') or '')[:200]}" for m in memories]
        return "\n\n## Remembered context (from earlier Omnia conversations, stored in FalkorDB)\nUse this when relevant.\n" + "\n".join(lines)

    return await with_budget(_remember(), ms_from_env("BRAIN_RECALL_BUDGET_MS", 4000), "")


async def record_omnia_turn(conversation_id: str, role: str, content: str) -> None:
    text = (content or "").strip()
    if not conversation_id or not text:
        return
    try:
        client = await brain_client()
        if not client:
            return
        sid = await ensure_session(client, omnia_user(), session_for(conversation_id))
        await record_turn(client, sid, role, text[:4000])
    except Exception as e:  # noqa: BLE001
        logger.warning("record failed", error=str(e))


async def capture_omnia_memory(conversation_id: str, user_text: str, user_id: str = "omnia") -> None:
    text = (user_text or "").strip()
    if not conversation_id:
        return
    try:
        client = await brain_client()
        if not client:
            return
        sid = await ensure_session(client, user_id, session_for(conversation_id))
        for pf in extract_personal_facts(text):
            await write_semantic_fact(client, user_id, pf.fact, sid, pf.slot)
        await consolidate_session(client, sid, user_id, {})
    except Exception as e:  # noqa: BLE001
        logger.warning("capture failed", error=str(e))
