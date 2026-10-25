from __future__ import annotations

import json

from models.chat import AgentRun, ChatMessage, MessageRole, RunStatus
from services.llm import LLMClient, default_llm
from tools.registry import registry


class BaseAgent:
    name: str = "base"
    system_prompt: str = "You are a helpful assistant."

    def __init__(self, llm: LLMClient | None = None) -> None:
        self.llm = llm if llm is not None else default_llm()

    async def run(self, run: AgentRun, user_input: str) -> AgentRun:
        run.messages.append(ChatMessage(role=MessageRole.user, content=user_input, id=f"u-{len(run.messages)}"))
        oai_msgs: list[dict] = [{"role": "system", "content": self.system_prompt}]
        for m in run.messages:
            oai_msgs.append({"role": m.role.value, "content": m.content})
        tools = registry.schemas()

        for _ in range(10):
            resp = await self.llm.chat(oai_msgs, tools=tools)
            choice = resp["choices"][0]["message"]
            tool_calls = choice.get("tool_calls") or []
            content = choice.get("content") or ""
            if content:
                run.messages.append(ChatMessage(role=MessageRole.assistant, content=content, id=f"a-{len(run.messages)}"))
                oai_msgs.append({"role": "assistant", "content": content})
            if not tool_calls:
                break
            for tc in tool_calls:
                fn = tc["function"]["name"]
                try:
                    args = json.loads(tc["function"].get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                tool = registry.get(fn)
                if tool is None:
                    result = {"error": f"unknown tool {fn}"}
                else:
                    tr = await tool.run(**args)
                    result = tr.model_dump()
                oai_msgs.append({"role": "tool", "tool_call_id": tc["id"], "content": json.dumps(result)})
                run.messages.append(
                    ChatMessage(role=MessageRole.tool, content=json.dumps(result), tool_call_id=tc["id"], id=f"t-{len(run.messages)}")
                )
        run.status = RunStatus.completed
        return run