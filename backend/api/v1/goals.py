from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from services.goals import (
    create_goal,
    get_goal,
    start_goal_round,
    update_goal,
)

router = APIRouter()


@router.post("/create")
async def create(payload: dict[str, Any]) -> dict[str, Any]:
    conv_id = payload.get("conversation_id", "default")
    return await create_goal(conv_id, payload.get("objective", ""), payload.get("max_goal_rounds"))


@router.get("/{conv_id}")
async def read(conv_id: str) -> dict[str, Any]:
    g = await get_goal(conv_id)
    from services.goals import activation_of, goal_wire
    return goal_wire(g, activation_of(conv_id))


@router.post("/update")
async def update(payload: dict[str, Any]) -> dict[str, Any]:
    return await update_goal(
        payload.get("conversation_id", "default"),
        payload["goal_id"],
        payload["revision"],
        payload["action"],
        payload.get("objective"),
        payload.get("max_goal_rounds"),
        payload.get("blocked_reason"),
    )


@router.post("/start_round")
async def start_round(payload: dict[str, Any]) -> dict[str, Any]:
    res = await start_goal_round(payload.get("conversation_id", "default"))
    return res or {"round": None}
