from __future__ import annotations

import copy
import json
import time
from dataclasses import asdict, dataclass
from typing import Any, Literal

DEFAULT_MAX_GOAL_ROUNDS = 256

GoalPhase = Literal["active", "paused", "blocked", "complete"]
GoalAction = Literal["edit", "pause", "resume", "complete", "blocked"]
GoalActivation = Literal["armed", "disarmed"]


@dataclass
class GoalBlockedReason:
    code: str
    message: str


@dataclass
class GoalRecord:
    id: str
    conversationId: str
    objective: str
    phase: GoalPhase
    revision: int
    roundsStarted: int
    maxGoalRounds: int
    blockedReason: GoalBlockedReason | None = None
    createdAt: int = 0
    updatedAt: int = 0

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        if self.blockedReason is None:
            d.pop("blockedReason", None)
        return d


def _now_ms() -> int:
    return int(time.time() * 1000)


def positive_integer(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{field} must be a positive safe integer")
    return value


def objective_text(value: str) -> str:
    text = (value or "").strip()
    if text == "":
        raise ValueError("objective must be a non-empty string")
    return text


def normalize_goal(raw: Any) -> GoalRecord | None:
    if not isinstance(raw, dict):
        return None
    legacy_status = raw.get("status") if isinstance(raw.get("status"), str) else ""
    phase = raw.get("phase")
    if phase not in ("active", "paused", "blocked", "complete"):
        if legacy_status == "completed":
            phase = "complete"
        elif legacy_status in ("paused", "blocked", "active"):
            phase = legacy_status
        else:
            phase = "active"
    blocked_reason = None
    br = raw.get("blockedReason")
    if isinstance(br, dict):
        blocked_reason = GoalBlockedReason(code=str(br.get("code", "BLOCKED")), message=str(br.get("message", "")))
    elif isinstance(br, str):
        blocked_reason = GoalBlockedReason(code="BLOCKED", message=br)
    if not isinstance(raw.get("id"), str) or not isinstance(raw.get("conversationId"), str):
        return None
    if not isinstance(raw.get("objective"), str):
        return None
    revision = raw.get("revision")
    if not (isinstance(revision, int) and not isinstance(revision, bool) and revision > 0):
        revision = 1
    rounds = raw.get("roundsStarted")
    if not (isinstance(rounds, int) and not isinstance(rounds, bool) and rounds >= 0):
        r2 = raw.get("round")
        rounds = r2 if isinstance(r2, int) and not isinstance(r2, bool) and r2 >= 0 else 0
    max_rounds = raw.get("maxGoalRounds")
    if not (isinstance(max_rounds, int) and not isinstance(max_rounds, bool) and max_rounds > 0):
        max_rounds = DEFAULT_MAX_GOAL_ROUNDS
    created = raw.get("createdAt")
    if not isinstance(created, int):
        created = int(time.time() * 1000)
    updated = raw.get("updatedAt")
    if not isinstance(updated, int):
        updated = created
    if blocked_reason and not blocked_reason.message:
        blocked_reason = None
    return GoalRecord(
        id=raw["id"],
        conversationId=raw["conversationId"],
        objective=raw["objective"],
        phase=phase,
        revision=revision,
        roundsStarted=rounds,
        maxGoalRounds=max_rounds,
        blockedReason=blocked_reason,
        createdAt=created,
        updatedAt=updated,
    )


def create_goal_record(inp: dict[str, Any]) -> GoalRecord:
    now = inp.get("now", _now_ms())
    max_gr = inp.get("maxGoalRounds")
    if max_gr is None:
        max_gr = DEFAULT_MAX_GOAL_ROUNDS
    else:
        max_gr = positive_integer(max_gr, "max_goal_rounds")
    return GoalRecord(
        id=inp["id"],
        conversationId=inp["conversationId"],
        objective=objective_text(inp["objective"]),
        phase="active",
        revision=1,
        roundsStarted=0,
        maxGoalRounds=max_gr,
        createdAt=now,
        updatedAt=now,
    )


def update_goal_record(goal: GoalRecord, inp: dict[str, Any], now: int | None = None) -> GoalRecord:
    now = now if now is not None else _now_ms()
    if inp.get("revision") != goal.revision:
        raise ValueError(f"goal revision mismatch: expected {goal.revision}, got {inp.get('revision')}; call get_goal and retry")
    next_goal = copy.deepcopy(goal)
    next_goal.updatedAt = now
    action = inp.get("action")
    objective = inp.get("objective")
    max_goal_rounds = inp.get("max_goal_rounds")
    blocked_reason = inp.get("blocked_reason")
    has_objective = objective is not None and str(objective).strip() != ""
    has_round_cap = max_goal_rounds is not None and max_goal_rounds != 0

    if action == "edit":
        if not has_objective and not has_round_cap:
            raise ValueError("goal edit requires objective and/or max_goal_rounds")
        if blocked_reason is not None:
            raise ValueError("blocked_reason is valid only with action blocked")
        if has_objective:
            next_goal.objective = objective_text(objective)
        if has_round_cap:
            next_goal.maxGoalRounds = positive_integer(max_goal_rounds, "max_goal_rounds")
    elif action == "pause":
        if has_objective or has_round_cap or blocked_reason is not None:
            raise ValueError("objective and max_goal_rounds are valid only with action edit; blocked_reason is valid only with action blocked")
        if next_goal.phase == "complete":
            raise ValueError(f"goal \"{next_goal.id}\" is complete and cannot be paused")
        next_goal.phase = "paused"
    elif action == "resume":
        if has_objective or has_round_cap or blocked_reason is not None:
            raise ValueError("objective and max_goal_rounds are valid only with action edit; blocked_reason is valid only with action blocked")
        if next_goal.roundsStarted >= next_goal.maxGoalRounds:
            raise ValueError(f"goal \"{next_goal.id}\" exhausted {next_goal.maxGoalRounds} goal rounds; increase max_goal_rounds before resuming")
        next_goal.phase = "active"
        next_goal.blockedReason = None
    elif action == "complete":
        if has_objective or has_round_cap:
            raise ValueError("objective and max_goal_rounds are valid only with action edit")
        if blocked_reason is not None:
            raise ValueError("blocked_reason is valid only with action blocked")
        next_goal.phase = "complete"
        next_goal.blockedReason = None
    elif action == "blocked":
        if has_objective or has_round_cap:
            raise ValueError("objective and max_goal_rounds are valid only with action edit")
        if blocked_reason is None or str(blocked_reason).strip() == "":
            raise ValueError("blocked_reason is required for the blocked action")
        next_goal.phase = "blocked"
        next_goal.blockedReason = GoalBlockedReason(code="BLOCKED", message=str(blocked_reason).strip())
    else:
        raise ValueError(f"unknown goal action: {action}")

    next_goal.revision = goal.revision + 1
    return next_goal


def goal_wire(goal: GoalRecord | None, activation: GoalActivation) -> dict[str, Any]:
    if goal is None:
        return {"goal": None}
    out = {
        "goal": {
            "id": goal.id,
            "revision": goal.revision,
            "objective": goal.objective,
            "phase": goal.phase,
            "roundsStarted": goal.roundsStarted,
            "maxGoalRounds": goal.maxGoalRounds,
        },
        "activation": activation,
    }
    if goal.blockedReason:
        out["goal"]["blockedReason"] = {"code": goal.blockedReason.code, "message": goal.blockedReason.message}
    return out


def can_start_goal_round(goal: GoalRecord | None, activation: GoalActivation) -> bool:
    return (
        goal is not None
        and goal.phase == "active"
        and activation == "armed"
        and goal.roundsStarted < goal.maxGoalRounds
    )


@dataclass
class GoalRoundAdmission:
    kind: str
    goal: GoalRecord | None = None
    round: int | None = None


def admit_goal_round(goal: GoalRecord, activation: GoalActivation, now: int | None = None) -> GoalRoundAdmission:
    now = now if now is not None else _now_ms()
    if goal.phase != "active" or activation != "armed":
        return GoalRoundAdmission(kind="none")
    if goal.roundsStarted >= goal.maxGoalRounds:
        return GoalRoundAdmission(kind="exhausted", goal=GoalRecord(
            id=goal.id, conversationId=goal.conversationId, objective=goal.objective, phase="blocked",
            revision=goal.revision + 1, roundsStarted=goal.roundsStarted, maxGoalRounds=goal.maxGoalRounds,
            blockedReason=GoalBlockedReason(code="GOAL_ROUNDS_EXHAUSTED", message=f"goal \"{goal.id}\" exhausted {goal.maxGoalRounds} goal rounds"),
            createdAt=goal.createdAt, updatedAt=now,
        ))
    return GoalRoundAdmission(kind="start", round=goal.roundsStarted + 1, goal=GoalRecord(
        id=goal.id, conversationId=goal.conversationId, objective=goal.objective, phase=goal.phase,
        revision=goal.revision + 1, roundsStarted=goal.roundsStarted + 1, maxGoalRounds=goal.maxGoalRounds,
        blockedReason=goal.blockedReason, createdAt=goal.createdAt, updatedAt=now,
    ))


def is_goal_round_prompt(text: str) -> bool:
    trimmed = (text or "").strip()
    return trimmed.startswith("<goal_round>") and trimmed.endswith("</goal_round>")


def render_goal_round_prompt(goal: GoalRecord, round: int) -> str:
    return (
        "<goal_round>\n"
        f"Objective: {json.dumps(goal.objective)}\n"
        f"Round: {round}/{goal.maxGoalRounds}\n\n"
        "Continue working toward the objective in this same session.\n"
        "</goal_round>"
    )
