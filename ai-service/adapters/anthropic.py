"""Anthropic Claude Adapter。

NormalizedMessage ↔ Claude API 双向转换。
Claude 原生即 content block 格式，与 NormalizedMessage 几乎一致，
因此转换逻辑很薄，主要处理 thinking block 保留和流式透传。
"""

import json
import logging
import os
from typing import AsyncGenerator

import httpx

from adapters.base import BaseAdapter
from cache.anthropic import get_cache_inject_index
from models.normalized import (
    ChatRequest,
    ContentBlock,
    NormalizedMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UsageStats,
)

logger = logging.getLogger(__name__)

ANTHROPIC_API_URL = os.environ.get("ANTHROPIC_API_URL", "https://api.anthropic.com/v1/messages")
ANTHROPIC_VERSION = "2023-06-01"


def _block_to_dict(block: ContentBlock) -> dict:
    """将单个 ContentBlock 转为 Claude API 格式 dict（几乎 1:1）。"""
    return block.model_dump()


def _dict_to_block(raw: dict) -> ContentBlock:
    """将 Claude API 响应中的 block dict 转为 ContentBlock。"""
    t = raw.get("type")
    if t == "text":
        return TextBlock(type="text", text=raw["text"])
    if t == "tool_use":
        return ToolUseBlock(
            type="tool_use",
            id=raw["id"],
            name=raw["name"],
            input=raw.get("input", {}),
        )
    if t == "tool_result":
        content = raw.get("content", "")
        if isinstance(content, list):
            # Claude 有时将 tool_result content 放在 list 里
            content = " ".join(
                c.get("text", "") for c in content if c.get("type") == "text"
            )
        return ToolResultBlock(
            type="tool_result",
            tool_use_id=raw["tool_use_id"],
            content=content,
        )
    if t == "thinking":
        return ThinkingBlock(type="thinking", thinking=raw.get("thinking", ""))
    # 未知类型 fallback 为 text
    return TextBlock(type="text", text=json.dumps(raw))


class AnthropicAdapter(BaseAdapter):
    provider = "anthropic"

    def to_api_messages(self, messages: list[NormalizedMessage]) -> list[dict]:
        """Claude 原生即 content block 格式，直接序列化。

        Tool result blocks 在 normalized 中位于 user message 的 content 数组里，
        Claude API 要求每个 tool_result 单独放在 user message 中，
        这里按 Claude API 规范整理：若 user message 只含 tool_result blocks，
        保持原样；混合时各 block 已按 API 规范排列（前端保证）。

        如果 messages 是 _AnnotatedMessageList（由 AnthropicCacheStrategy.apply() 返回），
        会在标记的 message 的最后一个 block 上注入 cache_control。
        """
        cache_inject_index = get_cache_inject_index(messages)
        result = []
        for idx, msg in enumerate(messages):
            content_list = [_block_to_dict(b) for b in msg.content]
            # 如果此 message 被标记需要注入 cache_control，在最后一个 block 上添加
            if cache_inject_index is not None and idx == cache_inject_index:
                if content_list:
                    content_list[-1] = dict(
                        content_list[-1],
                        cache_control={"type": "ephemeral"},
                    )
            result.append({"role": msg.role, "content": content_list})
        return result

    def from_api_response(self, response: dict) -> NormalizedMessage:
        """Claude 响应 → NormalizedMessage，1:1 映射，thinking block 保留。"""
        raw_content = response.get("content", [])
        blocks: list[ContentBlock] = [_dict_to_block(b) for b in raw_content]
        return NormalizedMessage(role="assistant", content=blocks)

    def _build_headers(self, api_key: str) -> dict:
        return {
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

    def _build_body(
        self, messages: list[NormalizedMessage], request: ChatRequest, stream: bool
    ) -> dict:
        body: dict = {
            "model": request.model,
            "messages": self.to_api_messages(messages),
            "max_tokens": request.max_tokens,
            "stream": stream,
        }
        if request.tools:
            body["tools"] = request.tools
        return body

    async def stream(
        self,
        messages: list[NormalizedMessage],
        request: ChatRequest,
        api_key: str,
    ) -> AsyncGenerator[str, None]:
        """流式调用 Claude API，逐行透传 SSE 数据。

        流结束时（收到 message_stop 事件）尝试记录 usage。
        """
        body = self._build_body(messages, request, stream=True)
        headers = self._build_headers(api_key)

        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST", ANTHROPIC_API_URL, headers=headers, json=body
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        yield f"{line}\n\n"
                        # 流结束后记录 usage（不阻塞 yield）
                        data_str = line[len("data: "):]
                        try:
                            data = json.loads(data_str)
                            if data.get("type") == "message_delta":
                                usage_raw = data.get("usage", {})
                                from gateway.cost import log_usage
                                usage = UsageStats(
                                    input_tokens=0,
                                    output_tokens=usage_raw.get("output_tokens", 0),
                                )
                                log_usage(request.model, usage)
                        except Exception:
                            pass
                    elif line.startswith("event: "):
                        yield f"{line}\n\n"

    async def complete(
        self,
        messages: list[NormalizedMessage],
        request: ChatRequest,
        api_key: str,
    ) -> dict:
        """非流式调用 Claude API，返回标准 ChatResponse dict。"""
        body = self._build_body(messages, request, stream=False)
        headers = self._build_headers(api_key)

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                ANTHROPIC_API_URL, headers=headers, json=body
            )
            resp.raise_for_status()
            data = resp.json()

        msg = self.from_api_response(data)
        usage_raw = data.get("usage", {})
        usage = UsageStats(
            input_tokens=usage_raw.get("input_tokens", 0),
            output_tokens=usage_raw.get("output_tokens", 0),
            cache_read_input_tokens=usage_raw.get("cache_read_input_tokens", 0),
            cache_creation_input_tokens=usage_raw.get(
                "cache_creation_input_tokens", 0
            ),
        )

        from gateway.cost import log_usage
        log_usage(request.model, usage)

        return {
            "role": "assistant",
            "content": [b.model_dump() for b in msg.content],
            "usage": usage.model_dump(),
        }
