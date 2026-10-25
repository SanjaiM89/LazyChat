from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from config.settings import get_settings
from core.logging import get_logger

logger = get_logger("skills")


@dataclass
class Skill:
    id: str
    name: str
    description: str
    prompt: str
    enabled: bool = True
    updated_at: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class SkillService:
    def __init__(self) -> None:
        self.path = Path(get_settings().data_dir) / "skills.json"

    def _read(self) -> list[Skill]:
        if not self.path.exists():
            return []
        try:
            raw = json.loads(self.path.read_text())
        except Exception as e:  # noqa: BLE001
            logger.error("failed to read skills", error=str(e))
            return []
        out = []
        for item in raw:
            out.append(Skill(**item))
        out.sort(key=lambda s: s.updated_at, reverse=True)
        return out

    def _write(self, skills: list[Skill]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps([s.to_dict() for s in skills], indent=2))

    async def list(self) -> list[Skill]:
        return self._read()

    async def save(self, skill: Skill) -> list[Skill]:
        all_skills = self._read()
        idx = next((i for i, s in enumerate(all_skills) if s.id == skill.id), -1)
        if idx >= 0:
            all_skills[idx] = skill
        else:
            all_skills.insert(0, skill)
        skill.updated_at = int(datetime.now().timestamp() * 1000)
        self._write(all_skills)
        return all_skills

    async def delete(self, skill_id: str) -> list[Skill]:
        all_skills = [s for s in self._read() if s.id != skill_id]
        self._write(all_skills)
        return all_skills

    async def build_prompt(self) -> str:
        skills = [s for s in self._read() if s.enabled]
        if not skills:
            return ""
        body = "\n\n".join(
            f"## Skill: {s.name}\n{s.description}\n\nWhen the user's request matches this skill, follow its instructions:\n{s.prompt}"
            for s in skills
        )
        return f"\n\n---\nYou have the following skills available:\n{body}\n"