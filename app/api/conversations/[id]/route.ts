import { NextRequest } from "next/server";
import { getConversation, deleteConversation } from "@/lib/store";
import { activeChatRuns, stopChatRun } from "@/lib/chat-runs";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conv = await getConversation(id);
  if (!conv) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(conv);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // A live background run would re-create the conversation on its next
  // checkpoint, so stop it before deleting.
  for (const run of activeChatRuns(id)) {
    await stopChatRun(run.id);
  }
  await deleteConversation(id);
  return Response.json({ ok: true });
}
