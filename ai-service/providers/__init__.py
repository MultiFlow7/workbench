"""Providers 层：将 Anthropic Messages API 入参路由到具体 LLM provider，

并将各 provider 原生响应统一回 Anthropic SSE event 序列。

新增 provider 时：
1. 在本目录新增 `<name>_provider.py`，继承 `BaseProvider`
2. 在 `router.py` 的 `route_to_provider()` 加前缀分支
"""

from providers.base import AnthropicRequest, BaseProvider

__all__ = ["AnthropicRequest", "BaseProvider"]
