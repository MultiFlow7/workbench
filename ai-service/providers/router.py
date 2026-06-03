"""按 model 前缀路由到具体 provider。

集中在此处维护 prefix → provider 映射，便于未来扩展。
"""

from __future__ import annotations

from providers.anthropic_provider import AnthropicProvider
from providers.base import BaseProvider
from providers.deepseek_provider import DeepSeekProvider
from providers.gemini_provider import GeminiProvider
from providers.openai_provider import OpenAIProvider

# prefix 顺序：长前缀放前面，避免被短前缀误匹配
_PREFIX_PROVIDER_MAP: list[tuple[str, type[BaseProvider]]] = [
    ("claude-", AnthropicProvider),
    ("deepseek-", DeepSeekProvider),
    ("gemini-", GeminiProvider),
    ("gpt-", OpenAIProvider),
]


def route_to_provider(model: str) -> BaseProvider:
    """按 model 前缀实例化对应 provider。"""
    if model.startswith("claude-"):
        return AnthropicProvider()
    if model.startswith("gpt-"):
        return OpenAIProvider()
    if model.startswith("gemini-"):
        return GeminiProvider()
    if model.startswith("deepseek-"):
        return DeepSeekProvider()
    raise ValueError(f"Unknown model: {model}")
