import { tool } from "ai";
import { z } from "zod";

import { listEvents, listRunEvents, searchEvents } from "@/lib/agent/session";
import { buildTurnOutline, computeSessionStats } from "@/lib/agent/session-stats";
import { foldSessionTitle } from "@/lib/agent/session-title";
import { buildSessionArchive } from "@/lib/agent/session-export";

/**
 * Tools that read the append-only session log.
 *
 * The conversation itself only holds what is still in context; the log holds
 * every turn, step, tool call and result, so the model can look up what
 * happened earlier — in this conversation or in any other.
 */
export function buildSessionEventTools(current?: string) {
  return {
    session_event_search: tool({
      description:
        "Full-text search across the session log: every turn, step, tool call and result of every conversation. " +
        "Use it when you need something that happened in an earlier session and do not remember the wording.",
      inputSchema: z.object({
        query: z.string().describe("Words to look for. Plain words work; quotes group them."),
        conversation_id: z.string().optional().describe("Restrict the search to one conversation."),
        limit: z.number().int().min(1).max(50).default(10).describe("Max results (default 10)."),
      }),
      execute: async ({ query, conversation_id, limit }) => {
        try {
          const hits = searchEvents(query, {
            conversationId: conversation_id || undefined,
            limit: limit ?? 10,
          });
          return {
            query,
            count: hits.length,
            results: hits.map((hit) => ({
              conversation_id: hit.conversation_id,
              type: hit.type,
              created_at: hit.created_at,
              excerpt: excerptOf(hit.data),
            })),
          };
        } catch (e) {
          return { error: (e as Error).message || "The search failed." };
        }
      },
    }),

    session_event_read: tool({
      description:
        "Read the event log of one conversation, oldest first. Each event is a turn, a step, a tool call or a result.",
      inputSchema: z.object({
        conversation_id: z.string().describe("The conversation to read"),
        types: z
          .array(z.string())
          .optional()
          .describe("Only these event types, e.g. tool/call. All types when omitted."),
        limit: z.number().int().min(1).max(500).default(100).describe("Max events (default 100)."),
        since_seq: z.number().int().min(0).optional().describe("Only events after this sequence number."),
      }),
      execute: async ({ conversation_id, types, limit, since_seq }) => {
        const events = listEvents(conversation_id, {
          types: types?.length ? (types as never) : undefined,
          limit: limit ?? 100,
          sinceSeq: since_seq,
        });
        return {
          conversation_id,
          count: events.length,
          events: events.map((event) => ({
            seq: event.seq,
            type: event.type,
            run_id: event.run_id,
            created_at: event.created_at,
            data: event.data,
          })),
        };
      },
    }),

    session_trace: tool({
      description:
        "Reconstruct the trace of one run: the turns, steps and tool calls it made, in order. Use it to see what a " +
        "previous attempt actually did.",
      inputSchema: z.object({
        run_id: z.string().describe("The run to trace"),
      }),
      execute: async ({ run_id }) => {
        const events = listRunEvents(run_id);
        return {
          run_id,
          count: events.length,
          steps: events.map((event) => ({
            seq: event.seq,
            type: event.type,
            at: event.created_at,
            data: event.data,
          })),
        };
      },
    }),

    session_event_trace: tool({
      description:
        "Trace one event in a conversation: the event itself, the turn it belongs to, the tool call and result it " +
        "produced, and the compaction summaries that replaced it. Use it when you know roughly where something " +
        "happened and need to see what it touched.",
      inputSchema: z.object({
        conversation_id: z.string().describe("The conversation the event belongs to"),
        seq: z.number().int().min(0).describe("The sequence number of the event."),
      }),
      execute: async ({ conversation_id, seq }) => {
        try {
          const events = listEvents(conversation_id, { limit: 1000 });
          const source = events.find((event) => event.seq === seq);
          if (!source) {
            return {
              error: `No event with sequence ${seq} in this conversation.`,
              conversation_id,
              highest_seq: events.length ? events[events.length - 1].seq : 0,
            };
          }
          return {
            conversation_id,
            source: {
              seq: source.seq,
              type: source.type,
              run_id: source.run_id,
              at: source.created_at,
              data: source.data,
            },
            turn: turnOf(events, source.seq),
            tool: toolOf(events, source),
            replaced_by: replacedBy(events, source.seq),
          };
        } catch (e) {
          return { error: (e as Error).message || "The trace failed." };
        }
      },
    }),

    session_stats: tool({
      description:
        "The figures of one conversation: how many turns and steps it has, how long the model and the tools took, and " +
        "how many tokens the answers used. Use it to report on a long session.",
      inputSchema: z.object({
        conversation_id: z.string().optional().describe("The conversation. The current one when omitted."),
      }),
      execute: async ({ conversation_id }) => {
        const id = conversation_id || current;
        if (!id) return { error: "No conversation was given and there is no current one." };
        const events = listEvents(id, { limit: 10000 });
        return { conversation_id: id, ...computeSessionStats(events) };
      },
    }),

    session_outline: tool({
      description:
        "An outline of the conversation's turns: what each turn set out to do, the tools it called, how it ended and " +
        "what the assistant answered. Use it to recall the shape of a long session without reading all of it.",
      inputSchema: z.object({
        conversation_id: z.string().optional().describe("The conversation. The current one when omitted."),
      }),
      execute: async ({ conversation_id }) => {
        const id = conversation_id || current;
        if (!id) return { error: "No conversation was given and there is no current one." };
        const events = listEvents(id, { limit: 10000 });
        return { conversation_id: id, turns: buildTurnOutline(events) };
      },
    }),

    session_title: tool({
      description:
        "The title of the conversation, derived from the first thing the user asked. Titles are for the user; they are " +
        "never part of the model's input.",
      inputSchema: z.object({
        conversation_id: z.string().optional().describe("The conversation. The current one when omitted."),
      }),
      execute: async ({ conversation_id }) => {
        const id = conversation_id || current;
        if (!id) return { error: "No conversation was given and there is no current one." };
        const title = foldSessionTitle(listEvents(id, { limit: 10000 }));
        return { conversation_id: id, title };
      },
    }),

    session_export: tool({
      description:
        "Export the conversation as an archive: the messages, the durable event log and a readable transcript. Use it " +
        "when the user wants to keep or hand over the session.",
      inputSchema: z.object({
        conversation_id: z.string().optional().describe("The conversation. The current one when omitted."),
      }),
      execute: async ({ conversation_id }) => {
        const id = conversation_id || current;
        if (!id) return { error: "No conversation was given and there is no current one." };
        try {
          const { getConversation } = await import("@/lib/chat-store");
          const conversation = await getConversation(id);
          const archive = buildSessionArchive({
            conversationId: id,
            title: conversation?.title,
            messages: conversation?.messages ?? [],
            events: listEvents(id, { limit: 100000 }),
          });
          // The archive is written where the user can pick it up.
          const { DATA_DIR } = await import("@/lib/data-dir");
          const fs = await import("node:fs");
          const path = await import("node:path");
          const dir = path.join(DATA_DIR, "exports");
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, archive.filename);
          fs.writeFileSync(file, archive.data);
          return {
            conversation_id: id,
            path: file,
            filename: archive.filename,
            bytes: archive.data.length,
            entries: archive.entries,
          };
        } catch (e) {
          return { error: (e as Error).message || "The export failed." };
        }
      },
    }),
  };
}



/** The turn an event belongs to: the enclosing turn/start … turn/end. */
function turnOf(events: ReturnType<typeof listEvents>, seq: number) {
  let start: number | null = null;
  for (const event of events) {
    if (event.seq > seq) break;
    if (event.type === "turn/start") start = event.seq;
    if (event.type === "turn/end" && event.seq >= seq) {
      return { start_seq: start, end_seq: event.seq };
    }
  }
  return { start_seq: start, end_seq: null };
}

/** The tool call and result an event produced, if it was one. */
function toolOf(events: ReturnType<typeof listEvents>, source: { type: string; data: Record<string, unknown> }) {
  const callId =
    (source.data.toolCallId as string | undefined) ??
    (source.data.tool_call_id as string | undefined) ??
    undefined;
  if (!callId) return null;
  const call = events.find(
    (event) => event.type === "tool/call" && (event.data.toolCallId as string | undefined) === callId,
  );
  const result = events.find(
    (event) => event.type === "tool/result" && (event.data.toolCallId as string | undefined) === callId,
  );
  return {
    tool_call_id: callId,
    call_seq: call?.seq ?? null,
    result_seq: result?.seq ?? null,
    name: (call?.data.name as string | undefined) ?? (source.data.name as string | undefined) ?? null,
  };
}

/**
 * The compaction summaries that replaced an event: the summaries that cover
 * it, which is every summary after it up to the next one.
 */
function replacedBy(events: ReturnType<typeof listEvents>, seq: number) {
  const out: Array<{ seq: number; at: number; summary: string; covers_from: number }> = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.seq <= seq) continue;
    if (event.type !== "compaction/summary") continue;
    // The summary covers everything back to the previous summary.
    let coversFrom = 0;
    for (let j = i - 1; j >= 0; j--) {
      if (events[j].type === "compaction/summary") {
        coversFrom = events[j].seq;
        break;
      }
    }
    if (seq > coversFrom) {
      out.push({
        seq: event.seq,
        at: event.created_at,
        summary: String(event.data.summary ?? event.data.text ?? "").slice(0, 400),
        covers_from: coversFrom,
      });
    }
  }
  return out;
}

/** A short, readable excerpt of an event payload. */
function excerptOf(data: Record<string, unknown>): string {
  const text = data.text ?? data.output ?? data.reason ?? data.error ?? "";
  const value = typeof text === "string" ? text : JSON.stringify(text);
  return value.slice(0, 240);
}
