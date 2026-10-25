from __future__ import annotations

from .base import BaseAgent


class DefaultAgent(BaseAgent):
    name = "default"
    system_prompt = "You are LazyChat, a helpful agentic assistant. Use tools when needed."