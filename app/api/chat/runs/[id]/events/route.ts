import { chatRunStream, getChatRun } from "@/lib/chat-runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/chat/runs/:id/events?cursor=N → live SSE view of a run.
 *
 * Replays the run's chunks (so a client joining mid-generation can rebuild the
 * whole assistant message) and then follows it. The framing is the same
 * UIMessageChunk SSE format the AI SDK parses, so `DefaultChatTransport`'s
 * reconnectToStream (useChat's resumeStream) consumes it directly.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getChatRun(id)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const raw = new URL(req.url).searchParams.get("cursor");
  const cursor = raw && Number.isFinite(Number(raw)) ? Math.max(0, Number(raw)) : 0;

  return new Response(chatRunStream(id, { cursor }), {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
