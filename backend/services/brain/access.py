from __future__ import annotations


async def session_allowed(client, session_id: str, uid: str) -> bool:
    rows = await client.query("MATCH (s:Session {id: $sid}) RETURN s.user_id AS u LIMIT 1", {"sid": session_id})
    if not rows:
        return True
    return rows[0].get("u") == uid


async def session_owned(client, session_id: str, uid: str) -> bool:
    rows = await client.query("MATCH (s:Session {id: $sid}) RETURN s.user_id AS u LIMIT 1", {"sid": session_id})
    return bool(rows) and rows[0].get("u") == uid