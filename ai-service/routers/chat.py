"""POST /v1/chat 主路由。

统一入口，按 model 字段前缀选择 adapter，应用 cache 策略，
调用流式/非流式响应。
"""

import logging
from typing import AsyncGenerator

import httpx
from fastapi import APIRouter, HTTPException, Request as FastAPIRequest
from fastapi.responses import StreamingResponse

from adapters.anthropic import AnthropicAdapter
from adapters.base import BaseAdapter
from adapters.deepseek import DeepSeekAdapter
from adapters.gemini import GeminiAdapter
from adapters.openai import OpenAIAdapter
from cache.anthropic import AnthropicCacheStrategy
from cache.base import BaseCacheStrategy
from cache.noop import NoopCacheStrategy
from gateway.keys import get_key
from models.normalized import ChatRequest
from security.redact import provider_error_message, redact_sensitive

logger = logging.getLogger(__name__)

router = APIRouter()

# prefix 匹配：从长到短避免误匹配（如 "deepseek-" 不会被 "d" 误匹配）
PREFIX_ADAPTER_MAP: list[tuple[str, type[BaseAdapter]]] = [
    ("claude-",    AnthropicAdapter),
    ("gpt-",       OpenAIAdapter),
    ("deepseek-",  DeepSeekAdapter),
    ("gemini-",    GeminiAdapter),
    ("o1",         OpenAIAdapter),
    ("o3",         OpenAIAdapter),
]

CACHE_STRATEGY_MAP: dict[type[BaseAdapter], type[BaseCacheStrategy]] = {
    AnthropicAdapter: AnthropicCacheStrategy,
    OpenAIAdapter:    NoopCacheStrategy,
    DeepSeekAdapter:  NoopCacheStrategy,
    GeminiAdapter:    NoopCacheStrategy,
}


def resolve_adapter(model: str) -> BaseAdapter:
    """按 model 名称前缀选择对应的 Adapter 实例。"""
    for prefix, adapter_cls in PREFIX_ADAPTER_MAP:
        if model.startswith(prefix):
            return adapter_cls()
    raise ValueError(f"Unsupported model: {model}")


@router.post("/v1/chat")
async def chat(request: ChatRequest, raw_request: FastAPIRequest):
    """统一 AI 调用入口。

    1. 按 model 前缀路由到对应 adapter
    2. 应用 cache 策略处理 messages
    3. 从请求 header 或 env var 读取 API key（BYOK 优先）
    4. 流式或非流式调用 adapter
    """
    try:
        adapter = resolve_adapter(request.model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    cache_strategy_cls = CACHE_STRATEGY_MAP.get(type(adapter), NoopCacheStrategy)
    cache_strategy = cache_strategy_cls()

    # apply() 返回经过 cache 处理的新 messages 列表（可能含 cache_control 标记）
    # 必须用处理后的 messages 构建实际请求，不能直接传 request.messages
    processed_messages = cache_strategy.apply(request.messages, request.caching)

    # BYOK：header key 优先，env var 作为 fallback
    header_key = raw_request.headers.get("x-provider-key") or None
    try:
        api_key = get_key(adapter.provider, header_key)
    except EnvironmentError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    if request.stream:
        async def event_stream() -> AsyncGenerator[str, None]:
            try:
                async for chunk in adapter.stream(processed_messages, request, api_key):
                    yield chunk
            except httpx.HTTPStatusError as exc:
                logger.error(
                    "Upstream HTTP error during stream: %s %s",
                    exc.response.status_code,
                    redact_sensitive(exc),
                )
                yield f"data: {{\"error\": \"Upstream HTTP {exc.response.status_code}\"}}\n\n"
            except httpx.RequestError as exc:
                logger.error("Upstream request error during stream: %s", redact_sensitive(exc))
                yield "data: {\"error\": \"Upstream connection error\"}\n\n"
            except Exception as exc:
                logger.error("Unexpected error during stream: %s", redact_sensitive(exc), exc_info=True)
                yield f"data: {{\"error\": \"{provider_error_message(exc)}\"}}\n\n"

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )
    else:
        try:
            result = await adapter.complete(processed_messages, request, api_key)
        except Exception as exc:
            logger.error("Adapter complete() error: %s", redact_sensitive(exc))
            raise HTTPException(status_code=502, detail=provider_error_message(exc))
        return result

