"""OpenAI Adapter。

NormalizedMessage ↔ OpenAI API 双向转换。

转换规则：
- TextBlock → content: str（string，非 array）
- ToolUseBlock（assistant）→ tool_calls: [{id, type:"function", function:{name, arguments}}]
- ToolResultBlock（user）→ role "tool" message: {role:"tool", tool_call_id, content}
- ThinkingBlock → 过滤掉（OpenAI 无 thinking）
- 确定性要求：同一输入永远产生同一输出（JSON 序列化时 sort_keys=True）
"""

import json
import logging
from typing import AsyncGenerator

import httpx

from adapters.base import BaseAdapter
from models.normalized import (
    ChatRequest,
    ContentBlock,
    NormalizedMessage,
    TextBlock,
    ToolUseBlock,
    ToolResultBlock,
    UsageStats,
)

logger = logging.getLogger(__name__)

OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"


def _normalized_to_openai_messages(messages: list[NormalizedMessage]) -> list[dict]:
    """将 NormalizedMessage 列表转为 OpenAI messages 格式。

    确定性要求：sort_keys=True 保证相同输入 JSON 序列化字节完全相同。
    """
    result: list[dict] = []
    for msg in messages:
        role = msg.role  # "user" | "assistant"

        # 过滤 ThinkingBlock，收集各类型 block
        text_blocks = [b for b in msg.content if b.type == "text"]
        tool_use_blocks = [b for b in msg.content if b.type == "tool_use"]
        tool_result_blocks = [b for b in msg.content if b.type == "tool_result"]
        # ThinkingBlock 直接忽略

        if role == "user":
            if tool_result_blocks:
                # tool_result blocks → 各自独立的 role="tool" message
                for tr in tool_result_blocks:
                    assert isinstance(tr, ToolResultBlock)
                    result.append({
                        "role": "tool",
                        "tool_call_id": tr.tool_use_id,
                        "content": tr.content,
                    })
                # 如果还有文字 block，追加普通 user 消息
                if text_blocks:
                    text_content = " ".join(b.text for b in text_blocks
                                            if isinstance(b, TextBlock))
                    result.append({"role": "user", "content": text_content})
            else:
                # 普通 user 消息：content 为 string
                text_content = " ".join(
                    b.text for b in text_blocks if isinstance(b, TextBlock)
                )
                result.append({"role": "user", "content": text_content})

        elif role == "assistant":
            openai_msg: dict = {"role": "assistant"}
            if text_blocks:
                openai_msg["content"] = " ".join(
                    b.text for b in text_blocks if isinstance(b, TextBlock)
                )
            else:
                openai_msg["content"] = None

            if tool_use_blocks:
                tool_calls = []
                for tu in tool_use_blocks:
                    assert isinstance(tu, ToolUseBlock)
                    tool_calls.append({
                        "id": tu.id,
                        "type": "function",
                        "function": {
                            "name": tu.name,
                            # sort_keys=True 保证确定性
                            "arguments": json.dumps(tu.input, sort_keys=True),
                        },
                    })
                openai_msg["tool_calls"] = tool_calls

            result.append(openai_msg)

    return result


def _openai_response_to_normalized(choice: dict) -> NormalizedMessage:
    """OpenAI choice → NormalizedMessage。"""
    msg = choice.get("message", {})
    blocks: list[ContentBlock] = []

    content = msg.get("content")
    if content:
        blocks.append(TextBlock(type="text", text=content))

    tool_calls = msg.get("tool_calls") or []
    for tc in tool_calls:
        fn = tc.get("function", {})
        raw_args = fn.get("arguments", "{}")
        try:
            input_dict = json.loads(raw_args)
        except json.JSONDecodeError:
            input_dict = {"raw": raw_args}
        blocks.append(
            ToolUseBlock(
                type="tool_use",
                id=tc["id"],
                name=fn.get("name", ""),
                input=input_dict,
            )
        )

    return NormalizedMessage(role="assistant", content=blocks)


class OpenAIAdapter(BaseAdapter):
    provider = "openai"
    BASE_URL: str = OPENAI_API_URL

    def to_api_messages(self, messages: list[NormalizedMessage]) -> list[dict]:
        return _normalized_to_openai_messages(messages)

    def from_api_response(self, response: dict) -> NormalizedMessage:
        choices = response.get("choices", [])
        if not choices:
            return NormalizedMessage(role="assistant", content=[])
        return _openai_response_to_normalized(choices[0])

    def _build_headers(self, api_key: str) -> dict:
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def _build_body(
        self,
        messages: list[NormalizedMessage],
        request: ChatRequest,
        stream: bool,
    ) -> dict:
        body: dict = {
            "model": request.model,
            "messages": self.to_api_messages(messages),
            "max_tokens": request.max_tokens,
            "stream": stream,
        }
        if request.tools:
            body["tools"] = [
                {"type": "function", "function": t} for t in request.tools
            ]
        if stream:
            body["stream_options"] = {"include_usage": True}
        return body

    async def stream(
        self,
        messages: list[NormalizedMessage],
        request: ChatRequest,
        api_key: str,
    ) -> AsyncGenerator[str, None]:
        """流式调用 OpenAI API，透传 SSE 行。"""
        body = self._build_body(messages, request, stream=True)
        headers = self._build_headers(api_key)

        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST", self.BASE_URL, headers=headers, json=body
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        yield f"{line}\n\n"
                        data_str = line[len("data: "):]
                        if data_str.strip() == "[DONE]":
                            continue
                        try:
                            data = json.loads(data_str)
                            usage_raw = data.get("usage")
                            if usage_raw:
                                from gateway.cost import log_usage
                                usage = UsageStats(
                                    input_tokens=usage_raw.get("prompt_tokens", 0),
                                    output_tokens=usage_raw.get(
                                        "completion_tokens", 0
                                    ),
                                )
                                log_usage(request.model, usage)
                        except Exception:
                            pass

    async def complete(
        self,
        messages: list[NormalizedMessage],
        request: ChatRequest,
        api_key: str,
    ) -> dict:
        """非流式调用 OpenAI API。"""
        body = self._build_body(messages, request, stream=False)
        headers = self._build_headers(api_key)

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(self.BASE_URL, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()

        msg = self.from_api_response(data)
        usage_raw = data.get("usage", {})
        usage = UsageStats(
            input_tokens=usage_raw.get("prompt_tokens", 0),
            output_tokens=usage_raw.get("completion_tokens", 0),
        )

        from gateway.cost import log_usage
        log_usage(request.model, usage)

        return {
            "role": "assistant",
            "content": [b.model_dump() for b in msg.content],
            "usage": usage.model_dump(),
        }
