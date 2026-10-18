import { NextResponse } from "next/server";
import { authed } from "@/lib/auth/context";
import { sessionAllowed, sessionOwned } from "@/lib/brain/access";

import { askAgent, knownServices, knownTopics } from "@/lib/brain/agent";
import { ensureReady } from "@/lib/brain/bootstrap";
import { GraphError, FalkorClient } from "@/lib/brain/graph";
import { getLlm } from "@/lib/brain/llm";
import { consolidateSession } from "@/lib/brain/memory/consolidation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ChatBody = {
  message?: string;
  session_id?: string | null;
  user_id?: string;
};

/** Answer a question from the graph, returning the answer and its trace. */
export const POST = authed(async (request, user) => {
  await ensureReady();
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ detail: "request body must be JSON" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ detail: "message is required" }, { status: 400 });
  }
  const userId = user.uid; // never trust a client-supplied user id
  const started = Date.now();

  let client: FalkorClient;
  try {
    client = await FalkorClient.get();
  } catch (err) {
    return NextResponse.json({ detail: `graph unavailable: ${(err as Error).message}` }, { status: 503 });
  }

  try {
    if (body.session_id && !(await sessionAllowed(client, body.session_id, userId))) {
      return NextResponse.json({ detail: "not found" }, { status: 404 });
    }
    const result = await askAgent(message, {
      sessionId: body.session_id ?? null,
      userId,
      client,
    });

    console.info(
      `[brain] chat: user=${userId} session=${result.session_id} tools=${result.tool_count} ${Date.now() - started}ms`,
    );

    // Consolidate once the session is long enough, so memory builds up as the
    // user keeps talking rather than only at the end of a session.
    try {
      const llm = getLlm({
        knownServices: await knownServices(client),
        knownTopics: await knownTopics(client),
      });
      await consolidateSession(client, result.session_id, userId, { llm });
    } catch (err) {
      // consolidation must never fail a chat
      console.warn(`[brain] consolidation failed: ${(err as Error).message}`);
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof GraphError) {
      // A graph failure is a 503, not a 500: the product depends on it.
      return NextResponse.json({ detail: `graph unavailable: ${err.message}` }, { status: 503 });
    }
    console.error(`[brain] chat failed: ${(err as Error).stack ?? err}`);
    return NextResponse.json({ detail: "internal server error" }, { status: 500 });
  }
});
