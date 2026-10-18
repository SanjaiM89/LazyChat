import { authed } from "@/lib/auth/context";
import { getAgent, stopAgent } from "@/lib/agents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = authed<{ id: string }>(async (_req, user, { params }) => {
  const { id } = await params;
  const agent = getAgent(id, user.uid);
  if (!agent) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(agent);
});

export const DELETE = authed<{ id: string }>(async (_req, user, { params }) => {
  const { id } = await params;
  if (getAgent(id, user.uid)) await stopAgent(id);
  return Response.json({ ok: true });
});
