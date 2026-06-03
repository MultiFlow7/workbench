"""providers/ 各 provider 的 mock 单元测试。

每个 provider 测：
1. 输入格式正确转换（messages / tools / system）
2. 输出符合 Anthropic SSE event 协议（开/关 block + message_start/stop）
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest

from providers.anthropic_provider import AnthropicProvider
from providers.base import AnthropicRequest
from providers.deepseek_provider import DeepSeekProvider
from providers.gemini_provider import GeminiProvider
from providers.openai_provider import (
    OpenAIProvider,
    _anthropic_messages_to_openai,
    _anthropic_tools_to_openai,
)
from providers.router import route_to_provider


# ---------- helpers ----------


async def _collect(it):
    return [e async for e in it]


def _assert_anthropic_envelope(events: list[dict[str, Any]]) -> None:
    """断言 SSE 事件序列首尾包裹符合 Anthropic 协议。"""
    types = [e["type"] for e in events]
    assert types[0] == "message_start"
    assert types[-1] == "message_stop"
    assert "message_delta" in types


class _AsyncIter:
    """把 list 包装成 async iterator。"""

    def __init__(self, items):
        self._items = list(items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._items:
            raise StopAsyncIteration
        return self._items.pop(0)


# ---------- router ----------


def test_router_dispatches_by_prefix():
    assert isinstance(route_to_provider("claude-sonnet-4-5"), AnthropicProvider)
    assert isinstance(route_to_provider("gpt-4o-mini"), OpenAIProvider)
    assert isinstance(route_to_provider("gemini-1.5-pro"), GeminiProvider)
    assert isinstance(route_to_provider("deepseek-chat"), DeepSeekProvider)
    with pytest.raises(ValueError):
        route_to_provider("unknown-model-xyz")


# ---------- anthropic provider ----------


@pytest.mark.asyncio
async def test_anthropic_provider_passes_through_sdk_events(monkeypatch):
    """Anthropic provider 应直通 SDK 事件（已 model_dump 为 dict）。"""

    captured: dict[str, Any] = {}

    class _FakeStreamCtx:
        async def __aenter__(self_inner):
            return self_inner

        async def __aexit__(self_inner, *a):
            return False

        def __aiter__(self_inner):
            self_inner._events = [
                SimpleNamespace(
                    model_dump=lambda: {
                        "type": "message_start",
                        "message": {"id": "msg_1", "model": "claude-sonnet-4-5"},
                    }
                ),
                SimpleNamespace(
                    model_dump=lambda: {
                        "type": "content_block_start",
                        "index": 0,
                        "content_block": {"type": "text", "text": ""},
                    }
                ),
                SimpleNamespace(
                    model_dump=lambda: {
                        "type": "content_block_delta",
                        "index": 0,
                        "delta": {"type": "text_delta", "text": "hi"},
                    }
                ),
                SimpleNamespace(model_dump=lambda: {"type": "content_block_stop", "index": 0}),
                SimpleNamespace(
                    model_dump=lambda: {
                        "type": "message_delta",
                        "delta": {"stop_reason": "end_turn"},
                        "usage": {"output_tokens": 1},
                    }
                ),
                SimpleNamespace(model_dump=lambda: {"type": "message_stop"}),
            ]
            return self_inner

        async def __anext__(self_inner):
            if not self_inner._events:
                raise StopAsyncIteration
            return self_inner._events.pop(0)

    class _FakeMessages:
        def stream(self_inner, **kwargs):
            captured.update(kwargs)
            return _FakeStreamCtx()

    class _FakeAsyncAnthropic:
        def __init__(self_inner, api_key=None, **_):
            self_inner.messages = _FakeMessages()

    import providers.anthropic_provider as ap_mod

    # 由于函数内部 `from anthropic import AsyncAnthropic`，需要 patch anthropic 模块
    fake_module = SimpleNamespace(AsyncAnthropic=_FakeAsyncAnthropic)
    monkeypatch.setitem(__import__("sys").modules, "anthropic", fake_module)

    req = AnthropicRequest(
        model="claude-sonnet-4-5",
        messages=[{"role": "user", "content": "hi"}],
        system="be brief",
        max_tokens=100,
    )

    events = await _collect(AnthropicProvider().stream_completion(req, api_key="sk-test"))

    # 输入透传：system / messages / max_tokens 应送进 SDK
    assert captured["model"] == "claude-sonnet-4-5"
    assert captured["system"] == "be brief"
    assert captured["max_tokens"] == 100
    assert captured["messages"] == [{"role": "user", "content": "hi"}]

    # 输出符合 Anthropic 协议
    _assert_anthropic_envelope(events)
    assert any(
        e["type"] == "content_block_delta" and e["delta"]["text"] == "hi" for e in events
    )


# ---------- openai provider ----------


def test_openai_messages_conversion_tool_use_and_result():
    """Anthropic messages 含 tool_use / tool_result 应正确拆分。"""
    msgs = [
        {"role": "user", "content": "weather in NY"},
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "let me check"},
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "get_weather",
                    "input": {"city": "NY"},
                },
            ],
        },
        {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": "tu_1", "content": "72F"}],
        },
    ]
    out = _anthropic_messages_to_openai(msgs, system="be terse")
    assert out[0] == {"role": "system", "content": "be terse"}
    # assistant 行应含 tool_calls
    assistant_msg = next(m for m in out if m["role"] == "assistant")
    assert assistant_msg["tool_calls"][0]["function"]["name"] == "get_weather"
    assert json.loads(assistant_msg["tool_calls"][0]["function"]["arguments"]) == {"city": "NY"}
    # tool_result 拆成独立 role=tool
    tool_msg = next(m for m in out if m["role"] == "tool")
    assert tool_msg["tool_call_id"] == "tu_1"
    assert tool_msg["content"] == "72F"


def test_openai_tools_conversion():
    tools = [
        {
            "name": "get_weather",
            "description": "get city weather",
            "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}},
        }
    ]
    out = _anthropic_tools_to_openai(tools)
    assert out[0]["type"] == "function"
    assert out[0]["function"]["name"] == "get_weather"
    assert out[0]["function"]["parameters"]["properties"]["city"]["type"] == "string"


@pytest.mark.asyncio
async def test_openai_provider_emits_anthropic_envelope(monkeypatch):
    """模拟 OpenAI chat.completions.stream 的 chunk 序列。"""

    captured: dict[str, Any] = {}

    def _mk_chunk(content=None, tool_calls=None, finish_reason=None):
        delta = SimpleNamespace(content=content, tool_calls=tool_calls)
        choice = SimpleNamespace(delta=delta, finish_reason=finish_reason)
        return SimpleNamespace(choices=[choice], usage=None)

    chunks = [
        _mk_chunk(content="hel"),
        _mk_chunk(content="lo"),
        _mk_chunk(
            tool_calls=[
                SimpleNamespace(
                    index=0,
                    id="call_1",
                    function=SimpleNamespace(name="get_weather", arguments='{"city":'),
                )
            ]
        ),
        _mk_chunk(
            tool_calls=[
                SimpleNamespace(
                    index=0,
                    id=None,
                    function=SimpleNamespace(name=None, arguments='"NY"}'),
                )
            ]
        ),
        _mk_chunk(finish_reason="tool_calls"),
    ]

    class _FakeCompletions:
        async def create(self_inner, **kwargs):
            captured.update(kwargs)
            return _AsyncIter(chunks)

    class _FakeChat:
        def __init__(self_inner):
            self_inner.completions = _FakeCompletions()

    class _FakeAsyncOpenAI:
        def __init__(self_inner, api_key=None, base_url=None, **_):
            captured["__init_kwargs__"] = {"api_key": api_key, "base_url": base_url}
            self_inner.chat = _FakeChat()

    fake_module = SimpleNamespace(AsyncOpenAI=_FakeAsyncOpenAI)
    monkeypatch.setitem(__import__("sys").modules, "openai", fake_module)

    req = AnthropicRequest(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "weather?"}],
        system="be helpful",
        tools=[
            {
                "name": "get_weather",
                "description": "x",
                "input_schema": {"type": "object", "properties": {}},
            }
        ],
        max_tokens=128,
    )

    events = await _collect(OpenAIProvider().stream_completion(req, api_key="sk-x"))

    # 输入转换：system 应被 prepend，tools 应转 function 形式
    sent_messages = captured["messages"]
    assert sent_messages[0]["role"] == "system"
    assert captured["tools"][0]["type"] == "function"
    assert captured["max_tokens"] == 128

    # 输出协议：含 text + tool_use 两个 block，stop_reason=tool_use
    _assert_anthropic_envelope(events)
    text_deltas = [e for e in events if e["type"] == "content_block_delta" and e["delta"].get("type") == "text_delta"]
    assert "".join(e["delta"]["text"] for e in text_deltas) == "hello"
    # tool_use block 至少有 1 个 input_json_delta
    tu_deltas = [
        e for e in events if e["type"] == "content_block_delta" and e["delta"].get("type") == "input_json_delta"
    ]
    assert len(tu_deltas) >= 1
    msg_delta = next(e for e in events if e["type"] == "message_delta")
    assert msg_delta["delta"]["stop_reason"] == "tool_use"


# ---------- deepseek provider ----------


@pytest.mark.asyncio
async def test_deepseek_uses_openai_compatible_endpoint(monkeypatch):
    captured: dict[str, Any] = {}

    def _mk_chunk(content=None, finish_reason=None):
        delta = SimpleNamespace(content=content, tool_calls=None)
        return SimpleNamespace(
            choices=[SimpleNamespace(delta=delta, finish_reason=finish_reason)],
            usage=None,
        )

    class _FakeCompletions:
        async def create(self_inner, **kwargs):
            captured.update(kwargs)
            return _AsyncIter([_mk_chunk(content="ok"), _mk_chunk(finish_reason="stop")])

    class _FakeAsyncOpenAI:
        def __init__(self_inner, api_key=None, base_url=None, **_):
            captured["__base_url__"] = base_url
            captured["__api_key__"] = api_key
            self_inner.chat = SimpleNamespace(completions=_FakeCompletions())

    fake_module = SimpleNamespace(AsyncOpenAI=_FakeAsyncOpenAI)
    monkeypatch.setitem(__import__("sys").modules, "openai", fake_module)

    req = AnthropicRequest(
        model="deepseek-chat",
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=64,
    )

    events = await _collect(DeepSeekProvider().stream_completion(req, api_key="sk-ds"))

    # base_url 应指向 DeepSeek endpoint
    assert captured["__base_url__"] and "deepseek" in captured["__base_url__"]
    assert captured["__api_key__"] == "sk-ds"
    _assert_anthropic_envelope(events)
    msg_delta = next(e for e in events if e["type"] == "message_delta")
    assert msg_delta["delta"]["stop_reason"] == "end_turn"


# ---------- gemini provider ----------


@pytest.mark.asyncio
async def test_gemini_provider_emits_anthropic_envelope(monkeypatch):
    captured: dict[str, Any] = {}

    class _FakeGenerativeModel:
        def __init__(self_inner, model_name, system_instruction=None, tools=None):
            captured["model_name"] = model_name
            captured["system_instruction"] = system_instruction
            captured["tools"] = tools

        async def generate_content_async(self_inner, contents, generation_config=None, stream=False):
            captured["contents"] = contents
            captured["generation_config"] = generation_config
            assert stream is True

            # 模拟两个 chunk：文本 + function_call + finish_reason
            text_part = SimpleNamespace(text="hello", function_call=None)
            fc_part = SimpleNamespace(
                text=None,
                function_call=SimpleNamespace(name="get_weather", args={"city": "NY"}),
            )
            chunk1 = SimpleNamespace(
                candidates=[
                    SimpleNamespace(
                        content=SimpleNamespace(parts=[text_part]),
                        finish_reason=None,
                    )
                ],
                usage_metadata=None,
            )
            chunk2 = SimpleNamespace(
                candidates=[
                    SimpleNamespace(
                        content=SimpleNamespace(parts=[fc_part]),
                        finish_reason=SimpleNamespace(name="STOP"),
                    )
                ],
                usage_metadata=SimpleNamespace(prompt_token_count=5, candidates_token_count=3),
            )
            return _AsyncIter([chunk1, chunk2])

    def _configure(api_key=None):
        captured["__api_key__"] = api_key

    fake_module = SimpleNamespace(
        GenerativeModel=_FakeGenerativeModel,
        configure=_configure,
    )
    # google.generativeai 是一个 package，需要同时在 sys.modules 注册 google 和 google.generativeai
    import sys as _sys

    fake_google = SimpleNamespace(generativeai=fake_module)
    monkeypatch.setitem(_sys.modules, "google", fake_google)
    monkeypatch.setitem(_sys.modules, "google.generativeai", fake_module)

    req = AnthropicRequest(
        model="gemini-1.5-pro",
        messages=[
            {"role": "user", "content": "weather?"},
            {
                "role": "assistant",
                "content": [{"type": "text", "text": "checking"}],
            },
        ],
        system="be helpful",
        tools=[
            {
                "name": "get_weather",
                "description": "x",
                "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}},
            }
        ],
        max_tokens=200,
    )

    events = await _collect(GeminiProvider().stream_completion(req, api_key="g-key"))

    # 输入转换
    assert captured["__api_key__"] == "g-key"
    assert captured["system_instruction"] == "be helpful"
    # assistant → "model"
    roles = [c["role"] for c in captured["contents"]]
    assert "model" in roles and "user" in roles
    # tools 应转 function_declarations 列表
    assert captured["tools"][0]["function_declarations"][0]["name"] == "get_weather"
    assert captured["generation_config"]["max_output_tokens"] == 200

    # 输出协议
    _assert_anthropic_envelope(events)
    text_deltas = [
        e for e in events if e["type"] == "content_block_delta" and e["delta"].get("type") == "text_delta"
    ]
    assert "".join(e["delta"]["text"] for e in text_deltas) == "hello"
    # function_call 转 tool_use block：应有 input_json_delta
    tu_deltas = [
        e for e in events if e["type"] == "content_block_delta" and e["delta"].get("type") == "input_json_delta"
    ]
    assert tu_deltas, "expected input_json_delta for tool_use"
    payload = json.loads(tu_deltas[0]["delta"]["partial_json"])
    assert payload == {"city": "NY"}
    # usage 透传
    msg_delta = next(e for e in events if e["type"] == "message_delta")
    assert msg_delta["usage"]["input_tokens"] == 5
    assert msg_delta["usage"]["output_tokens"] == 3
