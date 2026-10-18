/**
 * The freshest Firebase ID token seen per user.
 *
 * Without the Admin SDK the server talks to Firestore *as the user*, with their ID token. Tokens last an hour,
 * but background chat runs can outlive one. The browser refreshes its token and pings the server (every authed
 * request, plus /api/auth/session on refresh), so a long run always writes with the newest token for its owner.
 */
type Entry = { token: string; at: number };

const g = globalThis as unknown as { __omniaTokens?: Map<string, Entry> };
const tokens = (g.__omniaTokens ??= new Map<string, Entry>());

/** Decode the `exp` claim (seconds) without verifying - only used to pick the newest token. */
function expOf(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return Number(payload.exp) || 0;
  } catch {
    return 0;
  }
}

/** Remember a token that proxy.ts already verified for this uid. */
export function rememberToken(uid: string, token: string | undefined): void {
  if (!token) return;
  const prev = tokens.get(uid);
  if (!prev || expOf(token) >= expOf(prev.token)) tokens.set(uid, { token, at: Date.now() });
}

/** The newest token for the user, or undefined if none is known or it has expired. */
export function latestToken(uid: string): string | undefined {
  const e = tokens.get(uid);
  if (!e) return undefined;
  return expOf(e.token) * 1000 > Date.now() + 5_000 ? e.token : undefined;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}
