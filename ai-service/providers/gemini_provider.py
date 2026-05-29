"""Gemini provider：用 google-generativeai SDK，输出 Anthropic SSE 事件。

转换要点：
- Anthropic system → GenerativeModel(system_instruction=...)
- Anthropic messages 角色映射：assistant → "model"，user → "user"
  tool_result 块映射成 role=user 的 function_response part
  tool_use 块映射成 role=model 的 function_call part
- Anthropic tools → Tool(function_declarations=[FunctionDeclaration(...)])
- 输出：text part → text_delta；function_call part → tool_use 完整 input_json_delta
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any, AsyncIterator, Optional

from providers.base import AnthropicRequest, BaseProvider


def _anthropic_messages_to_gemini(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """转 Gemini contents 列表。每条 content = {role, parts: [...]}。"""
    out: list[dict[str, Any]] = []
    for msg in messages:
        role = "model" if msg.get("role") == "assistant" else "user"
        content = msg.get("content", "")
        parts: list[dict[str, Any]] = []

        if isinstance(content, str):
            parts.append({"text": content})
        else:
            for block in content:
                btype = block.get("type")
                if btype == "text":
                    parts.append({"text": block.get("text", "")})
                elif btype == "tool_use":
                    parts.append(
                        {
                            "function_call": {
                                "name": block.get("name", ""),
                                "args": block.get("input", {}),
                            }
                        }
                    )
                elif btype == "tool_result":
                    tc = block.get("content", "")
                    if isinstance(tc, list):
                        tc = " ".join(
                            c.get("text", "") for c in tc if c.get("type") == "text"
                        )
                    parts.append(
                        {
                            "function_response": {
                                "name": block.get("tool_use_id", "tool"),
                                "response": {"content": str(tc)},
                            }
                        }
                    )

        if parts:
            out.append({"role": role, "parts": parts})
    return out


def _anthropic_tools_to_gemini(
    tools: Optional[list[dict[str, Any]]],
) -> Optional[list[dict[str, Any]]]:
    if not tools:
        return None
    return [
        {
            "function_declarations": [
                {
                    "name": t.get("name", ""),
                    "description": t.get("description", ""),
                    "parameters": t.get("input_schema", {"type": "object", "properties": {}}),
                }
                for t in tools
            ]
        }
    ]


class GeminiProvider(BaseProvider):
    name = "gemini"

    async def stream_completion(
        self, req: AnthropicRequest, api_key: Optional[str] = None
    ) -> AsyncIterator[dict[str, Any]]:
        import google.generativeai as genai

        key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        genai.configure(api_key=key)

        gemini_tools = _anthropic_tools_to_gemini(req.tools)
        model = genai.GenerativeModel(
            model_name=req.model,
            system_instruction=req.system,
            tools=gemini_tools,
        )

        generation_config: dict[str, Any] = {"max_output_tokens": req.max_tokens}
        if req.temperature is not None:
            generation_config["temperature"] = req.temperature
        if req.top_p is not None:
            generation_config["top_p"] = req.top_p

        contents = _anthropic_messages_to_gemini(req.messages)

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

        text_block_open = False
        text_block_index = 0
        next_block_index = 1
        stop_reason: Optional[str] = "end_turn"
        usage_tokens = {"input_tokens": 0, "output_tokens": 0}

        response = await model.generate_content_async(
            contents,
            generation_config=generation_config,
            stream=True,
        )

        async for chunk in response:
            # chunk.candidates[0].content.parts
            if not getattr(chunk, "candidates", None):
                continue
            candidate = chunk.candidates[0]
            parts = getattr(candidate.content, "parts", []) if getattr(candidate, "content", None) else []

            for part in parts:
                # 文本 delta
                text = getattr(part, "text", None)
                if text:
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
                        "delta": {"type": "text_delta", "text": text},
                    }
                # 函数调用：Gemini 一次性给完整 args
                fc = getattr(part, "function_call", None)
                if fc and getattr(fc, "name", None):
                    block_idx = next_block_index
                    next_block_index += 1
                    args = dict(fc.args) if getattr(fc, "args", None) else {}
                    yield {
                        "type": "content_block_start",
                        "index": block_idx,
                        "content_block": {
                            "type": "tool_use",
                            "id": f"toolu_{uuid.uuid4().hex[:16]}",
                            "name": fc.name,
                            "input": {},
                        },
                    }
                    yield {
                        "type": "content_block_delta",
                        "index": block_idx,
                        "delta": {
                            "type": "input_json_delta",
                            "partial_json": json.dumps(args),
                        },
                    }
                    yield {"type": "content_block_stop", "index": block_idx}
                    stop_reason = "tool_use"

            fr = getattr(candidate, "finish_reason", None)
            if fr:
                # gemini finish_reason 枚举值映射
                fr_str = getattr(fr, "name", str(fr)).upper()
                if "MAX_TOKENS" in fr_str:
                    stop_reason = "max_tokens"
                elif "STOP" in fr_str and stop_reason != "tool_use":
                    stop_reason = "end_turn"

            usage = getattr(chunk, "usage_metadata", None)
            if usage:
                usage_tokens["input_tokens"] = getattr(usage, "prompt_token_count", 0) or 0
                usage_tokens["output_tokens"] = getattr(usage, "candidates_token_count", 0) or 0

        if text_block_open:
            yield {"type": "content_block_stop", "index": text_block_index}

        yield {
            "type": "message_delta",
            "delta": {"stop_reason": stop_reason, "stop_sequence": None},
            "usage": usage_tokens,
        }
        yield {"type": "message_stop"}
