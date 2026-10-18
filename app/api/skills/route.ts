import { scoped } from "@/lib/auth/context";
import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { listSkills, saveSkill, deleteSkill } from "@/lib/skills";

export const dynamic = "force-dynamic";

async function GET_impl() {
  return Response.json(await listSkills());
}

async function POST_impl(req: NextRequest) {
  const body = await req.json();
  if (!body.name || !body.description) {
    return Response.json({ error: "name and description required" }, { status: 400 });
  }
  const skill = {
    id: body.id || nanoid(10),
    name: body.name,
    description: body.description,
    prompt: body.prompt || body.description,
    enabled: body.enabled ?? true,
    updatedAt: Date.now(),
  };
  const all = await saveSkill(skill);
  return Response.json(all);
}

async function DELETE_impl(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  return Response.json(await deleteSkill(id));
}

export const GET = scoped(GET_impl, { adminWrites: true });
export const POST = scoped(POST_impl, { adminWrites: true });
export const DELETE = scoped(DELETE_impl, { adminWrites: true });
