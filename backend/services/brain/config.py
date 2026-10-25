from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

LlmProvider = Literal["sarvam", "anthropic", "mock"]


def env(name: str, fallback: str = "") -> str:
    value = os.getenv(name)
    return value if value not in (None, "") else fallback


@dataclass
class FalkorConfig:
    host: str
    port: int
    graph_name: str
    username: str
    password: str


@dataclass
class SarvamConfig:
    api_key: str
    model: str
    base_url: str


@dataclass
class AnthropicConfig:
    api_key: str
    model: str


@dataclass
class BrainConfig:
    falkordb: FalkorConfig
    provider: LlmProvider
    sarvam: SarvamConfig
    anthropic: AnthropicConfig


def brain_config() -> BrainConfig:
    sarvam_key = env("SARVAM_API_KEY")
    anthropic_key = env("ANTHROPIC_API_KEY")
    forced = env("LLM_PROVIDER").lower()
    force_mock = env("LLM_FORCE_MOCK") == "1"

    if force_mock:
        provider: LlmProvider = "mock"
    elif forced in ("sarvam", "anthropic", "mock"):
        provider = forced  # type: ignore[assignment]
    elif sarvam_key:
        provider = "sarvam"
    elif anthropic_key:
        provider = "anthropic"
    else:
        provider = "mock"

    return BrainConfig(
        falkordb=FalkorConfig(
            host=env("FALKORDB_HOST", "localhost"),
            port=int(env("FALKORDB_PORT", "6379")),
            graph_name=env("FALKORDB_GRAPH_NAME", "company_brain"),
            username=env("FALKORDB_USERNAME"),
            password=env("FALKORDB_PASSWORD"),
        ),
        provider=provider,
        sarvam=SarvamConfig(
            api_key=sarvam_key,
            model=env("SARVAM_MODEL", "sarvam-105b"),
            base_url=env("SARVAM_BASE_URL", "https://api.sarvam.ai/v1"),
        ),
        anthropic=AnthropicConfig(
            api_key=anthropic_key,
            model=env("ANTHROPIC_MODEL", "claude-sonnet-4-5"),
        ),
    )