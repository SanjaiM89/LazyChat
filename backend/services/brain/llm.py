from __future__ import annotations

from typing import Any

from core.logging import get_logger
from services.llm import LLMClient, default_llm

logger = get_logger("brain.llm")


def get_llm(opts: dict[str, Any] | None = None) -> LLMClient:
    opts = opts or {}
    return default_llm()


class MockLlm:
    """Deterministic offline LLM stub (simplified)."""

    def __init__(self, known_services=None, known_topics=None):
        self.known_services = known_services or []
        self.known_topics = known_topics or []

    async def chat(self, messages, tools=None):
        # Return a simple text response
        return {"choices": [{"message": {"role": "assistant", "content": "I could not find an answer.", "tool_calls": []}}]}

    async def complete(self, messages, system="", tools=None):
        resp = await self.chat(messages, tools)
        msg = resp["choices"][0]["message"]
        return {"text": msg.get("content", ""), "tool_calls": msg.get("tool_calls", [])}

    def tool_result_message(self, call, result):
        return {"role": "tool", "tool_call_id": call.get("id"), "content": str(result)}
