import "server-only";

import type { SkillDef } from "@/lib/types";
import { readJSON, writeJSON } from "@/lib/store";


export async function listSkills(): Promise<SkillDef[]> {
  const data = await readJSON<SkillDef[]>("skills.json", []);
  return data.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveSkill(skill: SkillDef): Promise<SkillDef[]> {
  const all = await listSkills();
  const idx = all.findIndex((s) => s.id === skill.id);
  if (idx >= 0) all[idx] = skill;
  else all.unshift(skill);
  await writeJSON("skills.json", all);
  return all;
}

export async function deleteSkill(id: string): Promise<SkillDef[]> {
  const all = await listSkills();
  await writeJSON("skills.json", all.filter((s) => s.id !== id));
  return all.filter((s) => s.id !== id);
}

export async function buildSkillsPrompt(): Promise<string> {
  const skills = (await listSkills()).filter((s) => s.enabled);
  if (!skills.length) return "";
  const body = skills
    .map(
      (s) =>
        `## Skill: ${s.name}\n${s.description}\n\nWhen the user's request matches this skill, follow its instructions:\n${s.prompt}`,
    )
    .join("\n\n");
  return `\n\n---\nYou have the following skills available:\n${body}\n`;
}
