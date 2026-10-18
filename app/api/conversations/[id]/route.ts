import { authed } from "@/lib/auth/context";
import { getConversation, deleteConversation } from "@/lib/store";
import { activeChatRuns, stopChatRun } from "@/lib/chat-runs";

export const dynamic = "force-dynamic";

export const GET = authed<{ id: string }>(async (_req, user, { params }) => {
  const { id } = await params;
  const conv = await getConversation(id, user.uid);
  if (!conv) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(conv);
});

export const DELETE = authed<{ id: string }>(async (_req, user, { params }) => {
  const { id } = await params;
  if (!(await getConversation(id, user.uid))) return Response.json({ ok: true });
  for (const run of activeChatRuns(id)) {
    await stopChatRun(run.id);
  }
  await deleteConversation(id, user.uid);
  return Response.json({ ok: true });
});
