import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { listSkills, saveSkill, deleteSkill } from "@/lib/skills";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listSkills());
}

export async function POST(req: NextRequest) {
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

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  return Response.json(await deleteSkill(id));
}
