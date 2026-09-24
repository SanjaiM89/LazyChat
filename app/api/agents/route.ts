import { NextRequest } from "next/server";
import { getAgents, spawnAgent, cleanupFinishedAgents } from "@/lib/agents";
import { defaultModelForProvider } from "@/lib/custom-providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  cleanupFinishedAgents();
  return Response.json(getAgents());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.task || !body.task.trim()) {
    return Response.json({ error: "task required" }, { status: 400 });
  }
  try {
    const provider = body.provider || "anthropic";
    const model =
      body.model || (await defaultModelForProvider(provider)) || "claude-sonnet-5";
    const agent = await spawnAgent({
      task: body.task,
      provider,
      model,
      engine: body.engine || "tool-loop",
      label: body.label,
      image: body.image,
      research: body.research === true,
    });
    return Response.json(agent, { status: 201 });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
