import "server-only";

import fs from "fs";
import path from "path";

// JSONL session persistence. Each conversation gets a .jsonl log in
// data/sessions/<convId>.jsonl. Each line is a JSON turn record:
//   { type: "turn", role, content, tool_calls?, tool_results?, ts, schema_version }
// Append-only, resilient to crashes.

const SESSION_DIR = path.join(process.cwd(), "data", "sessions");
const SCHEMA_VERSION = 2;

export interface TurnRecord {
  schema_version: number;
  seq: number;
  type: "turn";
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  ts: number;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  tool_results?: Array<{ call_id: string; output: string }>;
}

function sessionLogPath(convId: string): string {
  return path.join(SESSION_DIR, `${convId}.jsonl`);
}

function ensureSessionDir(): void {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

/** Append a turn record to the JSONL log. */
export function appendTurn(convId: string, record: Omit<TurnRecord, "schema_version" | "seq">): number {
  ensureSessionDir();
  const logPath = sessionLogPath(convId);
  const seq = countLines(logPath) + 1;
  const full: TurnRecord = {
    schema_version: SCHEMA_VERSION,
    seq,
    ...record,
  };
  fs.appendFileSync(logPath, JSON.stringify(full) + "\n", "utf8");
  return seq;
}

function countLines(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, "utf8");
  if (!content) return 0;
  return content.split("\n").filter((l) => l.trim()).length;
}

/** Read all turn records for a conversation from the JSONL log. */
export function readTurns(convId: string): TurnRecord[] {
  const logPath = sessionLogPath(convId);
  if (!fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, "utf8").split("\n").filter((l) => l.trim());
  return lines
    .map((l) => {
      try {
        return JSON.parse(l) as TurnRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is TurnRecord => r !== null);
}

/** Migrate older schema versions in the JSONL log. Currently a no-op passthrough. */
export function migrateTurns(convId: string): TurnRecord[] {
  const turns = readTurns(convId);
  // If any record has an old schema version, re-write the log with current schema.
  const needsMigration = turns.some((t) => t.schema_version < SCHEMA_VERSION);
  if (!needsMigration) return turns;

  const migrated = turns.map((t) => ({ ...t, schema_version: SCHEMA_VERSION }));
  const logPath = sessionLogPath(convId);
  fs.writeFileSync(logPath, migrated.map((t) => JSON.stringify(t)).join("\n") + "\n", "utf8");
  return migrated;
}

/** Fork a conversation: create a new conversation with messages up to `forkSeq`. */
export async function forkConversation(
  sourceConvId: string,
  forkSeq?: number,
  newId?: string,
  title?: string,
): Promise<string> {
  const id = newId || `fork_${sourceConvId}_${Date.now()}`;
  const turns = forkSeq ? readTurns(sourceConvId).filter((t) => t.seq <= forkSeq) : readTurns(sourceConvId);

  if (!turns.length) {
    // Fall back to the JSON store if no JSONL log exists.
    const { getConversation, saveConversation } = await import("@/lib/store");
    const conv = await getConversation(sourceConvId);
    if (conv && conv.messages) {
      const newMessages = conv.messages.slice(forkSeq ? forkSeq : 0).map((m: any) => ({ ...m }));
      await saveConversation({
        id,
        title: title || `Forked from ${sourceConvId}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        provider: conv.provider,
        model: conv.model,
        messages: newMessages,
      });
    }
    return id;
  }

  // Write the forked conversation to the JSON store.
  const { listConversations, saveConversation: saveConv } = await import("@/lib/store");
  const messages: any[] = [];
  for (const t of turns) {
    if (t.role === "user" || t.role === "assistant") {
      messages.push({
        id: `${id}-${t.seq}`,
        role: t.role,
        parts: [{ type: "text", text: t.content }],
        ...(t.tool_calls ? { tool_calls: t.tool_calls } : {}),
        ...(t.tool_results ? { tool_results: t.tool_results } : {}),
      });
    }
  }
  const all = await listConversations();
  const newConv = {
    id,
    title: `Fork of ${sourceConvId}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    provider: "openai",
    model: "gpt-4",
    messages,
  };
  all.push(newConv);
  await saveConv(newConv);

  // Also write the JSONL log for the fork.
  const logPath = sessionLogPath(id);
  ensureSessionDir();
  fs.writeFileSync(
    logPath,
    turns.map((t) => JSON.stringify(t)).join("\n") + "\n",
    "utf8",
  );
  return id;
}

/** Count total turn records across all sessions. */
export function countAllTurns(): number {
  ensureSessionDir();
  let total = 0;
  for (const file of fs.readdirSync(SESSION_DIR)) {
    if (file.endsWith(".jsonl")) {
      total += countLines(path.join(SESSION_DIR, file));
    }
  }
  return total;
}
