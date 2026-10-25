from __future__ import annotations

from typing import ClassVar

from .base import BaseAgent


class DefaultAgent(BaseAgent):
    name: ClassVar[str] = "default"
    system_prompt = "You are LazyChat, a helpful agentic assistant. Use tools when needed."