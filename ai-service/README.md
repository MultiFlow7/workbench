# ai-service — AI 路由层

Python · FastAPI 独立服务，负责统一接入多个 LLM 提供商并对上层暴露单一 `/v1/chat` 接口。

## 架构

```
routers/chat.py          # 统一入口，流式 SSE 响应
    │
    ├── gateway/keys.py  # BYOK — 按请求解析 API Key
    ├── gateway/cost.py  # Token 用量与成本追踪
    │
    └── adapters/        # 各提供商适配器
            base.py      # 抽象基类
            anthropic.py # Claude（含 prompt cache）
            openai.py    # OpenAI
            deepseek.py  # DeepSeek（继承 openai）
            gemini.py    # Gemini
```

## 本地开发

```bash
cp .env.example .env   # 填入至少一个 API Key
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

健康检查：`GET /health`

## 新增适配器

1. 在 `adapters/` 下创建新文件，继承 `BaseAdapter`，实现 `stream()` 方法
2. 在 `routers/chat.py` 中按 `provider` 字段路由到新适配器
3. 在 `.env.example` 中补充对应 API Key 说明

## 环境变量

见 [`.env.example`](.env.example)，完整配置说明在其中。

## 依赖服务

本服务无状态，可独立部署。上层 `backend/`（Rust）通过 HTTP 调用 `/v1/chat`。
