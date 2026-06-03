"""Anthropic provider：直通 anthropic SDK，不修改 schema。

由于 Anthropic 本身就是这一层 SSE 协议的来源，几乎是 1:1 透传。
为了与其他 provider 形成一致的「dict 事件」接口，将 SDK 返回的
强类型事件 `.model_dump()` 成 plain dict。
"""

from __future__ import annotations

import os
from typing import Any, AsyncIterator, Optional

from providers.base import AnthropicRequest, BaseProvider


class AnthropicProvider(BaseProvider):
    name = "anthropic"

    async def stream_completion(
        self, req: AnthropicRequest, api_key: Optional[str] = None
    ) -> AsyncIterator[dict[str, Any]]:
        # 延迟导入：避免在未安装 SDK 时影响其他 provider
        from anthropic import AsyncAnthropic

        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        client = AsyncAnthropic(api_key=key)

        kwargs: dict[str, Any] = {
            "model": req.model,
            "messages": req.messages,
            "max_tokens": req.max_tokens,
        }
        if req.system is not None:
            kwargs["system"] = req.system
        if req.tools:
            kwargs["tools"] = req.tools
        if req.temperature is not None:
            kwargs["temperature"] = req.temperature
        if req.top_p is not None:
            kwargs["top_p"] = req.top_p

        async with client.messages.stream(**kwargs) as stream:
            async for event in stream:
                # SDK 事件已经是 Anthropic SSE 协议形状；统一成 dict
                if hasattr(event, "model_dump"):
                    yield event.model_dump()
                elif isinstance(event, dict):
                    yield event
                else:
                    # 兜底：无法识别的事件类型不流出，避免破坏下游解析
                    continue
