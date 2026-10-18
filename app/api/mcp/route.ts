import { scoped } from "@/lib/auth/context";
import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { listMCPServers, saveMCPServers, connectMCPServer, disconnectMCPServer, allMCPTools } from "@/lib/mcp";

export const dynamic = "force-dynamic";

async function GET_impl() {
  const servers = await listMCPServers();
  const tools = await allMCPTools();
  return Response.json({ servers, tools });
}

async function POST_impl(req: NextRequest) {
  const body = await req.json();
  if (!body.name) return Response.json({ error: "name required" }, { status: 400 });
  if (!["stdio", "http"].includes(body.type)) {
    return Response.json({ error: "type must be stdio or http" }, { status: 400 });
  }

  const def = {
    id: body.id || nanoid(10),
    name: body.name,
    enabled: body.enabled ?? true,
    type: body.type,
    command: body.command,
    args: body.args || [],
    url: body.url,
    env: body.env || {},
  };

  const servers = await listMCPServers();
  const idx = servers.findIndex((s) => s.id === def.id);
  if (idx >= 0) servers[idx] = def;
  else servers.push(def);
  await saveMCPServers(servers);

  if (def.enabled) {
    await connectMCPServer(def);
  }
  return Response.json({ servers: await listMCPServers(), tools: await allMCPTools() });
}

async function DELETE_impl(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await disconnectMCPServer(id);
  const servers = (await listMCPServers()).filter((s) => s.id !== id);
  await saveMCPServers(servers);
  return Response.json({ servers, tools: await allMCPTools() });
}

async function PUT_impl(req: NextRequest) {
  const body = await req.json();
  const id = body.id;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const servers = await listMCPServers();
  const def = servers.find((s) => s.id === id);
  if (!def) return Response.json({ error: "server not found" }, { status: 404 });

  if (body.connect === true) {
    const res = await connectMCPServer(def);
    return Response.json({ ok: res.ok, error: res.error, servers: await listMCPServers(), tools: await allMCPTools() });
  }
  if (body.connect === false) {
    await disconnectMCPServer(id);
    const list = (await listMCPServers()).map((s) => (s.id === id ? { ...s, status: "disconnected" as const } : s));
    await saveMCPServers(list);
    return Response.json({ servers: await listMCPServers(), tools: await allMCPTools() });
  }
  return Response.json({ error: "unknown action" }, { status: 400 });
}

export const GET = scoped(GET_impl, { adminWrites: true });
export const POST = scoped(POST_impl, { adminWrites: true });
export const DELETE = scoped(DELETE_impl, { adminWrites: true });
export const PUT = scoped(PUT_impl, { adminWrites: true });
