from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class BrainNode(BaseModel):
    id: str
    label: str
    name: str
    labels: list[str] = Field(default_factory=list)
    properties: dict[str, Any] = Field(default_factory=dict)
    element_id: int | None = None
    color: str | None = None


class BrainEdge(BaseModel):
    id: int | None = None
    source: str
    target: str
    type: str
    properties: dict[str, Any] | None = None


class SubGraph(BaseModel):
    nodes: list[BrainNode] = Field(default_factory=list)
    edges: list[BrainEdge] = Field(default_factory=list)


class TraceStep(BaseModel):
    tool: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    cypher: str | None = None
    result_summary: str | None = None
    row_count: int | None = None
    duration_ms: int | None = None
    error: str | None = None
    round: int | None = None


class Finding(BaseModel):
    id: str | None = None
    agent: str
    summary: str
    turn_ref: str | None = None
    data: Any = None
    created_at: str | None = None


class MemoryNode(BaseModel):
    id: str
    summary: str
    kind: str  # episodic | semantic
    timestamp: str | None = None
    about: list[str] = Field(default_factory=list)