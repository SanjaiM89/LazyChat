import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { forkConversation, readTurns } from "@/lib/session-log";
import { getConversation } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    const { conversation_id, fork_at, title } = await req.json();
    if (!conversation_id) {
      return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
    }

    const newId = await forkConversation(conversation_id, fork_at);
    const { createArtifactFile } = await import("@/lib/artifacts");
    await createArtifactFile({
      title: title || `Fork of ${conversation_id}`,
      type: "text",
      content: `Forked from conversation ${conversation_id}${fork_at ? ` at turn ${fork_at}` : ""}.`,
      conversationId: newId,
    });

    return NextResponse.json({
      forked_from: conversation_id,
      new_id: newId,
      turns_copied: readTurns(newId).length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const convId = searchParams.get("conversation_id");
  if (!convId) {
    return NextResponse.json({ error: "conversation_id query param is required" }, { status: 400 });
  }
  const turns = readTurns(convId);
  const conv = await getConversation(convId);
  return NextResponse.json({
    conversation_id: convId,
    title: conv?.title,
    turn_count: turns.length,
    schema_version: turns[0]?.schema_version,
    turns: turns.map((t) => ({
      seq: t.seq,
      role: t.role,
      content: t.content.slice(0, 200),
      has_tool_calls: !!t.tool_calls,
      ts: t.ts,
    })),
  });
}
