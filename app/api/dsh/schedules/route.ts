import { NextResponse } from "next/server";
import { listConversations, readJSON } from "@/lib/store";
import { authed } from "@/lib/auth/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ScheduleSummary {
  id: string;
  title: string;
  prompt: string;
  next_delivery: number;
  delivered: number;
  active: boolean;
  created_at: number;
  updated_at: number;
}

export const GET = authed(async (request, user) => {
  const { searchParams } = new URL(request.url);
  const convId = searchParams.get("conversationId");

  // Schedules are tied to conversations, so a user sees only those of their own chats.
  const mine = new Set((await listConversations(user.uid)).map((c) => c.id));
  const schedules: any[] = (await readJSON<any[]>("schedules.json", [])).filter((s) => s.conversationId && mine.has(s.conversationId));
  const pending: any[] = (await readJSON<any[]>("pending-reminders.json", [])).filter((r) => r.conversationId && mine.has(r.conversationId));

  const list: ScheduleSummary[] = schedules
    .filter((s) => (convId ? s.conversationId === convId : true))
    .map((s) => ({
      id: s.id,
      title: s.title,
      prompt: s.prompt,
      next_delivery: s.nextDelivery,
      delivered: s.deliveryCount,
      active: s.active,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    }))
    .sort((a, b) => a.next_delivery - b.next_delivery);

  return NextResponse.json({ schedules: list, pending_reminders: pending.length });
});
