import { after } from "next/server";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import {
  ChatRunConflictError,
  chatRunStream,
  createChatRun,
  prepareChatRun,
} from "@/lib/chat-runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Generous ceiling for long agentic replies (platform-dependent; on a
// self-hosted Node server the run is only bound by the process lifetime).
export const maxDuration = 3600;

/**
 * POST /api/chat → start a background run and stream it to this client.
 *
 * The reply itself lives on the server (lib/chat-runs.ts): this response is a
 * view of it, so closing the tab no longer kills the generation — the run keeps
 * consuming the model stream and checkpoints the transcript to disk, and the
 * client can re-attach with GET /api/chat/runs/:id/events.
 *
 * The run id is returned in the `x-chat-run-id` header (the body is the UI
 * message stream the AI SDK expects).
 */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid request body.");
  }

  try {
    // Build the model first: configuration errors (missing key, unknown
    // provider) come back as a normal error response instead of a reply that
    // silently never arrives.
    const { settings, model } = await prepareChatRun(body.settings);

    const run = createChatRun({
      messages: body.messages || [],
      settings,
      model,
      conversationId:
        typeof body.conversationId === "string" ? body.conversationId : undefined,
      trigger: body.trigger,
    });

    // `after(promise)` hands the run to the framework's waitUntil, so it keeps
    // running even if this response is abandoned mid-stream.
    after(run.done);

    return new Response(chatRunStream(run.id), {
      headers: { ...UI_MESSAGE_STREAM_HEADERS, "x-chat-run-id": run.id },
    });
  } catch (e: any) {
    if (e instanceof ChatRunConflictError) {
      return jsonError(e.message, 409);
    }
    return jsonError(
      e?.message || "Something went wrong while talking to the model.",
      400,
    );
  }
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
