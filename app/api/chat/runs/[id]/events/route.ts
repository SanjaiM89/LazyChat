import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { chatRunStream, getChatRun, getRunOwner } from "@/lib/chat-runs";
import { authed } from "@/lib/auth/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = authed<{ id: string }>(async (req, user, { params }) => {
  const { id } = await params;
  // Unknown (e.g. finished and evicted) runs: 204 tells the AI SDK there is nothing to resume; the
  // finished conversation is loaded from storage instead.
  if (!getChatRun(id)) return new Response(null, { status: 204 });
  if (getRunOwner(id) !== user.uid) return Response.json({ error: "not found" }, { status: 404 });

  // `?cursor=` (explicit attach) or Last-Event-ID (native EventSource reconnect): resume at that chunk.
  const raw = new URL(req.url).searchParams.get("cursor") ?? req.headers.get("last-event-id");
  const cursor = raw && Number.isFinite(Number(raw)) ? Math.max(0, Math.floor(Number(raw))) : 0;

  return new Response(chatRunStream(id, { cursor }), {
    headers: { ...UI_MESSAGE_STREAM_HEADERS, "x-chat-run-id": id },
  });
});
