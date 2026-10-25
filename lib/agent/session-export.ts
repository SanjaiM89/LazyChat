/**
 * The session export.
 *
 * The archive holds the conversation, the durable event log and a readable
 * transcript, so a session can be handed over or archived whole.
 */
import type { SessionEvent } from "@/lib/agent/session";
import { buildZip } from "@/lib/agent/zip";

export interface SessionArchiveInput {
  /** The conversation the export belongs to. */
  conversationId: string;
  /** The title of the conversation. */
  title?: string;
  /** The messages of the conversation. */
  messages?: unknown[];
  /** The durable event log of the conversation. */
  events: SessionEvent[];
}

export interface SessionArchive {
  /** The bytes of the archive. */
  data: Buffer;
  /** The name to save it under. */
  filename: string;
  /** The entries the archive carries. */
  entries: string[];
}

/**
 * Build the archive of one session.
 */
export function buildSessionArchive(input: SessionArchiveInput): SessionArchive {
  const title = input.title?.trim() || "session";
  const safe = title.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
  const stamp = new Date().toISOString().slice(0, 10);

  const events = input.events ?? [];
  const jsonl = events
    .map((event) =>
      JSON.stringify({
        seq: event.seq,
        type: event.type,
        run_id: event.run_id,
        created_at: event.created_at,
        data: event.data,
      }),
    )
    .join("\n");

  const entries = [
    { name: "session.json", data: JSON.stringify({ conversation_id: input.conversationId, title, messages: input.messages ?? [] }, null, 2) },
    { name: "events.jsonl", data: jsonl },
    { name: "transcript.md", data: transcript(input.conversationId, title, events) },
  ];

  return {
    data: buildZip(entries),
    filename: `${safe}-${stamp}.zip`,
    entries: entries.map((entry) => entry.name),
  };
}

/**
 * A readable transcript of the session.
 */
function transcript(conversationId: string, title: string, events: SessionEvent[]): string {
  const lines: string[] = [`# ${title}`, "", `Conversation: ${conversationId}`, ""];
  for (const event of events) {
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (event.type === "user/message") {
      lines.push(`## You`, "", String(data.text ?? ""), "");
    } else if (event.type === "assistant/message") {
      lines.push(`## Assistant`, "", String(data.text ?? ""), "");
    } else if (event.type === "tool/call") {
      lines.push(`### Tool: ${String(data.tool ?? data.name ?? "tool")}`, "", "```json", JSON.stringify(data.input ?? {}, null, 2), "```", "");
    } else if (event.type === "tool/result") {
      lines.push(`### Result: ${String(data.tool ?? data.name ?? "tool")} (${String(data.status ?? "completed")})`, "");
    }
  }
  return lines.join("\n");
}
