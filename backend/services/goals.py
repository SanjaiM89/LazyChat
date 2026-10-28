from __future__ import annotations

import json
import os
from typing import Any

from core.logging import get_logger

from .goal_model import (
    GoalActivation,
    GoalRecord,
    admit_goal_round,
    create_goal_record,
    goal_wire,
    normalize_goal,
    render_goal_round_prompt,
    update_goal_record,
)

logger = get_logger("goals")

GOALS_FILE = "goals.json"
_activations: dict[str, GoalActivation] = {}


def _goals_path() -> str:
    return os.path.join(os.getenv("DATA_DIR", "./data"), GOALS_FILE)


def _load_goals() -> list[GoalRecord]:
    path = _goals_path()
    if not os.path.exists(path):
        return []
    try:
        with open(path) as f:
            raw = json.load(f)
    except Exception:
        return []
    goals = []
    for row in raw or []:
        g = normalize_goal(row)
        if g:
            goals.append(g)
    return goals


def _save_goals(goals: list[GoalRecord]) -> None:
    path = _goals_path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        json.dump([g.to_dict() for g in goals], f, indent=2)


def activation_of(conv_id: str) -> GoalActivation:
    return _activations.get(conv_id, "disarmed")


def arm(conv_id: str) -> None:
    _activations[conv_id] = "armed"


def disarm(conv_id: str) -> None:
    _activations[conv_id] = "disarmed"


async def get_goal(conv_id: str) -> GoalRecord | None:
    goals = _load_goals()
    candidates = [g for g in goals if g.conversationId == conv_id]
    if not candidates:
        return None
    return max(candidates, key=lambda g: g.createdAt)


async def create_goal(conv_id: str, objective: str, max_goal_rounds: int | None = None) -> dict[str, Any]:
    goals = _load_goals()
    current = sorted([g for g in goals if g.conversationId == conv_id], key=lambda g: g.createdAt, reverse=True)
    current = current[0] if current else None
    if current and current.phase != "complete":
        return {"error": f'goal "{current.id}" already exists with phase "{current.phase}"; resume, complete, or block it before creating a new one.', "existing_id": current.id}
    import uuid
    goal = create_goal_record({"id": f"goal-{uuid.uuid4().hex[:10]}", "conversationId": conv_id, "objective": objective, "maxGoalRounds": max_goal_rounds})
    goals.append(goal)
    _save_goals(goals)
    arm(conv_id)
    return goal_wire(goal, "armed")


async def update_goal(conv_id: str, goal_id: str, revision: int, action: str, objective: str | None = None, max_goal_rounds: int | None = None, blocked_reason: str | None = None) -> dict[str, Any]:
    goals = _load_goals()
    idx = next((i for i, g in enumerate(goals) if g.id == goal_id and g.conversationId == conv_id), -1)
    if idx == -1:
        return {"error": f"No goal with id {goal_id} for this conversation."}
    inp = {"action": action, "revision": revision}
    if objective is not None:
        inp["objective"] = objective
    if max_goal_rounds is not None:
        inp["max_goal_rounds"] = max_goal_rounds
    if blocked_reason is not None:
        inp["blocked_reason"] = blocked_reason
    try:
        next_goal = update_goal_record(goals[idx], inp)
    except ValueError as e:
        return {"error": str(e)}
    goals[idx] = next_goal
    _save_goals(goals)
    if action == "resume":
        arm(conv_id)
    elif action in ("pause", "complete", "blocked"):
        disarm(conv_id)
    return goal_wire(next_goal, activation_of(conv_id))


async def start_goal_round(conv_id: str) -> dict[str, Any] | None:
    if os.getenv("OMNIA_GOAL_DRIVER") == "0":
        return None
    goals = _load_goals()
    candidates = [(g, i) for i, g in enumerate(goals) if g.conversationId == conv_id]
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0].createdAt, reverse=True)
    idx = candidates[0][1]
    current = goals[idx]
    admission = admit_goal_round(current, activation_of(conv_id))
    if admission.kind == "none":
        return None
    if admission.kind == "exhausted":
        goals[idx] = admission.goal
        _save_goals(goals)
        disarm(conv_id)
        return None
    goals[idx] = admission.goal
    _save_goals(goals)
    return {"goal": admission.goal, "round": admission.round, "prompt": render_goal_round_prompt(admission.goal, admission.round)}


def arm_goal(conv_id: str) -> None:
    arm(conv_id)


def disarm_goal(conv_id: str) -> None:
    disarm(conv_id)
