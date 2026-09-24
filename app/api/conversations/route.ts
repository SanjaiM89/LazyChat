import { NextRequest } from "next/server";
import {
  listConversations,
  saveConversation,
  clearConversations,
  type StoredConversation,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const conversations = await listConversations();
  return Response.json(conversations.map(({ messages, ...meta }) => meta));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.id || !body.messages) {
    return Response.json({ error: "id and messages required" }, { status: 400 });
  }
  const conv: StoredConversation = {
    id: body.id,
    title:
      body.title ||
      (body.messages.find((m: any) => m.role === "user")?.content?.[0]?.text ||
        body.messages.find((m: any) => m.role === "user")?.content ||
        "New chat").toString().slice(0, 80),
    createdAt: body.createdAt || Date.now(),
    updatedAt: Date.now(),
    provider: body.provider || "anthropic",
    model: body.model || "",
    messages: body.messages,
  };
  await saveConversation(conv);
  return Response.json({ ok: true });
}

export async function DELETE() {
  await clearConversations();
  return Response.json({ ok: true });
}
