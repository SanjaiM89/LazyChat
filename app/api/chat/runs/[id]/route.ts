import { getChatRunSnapshot, stopChatRun } from "@/lib/chat-runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const snapshot = await getChatRunSnapshot(id);
  if (!snapshot) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(snapshot);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = await stopChatRun(id);
  if (!ok) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}
