import fs from "node:fs";
import path from "node:path";

import { DATA_DIR } from "@/lib/data-dir";
import { appendEvent } from "@/lib/agent/session";
import { SPILL_THRESHOLD_CHARS } from "@/lib/agent/compaction";

/**
 * Spill: when a tool result is far too large to keep in the conversation, it
 * is written to a file and the model gets a preview plus the locator. The full
 * text is still reachable — the model asks for it by name.
 */

const SPILL_DIR = "spill";

export interface SpillResult {
  spilled: true;
  path: string;
  bytes: number;
  chars: number;
  preview: string;
  note: string;
}

function spillDir(conversationId: string): string {
  const safe = conversationId.replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(DATA_DIR, SPILL_DIR, safe);
}

/**
 * Write text to a spill file.
 *
 * @returns where it went, or null when the text was small enough to keep.
 */
export function spillText(
  conversationId: string,
  text: string,
  opts: { thresholdChars?: number; runId?: string; name?: string } = {},
): SpillResult | null {
  const threshold = opts.thresholdChars ?? SPILL_THRESHOLD_CHARS;
  if (text.length <= threshold) return null;

  const dir = spillDir(conversationId);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${opts.name ?? "result"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, text, "utf8");

  const preview = text.slice(0, 1200);
  const result: SpillResult = {
    spilled: true,
    path: file,
    bytes: Buffer.byteLength(text, "utf8"),
    chars: text.length,
    preview,
    note:
      "The full output was written to a file. Read it with spill_read using the path above " +
      "when you need the details.",
  };

  appendEvent(
    "spill",
    { path: file, chars: text.length, bytes: result.bytes },
    { conversationId, runId: opts.runId },
  );
  return result;
}

/**
 * Read a spilled file back.
 *
 * Only files this app wrote are readable: the path has to sit inside the
 * spill directory.
 */
export function readSpill(
  file: string,
  opts: { conversationId?: string; maxChars?: number } = {},
): { path: string; chars: number; text: string; truncated: boolean } | null {
  const maxChars = opts.maxChars ?? 20_000;
  const resolved = path.resolve(file);
  const root = path.resolve(DATA_DIR, SPILL_DIR);
  if (!resolved.startsWith(root + path.sep)) return null;
  let text: string;
  try {
    text = fs.readFileSync(resolved, "utf8");
  } catch {
    return null;
  }
  return {
    path: resolved,
    chars: text.length,
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
  };
}
