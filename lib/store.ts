import "server-only";

import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------ */
/*  Tiny file-backed JSON store for conversations, skills, MCP servers */
/* ------------------------------------------------------------------ */

export const DATA_DIR = path.join(process.cwd(), "data");

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

/* ------------------------- conversations ------------------------- */

export interface StoredConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model: string;
  messages: unknown[];
}

export async function listConversations(): Promise<StoredConversation[]> {
  const data = await readJSON<StoredConversation[]>("conversations.json", []);
  return data.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getConversation(id: string): Promise<StoredConversation | null> {
  const all = await listConversations();
  return all.find((c) => c.id === id) ?? null;
}

export async function saveConversation(conv: StoredConversation): Promise<void> {
  const all = await listConversations();
  const idx = all.findIndex((c) => c.id === conv.id);
  if (idx >= 0) all[idx] = conv;
  else all.unshift(conv);
  // cap stored conversations to keep the file light
  const trimmed = all.slice(0, 200);
  await writeJSON("conversations.json", trimmed);
}

export async function deleteConversation(id: string): Promise<void> {
  const all = await listConversations();
  await writeJSON(
    "conversations.json",
    all.filter((c) => c.id !== id),
  );
}

export async function clearConversations(): Promise<void> {
  await writeJSON("conversations.json", []);
}
