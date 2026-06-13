"""FastAPI 应用入口。"""

import json
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, Request as FastAPIRequest
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from providers.base import AnthropicRequest
from providers.router import route_to_provider
from security.redact import provider_error_message, redact_sensitive

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # BYOK 模式：env var 为可选 fallback，不在启动时强制校验
    logger.info("AI Service starting (BYOK mode: keys resolved per-request)")
    yield


app = FastAPI(
    title="AI Service",
    description="工作台 AI 工具层 Python 后端服务",
    version="0.13.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    """健康检查端点。"""
    return {"status": "ok", "version": "0.13.0"}


@app.post("/v1/messages")
async def messages(req: AnthropicRequest, raw_request: FastAPIRequest):
    """Anthropic Messages API 兼容端点。

    按 model 前缀路由到具体 provider，将 provider 输出的 Anthropic SSE event
    dict 序列编码为标准 `event: <type>\\ndata: <json>\\n\\n` 帧返回。
    BYOK：优先用请求 header `x-provider-key`，否则回退到环境变量。
    """
    try:
        provider = route_to_provider(req.model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    api_key = raw_request.headers.get("x-provider-key") or None

    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            async for event in provider.stream_completion(req, api_key=api_key):
                event_type = event.get("type", "message")
                payload = json.dumps(event, ensure_ascii=False)
                yield f"event: {event_type}\ndata: {payload}\n\n"
        except Exception as exc:  # noqa: BLE001
            logger.error("Provider stream error: %s", redact_sensitive(exc), exc_info=True)
            err = json.dumps({
                "type": "error",
                "error": {
                    "type": "provider_error",
                    "message": provider_error_message(exc),
                },
            })
            yield f"event: error\ndata: {err}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# 延迟导入 router，避免循环依赖
from routers.chat import router as chat_router  # noqa: E402

app.include_router(chat_router)
