import { getChatRunSnapshot, getRunOwner, stopChatRun } from "@/lib/chat-runs";
import { authed } from "@/lib/auth/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = authed<{ id: string }>(async (_req, user, { params }) => {
  const { id } = await params;
  if (getRunOwner(id) !== user.uid) return Response.json({ error: "not found" }, { status: 404 });
  const snapshot = await getChatRunSnapshot(id);
  if (!snapshot) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(snapshot);
});

export const DELETE = authed<{ id: string }>(async (_req, user, { params }) => {
  const { id } = await params;
  if (getRunOwner(id) !== user.uid) return Response.json({ error: "not found" }, { status: 404 });
  const ok = await stopChatRun(id);
  if (!ok) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
});
