import type { FalkorClient } from "@/lib/brain/graph";

/**
 * True if the session is unknown (will be created for `uid`) or already belongs to `uid`.
 * Sessions are keyed by user_id, which the API now takes from the verified token.
 */
export async function sessionAllowed(client: FalkorClient, sessionId: string, uid: string): Promise<boolean> {
  const rows = await client.query<{ u: string | null }>(
    "MATCH (s:Session {id: $sid}) RETURN s.user_id AS u LIMIT 1",
    { sid: sessionId },
  );
  return rows.length === 0 || rows[0].u === uid;
}

/** True only if the session exists and belongs to `uid`. */
export async function sessionOwned(client: FalkorClient, sessionId: string, uid: string): Promise<boolean> {
  const rows = await client.query<{ u: string | null }>(
    "MATCH (s:Session {id: $sid}) RETURN s.user_id AS u LIMIT 1",
    { sid: sessionId },
  );
  return rows.length > 0 && rows[0].u === uid;
}
