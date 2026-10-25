import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { DATA_DIR } from "@/lib/data-dir";

/**
 * Shared secret for Omnia's own internal HTTP endpoints (the MCP servers).
 *
 * The MCP routes are reachable over plain HTTP, so they must not be open:
 * anything that can POST to them can read and write memory and act on the
 * Company Brain graph. The token comes from the environment when a deployment
 * sets one, otherwise it is generated once and kept beside the app's data so
 * the UI can show it to whoever wires up an MCP client.
 */
let cached: string | null = null;

const TOKEN_FILE = "internal-token";

export function internalToken(): string {
  if (cached) return cached;
  const fromEnv = process.env.OMNIA_INTERNAL_TOKEN?.trim();
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }
  const file = path.join(DATA_DIR, TOKEN_FILE);
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) {
      cached = existing;
      return cached;
    }
  } catch {
    // No token yet — generate one below.
  }
  const generated = crypto.randomBytes(24).toString("hex");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, generated, { encoding: "utf8", mode: 0o600 });
  cached = generated;
  return generated;
}

/** True when the request carries the internal token, as a bearer header or ?t=. */
export function hasInternalToken(req: Request): boolean {
  const expected = internalToken();
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const query = new URL(req.url).searchParams.get("t") ?? "";
  const provided = bearer || query.trim();
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The rejection every internal endpoint answers an unauthenticated call with. */
export function unauthorized(): Response {
  return Response.json(
    { error: "This endpoint requires the Omnia internal token." },
    { status: 401 },
  );
}
