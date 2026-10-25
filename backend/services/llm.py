from __future__ import annotations

from typing import Any

import httpx

from config.settings import get_settings


class LLMClient:
    def __init__(self, base_url: str, api_key: str | None, model: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    async def chat(self, messages: list[dict[str, Any]], tools: list[dict] | None = None) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload: dict[str, Any] = {"model": self.model, "messages": messages}
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f"{self.base_url}/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            return resp.json()


def default_llm() -> LLMClient:
    s = get_settings()
    # Prefer DeepSeek if configured, else OpenAI
    if s.deepseek_api_key:
        return LLMClient("https://api.deepseek.com", s.deepseek_api_key, "deepseek-chat")
    return LLMClient("https://api.openai.com/v1", s.openai_api_key, "gpt-4o-mini")