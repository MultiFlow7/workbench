"""OpenAI provider：用 openai SDK 调 chat.completions，再回译成 Anthropic SSE 事件。

转换要点：
- Anthropic messages 内的 content blocks（text/tool_use/tool_result）
  需展平为 OpenAI 的 `content`（str）+ `tool_calls` / `tool` role 结构
- Anthropic tools 的 `input_schema` 对应 OpenAI function 的 `parameters`
- 流式回包按 Anthropic SSE 协议序列重放（text 与 tool_use 分别用
  content_block_start / *_delta / content_block_stop 包裹）
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any, AsyncIterator, Optional

from providers.base import AnthropicRequest, BaseProvider


def _anthropic_messages_to_openai(
    messages: list[dict[str, Any]], system: Optional[str]
) -> list[dict[str, Any]]:
    """将 Anthropic messages + system 转 OpenAI chat messages。

    - text block → 拼到 content 字符串
    - tool_use block → 转成 assistant.tool_calls 项
    - tool_result block → 拆成独立 role=tool message
    """
    out: list[dict[str, Any]] = []
    if system:
        out.append({"role": "system", "content": system})

    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")

        # content 是字符串：直接传
        if isinstance(content, str):
            out.append({"role": role, "content": content})
            continue

        # content 是 block 列表
        text_parts: list[str] = []
        tool_calls: list[dict[str, Any]] = []
        tool_results: list[dict[str, Any]] = []

        for block in content:
            btype = block.get("type")
            if btype == "text":
                text_parts.append(block.get("text", ""))
            elif btype == "tool_use":
                tool_calls.append(
                    {
                        "id": block.get("id", f"call_{uuid.uuid4().hex[:8]}"),
                        "type": "function",
                        "function": {
                            "name": block.get("name", ""),
                            "arguments": json.dumps(block.get("input", {})),
                        },
                    }
                )
            elif btype == "tool_result":
                tc = block.get("content", "")
                if isinstance(tc, list):
                    tc = " ".join(
                        c.get("text", "") for c in tc if c.get("type") == "text"
                    )
                tool_results.append(
                    {
                        "role": "tool",
                        "tool_call_id": block.get("tool_use_id", ""),
                        "content": str(tc),
                    }
                )

        if role == "assistant" and tool_calls:
            out.append(
                {
                    "role": "assistant",
                    "content": "\n".join(text_parts) or None,
                    "tool_calls": tool_calls,
                }
            )
        elif tool_results:
            # tool_result 必须独立成 role=tool message
            out.extend(tool_results)
            if text_parts:
                out.append({"role": role, "content": "\n".join(text_parts)})
        else:
            out.append({"role": role, "content": "\n".join(text_parts)})

    return out


def _anthropic_tools_to_openai(
    tools: Optional[list[dict[str, Any]]],
) -> Optional[list[dict[str, Any]]]:
    if not tools:
        return None
    return [
        {
            "type": "function",
            "function": {
                "name": t.get("name", ""),
                "description": t.get("description", ""),
                "parameters": t.get("input_schema", {"type": "object", "properties": {}}),
            },
        }
        for t in tools
    ]


class OpenAIProvider(BaseProvider):
    name = "openai"
    # 子类可覆盖以复用本类做 OpenAI 兼容 endpoint（如 DeepSeek）
    base_url: Optional[str] = None
    env_key_name: str = "OPENAI_API_KEY"

    async def stream_completion(
        self, req: AnthropicRequest, api_key: Optional[str] = None
    ) -> AsyncIterator[dict[str, Any]]:
        from openai import AsyncOpenAI

        key = api_key or os.environ.get(self.env_key_name)
        client_kwargs: dict[str, Any] = {"api_key": key}
        if self.base_url:
            client_kwargs["base_url"] = self.base_url
        client = AsyncOpenAI(**client_kwargs)

        openai_messages = _anthropic_messages_to_openai(req.messages, req.system)
        openai_tools = _anthropic_tools_to_openai(req.tools)

        request_kwargs: dict[str, Any] = {
            "model": req.model,
            "messages": openai_messages,
            "max_tokens": req.max_tokens,
            "stream": True,
        }
        if openai_tools:
            request_kwargs["tools"] = openai_tools
        if req.temperature is not None:
            request_kwargs["temperature"] = req.temperature
        if req.top_p is not None:
            request_kwargs["top_p"] = req.top_p

        message_id = f"msg_{uuid.uuid4().hex[:24]}"
        yield {
            "type": "message_start",
            "message": {
                "id": message_id,
                "type": "message",
                "role": "assistant",
                "model": req.model,
                "content": [],
                "stop_reason": None,
                "stop_sequence": None,
                "usage": {"input_tokens": 0, "output_tokens": 0},
            },
        }

        # 单文本 block + 可能的多 tool_use block。block index 顺序：text=0, tool_use 依次递增
        text_block_open = False
        text_block_index = 0
        # tool_call.index → block index 映射
        tool_block_map: dict[int, int] = {}
        # tool_call.index → 累计 arguments（用于校验）
        next_block_index = 1
        stop_reason: Optional[str] = None
        usage_tokens = {"input_tokens": 0, "output_tokens": 0}

        stream = await client.chat.completions.create(**request_kwargs)
        async for chunk in stream:
            if not chunk.choices:
                # usage chunk（openai 在 stream_options 开启时会单独发）
                if getattr(chunk, "usage", None):
                    usage_tokens["input_tokens"] = chunk.usage.prompt_tokens or 0
                    usage_tokens["output_tokens"] = chunk.usage.completion_tokens or 0
                continue

            choice = chunk.choices[0]
            delta = choice.delta

            if delta and delta.content:
                if not text_block_open:
                    yield {
                        "type": "content_block_start",
                        "index": text_block_index,
                        "content_block": {"type": "text", "text": ""},
                    }
                    text_block_open = True
                yield {
                    "type": "content_block_delta",
                    "index": text_block_index,
                    "delta": {"type": "text_delta", "text": delta.content},
                }

            if delta and getattr(delta, "tool_calls", None):
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_block_map:
                        # 新 tool_use block 开启
                        block_idx = next_block_index
                        next_block_index += 1
                        tool_block_map[idx] = block_idx
                        yield {
                            "type": "content_block_start",
                            "index": block_idx,
                            "content_block": {
                                "type": "tool_use",
                                "id": tc.id or f"toolu_{uuid.uuid4().hex[:16]}",
                                "name": (tc.function.name if tc.function else "") or "",
                                "input": {},
                            },
                        }
                    block_idx = tool_block_map[idx]
                    if tc.function and tc.function.arguments:
                        yield {
                            "type": "content_block_delta",
                            "index": block_idx,
                            "delta": {
                                "type": "input_json_delta",
                                "partial_json": tc.function.arguments,
                            },
                        }

            if choice.finish_reason:
                fr = choice.finish_reason
                stop_reason = {
                    "stop": "end_turn",
                    "length": "max_tokens",
                    "tool_calls": "tool_use",
                }.get(fr, fr)

        # 关闭仍打开的 block
        if text_block_open:
            yield {"type": "content_block_stop", "index": text_block_index}
        for block_idx in tool_block_map.values():
            yield {"type": "content_block_stop", "index": block_idx}

        yield {
            "type": "message_delta",
            "delta": {"stop_reason": stop_reason, "stop_sequence": None},
            "usage": usage_tokens,
        }
        yield {"type": "message_stop"}
