import { NextRequest } from "next/server";
import { getAgent, stopAgent } from "@/lib/agents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(agent);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await stopAgent(id);
  return Response.json({ ok: true });
}
