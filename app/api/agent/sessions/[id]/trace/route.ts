import { authed } from "@/lib/auth/context";
import { listEvents } from "@/lib/agent/session";

export const dynamic = "force-dynamic";

/** The event log of one conversation: the turns, steps and tool calls it holds. */
export const GET = authed(async (_req, _user, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const events = listEvents(id, { limit: 1000 });
  return Response.json({
    conversation_id: id,
    count: events.length,
    events: events.map((event) => ({
      seq: event.seq,
      type: event.type,
      at: event.created_at,
      run_id: event.run_id,
      data: event.data,
    })),
  });
});
