import { after } from "next/server";
import {
  ChatRunConflictError,
  cleanupChatRuns,
  createChatRun,
  listChatRuns,
  prepareChatRun,
} from "@/lib/chat-runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Generous ceiling for long agentic replies (platform-dependent; on a
// self-hosted Node server the run is only bound by the process lifetime).
export const maxDuration = 3600;

/** GET /api/chat/runs?conversationId=… → every run this server knows about. */
export async function GET(req: Request) {
  cleanupChatRuns();
  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId") || undefined;
  return Response.json({ runs: listChatRuns(conversationId) });
}

/**
 * POST /api/chat/runs → start a background run and return immediately.
 *
 * The reply is generated server-side and is NOT tied to this response, so it
 * keeps going when the browser goes away. Clients watch it with
 * GET /api/chat/runs/:id/events (SSE).
 */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    // Build the model before the run starts, so a config error is a normal
    // response instead of a background run that fails invisibly.
    const { settings, model } = await prepareChatRun(body.settings);

    const run = createChatRun({
      messages: body.messages || [],
      settings,
      model,
      conversationId:
        typeof body.conversationId === "string" ? body.conversationId : undefined,
      trigger: body.trigger,
    });

    // `after(promise)` registers the run with the framework's waitUntil, so the
    // detached generation isn't torn down when this response ends (or when the
    // client disconnects).
    after(run.done);

    return Response.json(
      { runId: run.id, messageId: run.messageId },
      { status: 202 },
    );
  } catch (e: any) {
    if (e instanceof ChatRunConflictError) {
      return Response.json(
        { error: e.message, runId: e.activeRunId },
        { status: 409 },
      );
    }
    return Response.json(
      { error: e?.message || "Failed to start the reply." },
      { status: 400 },
    );
  }
}
