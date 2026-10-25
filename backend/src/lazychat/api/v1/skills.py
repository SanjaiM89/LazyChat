from __future__ import annotations

from fastapi import APIRouter

from ...skills.service import Skill, SkillService

router = APIRouter()
_service = SkillService()


@router.get("/")
async def list_skills() -> list[dict]:
    return [s.to_dict() for s in await _service.list()]


@router.post("/")
async def save_skill(skill: Skill) -> list[dict]:
    return [s.to_dict() for s in await _service.save(skill)]


@router.delete("/{skill_id}")
async def delete_skill(skill_id: str) -> list[dict]:
    return [s.to_dict() for s in await _service.delete(skill_id)]


@router.get("/prompt")
async def skills_prompt() -> dict:
    return {"prompt": await _service.build_prompt()}