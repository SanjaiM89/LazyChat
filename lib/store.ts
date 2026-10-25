import "server-only";

import fs from "node:fs";
import path from "node:path";
import { currentUser } from "@/lib/auth/context";
import { scopeKey } from "@/lib/auth/server";
import { DATA_DIR } from "@/lib/data-dir";


export { DATA_DIR };

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function filePath(name: string): string {
  ensureDir(DATA_DIR);
  const safe = name.replace(/\.\./g, "").replace(/[\/\\]/g, "");
  return path.join(DATA_DIR, safe);
}

export async function readJSON<T>(name: string, fallback: T): Promise<T> {
  try {
    const fp = filePath(name);
    if (!fs.existsSync(fp)) return fallback;
    const raw = fs.readFileSync(fp, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJSON<T>(name: string, data: T): Promise<void> {
  const fp = filePath(name);
  ensureDir(path.dirname(fp));
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Per-org (or, for users without an org, per-user) config files live in
 * data/scopes/<org-ID|user-UID>/. Reads fall back to the legacy global file so
 * pre-auth data stays usable as platform defaults; writes never touch it.
 * Outside a signed-in request there is no scope and the global file is used.
 */
function scopedPath(name: string): string | null {
  const u = currentUser();
  if (!u) return null;
  const safe = name.replace(/\.\./g, "").replace(/[\/\\]/g, "");
  const dir = path.join(DATA_DIR, "scopes", scopeKey(u).replace(/[^A-Za-z0-9_-]/g, "_"));
  ensureDir(dir);
  return path.join(dir, safe);
}

export async function readScoped<T>(name: string, fallback: T): Promise<T> {
  const fp = scopedPath(name);
  if (!fp) return readJSON(name, fallback);
  try {
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, "utf8")) as T;
  } catch {
    return fallback;
  }
  return readJSON(name, fallback);
}

export async function writeScoped<T>(name: string, data: T): Promise<void> {
  const fp = scopedPath(name);
  if (!fp) return writeJSON(name, data);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf8");
}

// Conversations live in Firestore; see lib/chat-store.ts.
export {
  type StoredConversation,
  type ConversationMeta,
  listConversations,
  getConversation,
  getConversationMeta,
  saveConversation,
  deleteConversation,
  clearConversations,
} from "@/lib/chat-store";
