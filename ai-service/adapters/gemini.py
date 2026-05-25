"""Gemini Adapter。

NormalizedMessage ↔ Gemini API 双向转换。

Gemini 格式差异（相对 Claude/OpenAI）：
- role 映射：user → user，assistant → model
- content 结构：{role, parts: [{text: "..."}, ...]}
- ToolUseBlock → {functionCall: {name, args}}
- ToolResultBlock → {functionResponse: {name, response: {content: ...}}}
- ThinkingBlock → 过滤掉

流式差异：
- 使用 streamGenerateContent?alt=sse 端点
- 响应格式为 data: {"candidates":[...]} JSON 行
- 需转换为统一格式：data: {"type":"content_block_delta","delta":{"type":"text","text":"..."}}
"""

import json
import logging
from typing import AsyncGenerator, Optional

import httpx

from adapters.base import BaseAdapter
from models.normalized import (
    ChatRequest,
    ContentBlock,
    NormalizedMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UsageStats,
)

logger = logging.getLogger(__name__)

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"


def _block_to_gemini_part(block: ContentBlock) -> Optional[dict]:
    """将单个 ContentBlock 转为 Gemini part dict。ThinkingBlock 返回 None（过滤）。"""
    if block.type == "text":
        return {"text": block.text}
    if block.type == "tool_use":
        return {
            "functionCall": {
                "name": block.name,
                "args": block.input,
            }
        }
    if block.type == "tool_result":
        return {
            "functionResponse": {
                "name": block.tool_use_id,  # Gemini 需要函数名，此处用 tool_use_id 近似
                "response": {"content": block.content},
            }
        }
    # ThinkingBlock → 过滤
    return None


def _normalized_to_gemini_contents(messages: list[NormalizedMessage]) -> list[dict]:
    """NormalizedMessage 列表 → Gemini contents 格式。"""
    result = []
    for msg in messages:
        role = "user" if msg.role == "user" else "model"
        parts = []
        for block in msg.content:
            part = _block_to_gemini_part(block)
            if part is not None:
                parts.append(part)
        if parts:
            result.append({"role": role, "parts": parts})
    return result


def _gemini_candidate_to_normalized(candidate: dict) -> NormalizedMessage:
    """Gemini candidate → NormalizedMessage。"""
    content = candidate.get("content", {})
    parts = content.get("parts", [])
    blocks: list[ContentBlock] = []
    for part in parts:
        if "text" in part:
            blocks.append(TextBlock(type="text", text=part["text"]))
        elif "functionCall" in part:
            fc = part["functionCall"]
            blocks.append(
                ToolUseBlock(
                    type="tool_use",
                    id=fc.get("name", ""),  # Gemini 无独立 id，用函数名代替
                    name=fc.get("name", ""),
                    input=fc.get("args", {}),
                )
            )
    return NormalizedMessage(role="assistant", content=blocks)


class GeminiAdapter(BaseAdapter):
    provider = "gemini"

    def to_api_messages(self, messages: list[NormalizedMessage]) -> list[dict]:
        return _normalized_to_gemini_contents(messages)

    def from_api_response(self, response: dict) -> NormalizedMessage:
        candidates = response.get("candidates", [])
        if not candidates:
            return NormalizedMessage(role="assistant", content=[])
        return _gemini_candidate_to_normalized(candidates[0])

    def _base_url(self, model: str) -> str:
        return f"{GEMINI_BASE_URL}/{model}"

    def _build_body(
        self, messages: list[NormalizedMessage], request: ChatRequest
    ) -> dict:
        body: dict = {
            "contents": self.to_api_messages(messages),
            "generationConfig": {
                "maxOutputTokens": request.max_tokens,
            },
        }
        if request.tools:
            # Gemini tool 格式：functionDeclarations
            body["tools"] = [
                {"functionDeclarations": request.tools}
            ]
        return body

    async def stream(
        self,
        messages: list[NormalizedMessage],
        request: ChatRequest,
        api_key: str,
    ) -> AsyncGenerator[str, None]:
        """流式调用 Gemini API，将 Gemini SSE 转换为统一格式输出。

        Gemini 使用 streamGenerateContent?alt=sse 端点，
        响应格式：data: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}
        输出格式：data: {"type":"content_block_delta","delta":{"type":"text","text":"..."}}
        最后追加 data: [DONE]
        """
        url = (
            f"{self._base_url(request.model)}"
            f":streamGenerateContent?alt=sse&key={api_key}"
        )
        body = self._build_body(messages, request)

        total_input = 0
        total_output = 0

        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream("POST", url, json=body) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[len("data: "):]
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    # 提取文本 delta
                    candidates = data.get("candidates", [])
                    for candidate in candidates:
                        parts = (
                            candidate.get("content", {}).get("parts", [])
                        )
                        for part in parts:
                            if "text" in part:
                                unified = {
                                    "type": "content_block_delta",
                                    "delta": {
                                        "type": "text",
                                        "text": part["text"],
                                    },
                                }
                                yield f"data: {json.dumps(unified)}\n\n"

                    # 记录 usage
                    usage_meta = data.get("usageMetadata", {})
                    if usage_meta:
                        total_input = usage_meta.get("promptTokenCount", total_input)
                        total_output = usage_meta.get(
                            "candidatesTokenCount", total_output
                        )

        # 流结束
        yield "data: [DONE]\n\n"

        from gateway.cost import log_usage
        usage = UsageStats(
            input_tokens=total_input,
            output_tokens=total_output,
        )
        log_usage(request.model, usage)

    async def complete(
        self,
        messages: list[NormalizedMessage],
        request: ChatRequest,
        api_key: str,
    ) -> dict:
        """非流式调用 Gemini API。"""
        url = (
            f"{self._base_url(request.model)}"
            f":generateContent?key={api_key}"
        )
        body = self._build_body(messages, request)

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, json=body)
            resp.raise_for_status()
            data = resp.json()

        msg = self.from_api_response(data)
        usage_raw = data.get("usageMetadata", {})
        usage = UsageStats(
            input_tokens=usage_raw.get("promptTokenCount", 0),
            output_tokens=usage_raw.get("candidatesTokenCount", 0),
        )

        from gateway.cost import log_usage
        log_usage(request.model, usage)

        return {
            "role": "assistant",
            "content": [b.model_dump() for b in msg.content],
            "usage": usage.model_dump(),
        }
