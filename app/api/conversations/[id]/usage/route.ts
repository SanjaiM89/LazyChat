import { NextRequest } from "next/server";

import { findModel } from "@/lib/models";
import { getConversation } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Token accounting for the composer status bar (dsh usage-pill equivalent). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conv = await getConversation(id);
  if (!conv) return Response.json({ error: "not found" }, { status: 404 });
  const contextWindow =
    findModel(conv.provider as never, conv.model)?.context ?? 128_000;
  return Response.json({
    usage: conv.usage ?? { inputTokens: 0, outputTokens: 0 },
    lastRun: conv.lastRun ?? null,
    provider: conv.provider,
    model: conv.model,
    contextWindow,
  });
}
