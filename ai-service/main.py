"""FastAPI 应用入口。"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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


# 延迟导入 router，避免循环依赖
from routers.chat import router as chat_router  # noqa: E402

app.include_router(chat_router)
