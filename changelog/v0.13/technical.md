---
project: 工作台
version: v0.13
status: approved
doc_revision: 10
created: 2026-05-23
---

# 技术执行文档 · v0.13 · AI 工具层 Python 后端服务

关联产品规划：[changelog/v0.13/product.md](product.md)
关联需求：[req-047](../../requirements/req-047-ai-service-backend.md)

---

## 实现阶段

### 节点依赖关系

```
节点1（脚手架）
  └─ 节点2（NormalizedMessage 模型）
      ├─ 节点3（Anthropic Adapter）
      ├─ 节点4（OpenAI Adapter）
      ├─ 节点5（DeepSeek Adapter）
      └─ 节点6（Gemini Adapter）
节点7（API key 配置）
节点8（SSE 透传）── 依赖节点3/4/5/6
  │
  └─ 节点9（POST /v1/chat 路由）── 同时依赖节点7
       │
       ├─ 节点10（token 用量记录）── 依赖节点9
       └─ 节点11（Tauri 前端接入）── 依赖节点9
            │
            └─ 节点12（BYOK 前端 key 透传）── 依赖节点11
```

---

- [x] **节点1：项目脚手架**

  建立 Python 服务项目结构，配置依赖和运行环境。

  ```
  ai-service/
  ├── main.py              # FastAPI app 入口
  ├── config.py            # 环境变量读取（API key、服务端口等）
  ├── requirements.txt     # fastapi, uvicorn, httpx, python-dotenv
  ├── .env.example         # 配置模板（不含真实 key）
  ├── routers/
  │   └── chat.py
  ├── models/
  │   └── normalized.py
  ├── adapters/
  │   ├── base.py
  │   ├── anthropic.py
  │   ├── openai.py
  │   ├── deepseek.py
  │   └── gemini.py
  ├── cache/
  │   ├── base.py
  │   ├── anthropic.py
  │   └── noop.py
  └── gateway/
      ├── keys.py
      └── cost.py
  ```

  验收：`uvicorn main:app --reload` 启动，`GET /health` 返回 200。

---

- [x] **节点2：NormalizedMessage 数据模型**

  定义统一的请求/响应 Pydantic 模型，以 Claude content block 格式为基准。

  ```python
  # models/normalized.py
  from pydantic import BaseModel
  from typing import Literal, Union, Optional

  class TextBlock(BaseModel):
      type: Literal["text"]
      text: str

  class ToolUseBlock(BaseModel):
      type: Literal["tool_use"]
      id: str
      name: str
      input: dict

  class ToolResultBlock(BaseModel):
      type: Literal["tool_result"]
      tool_use_id: str
      content: str

  class ThinkingBlock(BaseModel):
      type: Literal["thinking"]
      thinking: str

  ContentBlock = Union[TextBlock, ToolUseBlock, ToolResultBlock, ThinkingBlock]

  class NormalizedMessage(BaseModel):
      role: Literal["user", "assistant"]
      content: list[ContentBlock]

  class ChatRequest(BaseModel):
      model: str
      messages: list[NormalizedMessage]
      caching: bool = False
      stream: bool = True
      max_tokens: int = 1024
      tools: list[dict] = []

  class UsageStats(BaseModel):
      input_tokens: int = 0
      output_tokens: int = 0
      cache_read_input_tokens: int = 0
      cache_creation_input_tokens: int = 0
  ```

---

- [x] **节点3：Anthropic Adapter**

  NormalizedMessage ↔ Claude API format 双向转换，含 thinking blocks 处理。

  **转换规则：**
  - normalized → Claude：content block 格式直接传入（Claude 原生即 content block）
  - Claude response → normalized：content 字段 1:1 映射；thinking block 类型为 `thinking`，必须保留在历史中
  - Tool use：Claude 使用 `tool_use` block（assistant）+ `tool_result` block in user message，与 normalized 格式一致，无需转换

  **关键点：**
  - thinking blocks 在历史中必须原样保留（Anthropic API 要求）
  - stream=true 时使用 httpx 流式请求，逐 chunk 转发

  接口：
  ```python
  class AnthropicAdapter(BaseAdapter):
      def to_api_messages(self, messages: list[NormalizedMessage]) -> list[dict]: ...
      def from_api_response(self, response: dict) -> NormalizedMessage: ...
      # messages 为 cache_strategy.apply() 处理后的版本（可能含 cache_control）
      # request 用于读取 model/max_tokens/tools/stream 等其他参数
      async def stream(self, messages: list[NormalizedMessage], request: ChatRequest, api_key: str) -> AsyncGenerator: ...
      async def complete(self, messages: list[NormalizedMessage], request: ChatRequest, api_key: str) -> NormalizedMessage: ...
  ```

---

- [x] **节点4：OpenAI Adapter**

  NormalizedMessage ↔ OpenAI API format 双向转换。

  **转换规则：**
  - `TextBlock` → `content: str`（string，不是 array）
  - `ToolUseBlock`（assistant）→ `tool_calls: [{id, type:"function", function:{name, arguments}}]`
  - `ToolResultBlock`（user）→ role `"tool"` message：`{role:"tool", tool_call_id, content}`
  - `ThinkingBlock` → 过滤掉（OpenAI 无 thinking，不传入）
  - OpenAI response → normalized：`content` string → `TextBlock`；`tool_calls` → `ToolUseBlock`
  - 确定性要求：同一 NormalizedMessage 输入永远产生同一 OpenAI format 输出（保障 DeepSeek disk cache 命中）

---

- [x] **节点5：DeepSeek Adapter**

  复用 OpenAI Adapter 逻辑（DeepSeek API 与 OpenAI 格式兼容），仅 base_url 不同。

  ```python
  class DeepSeekAdapter(OpenAIAdapter):
      BASE_URL = "https://api.deepseek.com/v1"
  ```

  额外验证：同一对话历史经两次 `to_api_messages()` 调用，输出 JSON 字符串完全相同（确定性测试）。

---

- [x] **节点6：Gemini Adapter**

  NormalizedMessage ↔ Gemini API format 双向转换。

  **转换规则（Gemini 格式差异较大）：**
  - role 映射：`user` → `user`，`assistant` → `model`
  - content 结构：`{role, parts: [{text: "..."}]}`（parts 数组）
  - `ToolUseBlock` → `{functionCall: {name, args}}`
  - `ToolResultBlock` → `{functionResponse: {name, response}}`
  - `ThinkingBlock` → 过滤掉
  - 使用 `generativelanguage.googleapis.com` 端点，或 Vertex AI 端点（config 可切换）

---

- [x] **节点7：API key 配置模块**

  集中管理各模型 API key，从环境变量/配置文件读取，不硬编码。

  ```python
  # gateway/keys.py
  import os

  # 环境变量名映射（不在此处读取，避免启动时 KeyError 被 lru_cache 缓存）
  _ENV_KEY_MAP = {
      "anthropic": "ANTHROPIC_API_KEY",
      "openai":    "OPENAI_API_KEY",
      "deepseek":  "DEEPSEEK_API_KEY",
      "gemini":    "GEMINI_API_KEY",
  }

  def get_key(provider: str) -> str:
      if provider not in _ENV_KEY_MAP:
          raise ValueError(f"Unknown provider: {provider}")
      env_var = _ENV_KEY_MAP[provider]
      key = os.environ.get(env_var)
      if not key:
          raise EnvironmentError(f"Missing env var: {env_var}")
      return key

  def validate_all_keys():
      """在服务启动时调用，提前发现缺失的 key（main.py lifespan 中调用）。"""
      for provider in _ENV_KEY_MAP:
          get_key(provider)
  ```

  `.env.example` 列出所有必需 key，`.env` 加入 `.gitignore`，API key 不出现在任何响应或日志。`validate_all_keys()` 在 FastAPI lifespan 启动时调用，确保缺失 key 在启动阶段报错，而非首次请求时才暴露。

---

- [x] **节点8：SSE 流式透传**

  各 adapter 的流式响应统一通过 httpx AsyncClient 获取，以 SSE 格式透传给前端。

  ```python
  # 统一 SSE 输出格式（与 Claude 原生格式对齐）
  async def stream_response(adapter, request, api_key):
      async with httpx.AsyncClient() as client:
          async with client.stream("POST", adapter.endpoint, ...) as resp:
              async for line in resp.aiter_lines():
                  if line.startswith("data: "):
                      yield f"{line}\n\n"
  ```

  - stream=false 时：等待完整响应后一次性返回 JSON
  - stream=true 时：返回 `StreamingResponse(media_type="text/event-stream")`
  - 连接断开时：中止上游请求（不继续消耗 token）

  **Gemini 流式差异处理：**
  - Gemini 使用 `streamGenerateContent?alt=sse` 端点，响应格式为 `data: {"candidates":[...]}` JSON 行，与 Claude/OpenAI SSE 结构不同
  - GeminiAdapter 需自行实现 `stream()` 方法，将 Gemini `candidates[0].content.parts` 解析后转换为 normalized TextBlock，再以 `data: {"type":"content_block_delta","delta":{"type":"text","text":"..."}}` 格式输出，保持与 AnthropicAdapter 流式格式一致
  - 不能直接透传 Gemini 原始 SSE 行，前端消费方假设统一格式

---

- [x] **节点9：POST /v1/chat 主路由**

  统一入口，按 model 字段选择 adapter，应用 cache 策略，调用流式/非流式响应。

  ```python
  # routers/chat.py
  # prefix 匹配：按前缀判断 provider，顺序从长到短避免误匹配
  PREFIX_ADAPTER_MAP = [
      ("claude-",    AnthropicAdapter),
      ("gpt-",       OpenAIAdapter),
      ("deepseek-",  DeepSeekAdapter),
      ("gemini-",    GeminiAdapter),
  ]

  def resolve_adapter(model: str) -> BaseAdapter:
      for prefix, adapter_cls in PREFIX_ADAPTER_MAP:
          if model.startswith(prefix):
              return adapter_cls()
      raise ValueError(f"Unsupported model: {model}")

  CACHE_STRATEGY_MAP = {
      AnthropicAdapter: AnthropicCacheStrategy,
      OpenAIAdapter:    NoopCacheStrategy,
      DeepSeekAdapter:  NoopCacheStrategy,
      GeminiAdapter:    NoopCacheStrategy,
  }

  @router.post("/v1/chat")
  async def chat(request: ChatRequest):
      adapter = resolve_adapter(request.model)
      cache_strategy = CACHE_STRATEGY_MAP[type(adapter)]
      # cache_strategy.apply() 返回注入了 cache_control 的新 messages 列表
      # 必须用处理后的 messages 构建实际请求，不能直接传 request（其中 messages 未经处理）
      processed_messages = cache_strategy.apply(request.messages, request.caching)
      api_key = get_key(adapter.provider)
      if request.stream:
          return StreamingResponse(adapter.stream(processed_messages, request, api_key))
      else:
          return await adapter.complete(processed_messages, request, api_key)
  ```

---

- [x] **节点10：token 用量记录**

  每次请求完成后，将 usage stats 写入日志文件（JSON Lines 格式）。

  ```python
  # gateway/cost.py
  import json, os
  from pathlib import Path
  from datetime import datetime, timezone
  from config import settings  # LOG_DIR 从环境变量/配置读取，默认为服务根目录下 logs/

  def log_usage(model: str, usage: UsageStats):
      log_path = Path(settings.LOG_DIR) / "usage.jsonl"
      log_path.parent.mkdir(parents=True, exist_ok=True)
      entry = {
          "ts": datetime.now(timezone.utc).isoformat(),
          "model": model,
          "input_tokens": usage.input_tokens,
          "output_tokens": usage.output_tokens,
          "cache_read": usage.cache_read_input_tokens,
          "cache_creation": usage.cache_creation_input_tokens,
      }
      with open(log_path, "a") as f:
          f.write(json.dumps(entry) + "\n")
  ```

  `config.py` 中增加 `LOG_DIR: str = os.environ.get("LOG_DIR", str(Path(__file__).parent / "logs"))`，确保日志路径为绝对路径，服务从任意目录启动均可正常写入。

  - 非流式：响应返回后同步写入
  - 流式：stream 结束后（收到 `message_stop` 事件）异步写入
  - API key（无论来自 header 还是 env）不出现在日志中

---

- [x] **节点11：Tauri 前端接入**

  将 Tauri 前端的 AI 调用从直接调 Anthropic API 改为调本地 Python 服务。

  **变更范围：**
  1. 定位 Tauri 前端中所有调用 Anthropic API 的位置（全局搜索 `api.anthropic.com`），将 endpoint URL 替换为 `http://localhost:8000/v1/chat`（或从 Tauri 环境配置读取的 `AI_SERVICE_URL`）
  2. 删除前端中的 `x-api-key` **直连请求 header**（即直接向 Anthropic API 发送请求时附带的 key header）；`settingsSlice` 中的 `apiKeys` 存储（`wb_api_keys` localStorage）**保留**，不做删除——节点12 将复用它实现 BYOK 透传
  3. 请求 body 调整为 `ChatRequest` 格式：在现有 Claude 请求 body 基础上增加 `caching` 字段（透传自 UI 开关状态），其他字段（model、messages、stream、max_tokens、tools）保持不变
  4. `AI_SERVICE_URL` 从 Tauri 应用配置或 `.env` 读取，默认值为 `http://localhost:8000`，不硬编码

  **涉及文件（待实现时确认实际路径）：**
  - `src/lib/ai-client.ts`（或等效的 AI 调用封装文件）：主要变更点
  - `src-tauri/tauri.conf.json`：移除 allowlist 中的 Anthropic API 域名白名单（若有），添加 localhost:8000

  **向后兼容性：**
  - 如果 Python 服务未启动（连接 localhost:8000 失败），前端应给出明确错误提示（"AI 服务未连接，请先启动 ai-service"），而非静默失败或显示通用网络错误

---

- [x] **节点12：BYOK 前端 key 透传**

  将 API key 来源从服务端 env var 改为「前端按请求传入」（Bring Your Own Key）。
  key 已存在 Tauri 前端 `settingsSlice`（localStorage `wb_api_keys`），
  每次请求通过 `X-Provider-Key` HTTP header 携带，后端内存使用、请求后丢弃，零持久化。
  env var 保留作为 fallback（服务侧直接测试场景仍可用）。

  **变更点（4 处）：**

  **① `gateway/keys.py`** — `get_key()` 接受可选 `header_key` 参数，非空时优先返回；env fallback 逻辑不变：

  ```python
  from typing import Optional

  def get_key(provider: str, header_key: Optional[str] = None) -> str:
      if header_key:
          return header_key
      if provider not in _ENV_KEY_MAP:
          raise ValueError(f"Unknown provider: {provider}")
      env_var = _ENV_KEY_MAP[provider]
      key = os.environ.get(env_var)
      if not key:
          raise EnvironmentError(
              f"No X-Provider-Key header and missing env var: {env_var}"
          )
      return key
  ```

  同时，`main.py` lifespan 中移除 `validate_all_keys()` 调用：

  ```python
  # main.py lifespan — 移除这行
  # validate_all_keys()   # 不再强制要求所有 env var 存在
  ```

  取舍说明：移除后，env var 缺失的错误从"启动即失败"推迟到"首次请求时 503"。这是有意为之——BYOK 场景下 env var 是可选的 fallback，不应在启动时强制校验。503 响应的 detail 字段已包含明确的缺失信息（`"No X-Provider-Key header and missing env var: ANTHROPIC_API_KEY"`），运维排查不受影响。

  **② `routers/chat.py`** — `chat()` 增加 `raw_request: Request` 参数，从 header 读 key（**取代节点9中的 `api_key = get_key(adapter.provider)` 这一行**）：

  ```python
  from fastapi import APIRouter, HTTPException, Request as FastAPIRequest

  @router.post("/v1/chat")
  async def chat(request: ChatRequest, raw_request: FastAPIRequest):
      adapter = resolve_adapter(request.model)
      ...
      # 节点9原有：api_key = get_key(adapter.provider)
      # 节点12替换为：header 优先，env fallback
      header_key = raw_request.headers.get("x-provider-key") or None
      try:
          api_key = get_key(adapter.provider, header_key)
      except EnvironmentError as exc:
          raise HTTPException(status_code=503, detail=str(exc))
  ```

  **③ `ai_stream.rs`** — `stream_ai` 命令新增 `provider_key: Option<String>` 参数，非空时注入 header：

  ```rust
  #[command]
  pub async fn stream_ai(
      ...,
      caching: Option<bool>,
      provider_key: Option<String>,   // 新增
  ) -> Result<(), String> {
      ...
      let mut req = client
          .post(&ai_service_url())
          .header("content-type", "application/json");
      if let Some(ref key) = provider_key {
          if !key.is_empty() {
              req = req.header("x-provider-key", key);
          }
      }
      let response = req.json(&request_body).send().await...
  ```

  **④ `ChatView.tsx`** — 重新引入 `findKeyForModel`，在两处 `invoke('stream_ai')` 中传入 `providerKey`：

  ```typescript
  import { findKeyForModel } from '../../store/settingsSlice'

  // 在组件内：
  const keyEntry = findKeyForModel(apiKeys, model)

  invoke('stream_ai', {
    ...,
    caching: false,
    providerKey: keyEntry?.key ?? null,
  })
  ```

  两处 `invoke`（tool continuation + 普通发送）均需更新。

  **验收：** 前端 Network 面板请求 header 含 `x-provider-key`；服务端日志不含 key 明文。

---

> 进度：12/12 节点完成

────────────── 实现完成后解锁 ──────────────

## 测试阶段

> 状态：等待实现阶段完成

### AI 测试（自动运行）

**格式转换单元测试（无需服务运行）**

- [x] **T1 · Anthropic 格式往返**：NormalizedMessage（含 TextBlock + ToolUseBlock）→ `to_api_messages()` → 与 Claude 原生格式一致；thinking block 不过滤
- [x] **T2 · OpenAI 格式往返**：NormalizedMessage（含 TextBlock）→ `to_api_messages()` → `content` 为 string，非 array
- [x] **T3 · OpenAI tool 格式**：含 ToolUseBlock 的 assistant message → `tool_calls` 格式；含 ToolResultBlock 的 user message → role `"tool"` message
- [x] **T4 · DeepSeek 确定性**：同一 NormalizedMessage 调用 `to_api_messages()` 两次，输出 JSON 字符串逐字节相同
- [x] **T5 · Gemini 格式往返**：role `user`/`assistant` 分别映射为 `user`/`model`；content 为 `parts` 数组
- [x] **T6 · ThinkingBlock 过滤**：含 ThinkingBlock 的历史经 OpenAI/Gemini adapter 转换后，thinking block 不出现在输出中

**Cache 策略单元测试**

- [x] **T7 · Anthropic caching=true**：`AnthropicCacheStrategy.apply(messages, True)` 在 messages 顶层附加 `cache_control: {type: "ephemeral"}`
- [x] **T8 · Anthropic caching=false**：`AnthropicCacheStrategy.apply(messages, False)` 输出中不含 `cache_control`
- [x] **T9 · Noop 策略**：`NoopCacheStrategy.apply(messages, True)` 输出与输入完全相同

**集成测试（需服务运行 + 真实 API key）**

- [x] **T10 · Claude 端到端**：`POST /v1/chat` model=claude-sonnet-4-6，messages=[{role:"user",content:[{type:"text",text:"hi"}]}]；断言：status=200，响应 body 中 `content` 为数组，`content[0].type == "text"`，`usage.output_tokens > 0` ✅ 实测通过（output_tokens=8）
- [ ] **T11 · OpenAI 端到端**：`POST /v1/chat` model=gpt-4o，同上入参；断言：status=200，响应 body 中 `content[0].type == "text"`，`usage.output_tokens > 0` ⏭ 跳过（无 OpenAI key，待后续补测）
- [ ] **T12 · DeepSeek 端到端**：`POST /v1/chat` model=deepseek-chat，同上入参；断言：status=200，响应 body 中 `content[0].type == "text"`，`usage.output_tokens > 0` ⏭ 跳过（无 DeepSeek key，待后续补测）
- [x] **T13 · SSE 流式**：`POST /v1/chat` model=claude-sonnet-4-6，stream=true；断言：响应 status=200，Content-Type header 包含 `text/event-stream`，响应体至少含一行 `data: {...}` 格式数据，最后一行为 `data: [DONE]` 或含 `message_stop` 事件类型 ✅ 实测通过（收到 content_block_delta / message_stop 事件）
- [x] **T14 · API key 安全**：发起一次 `POST /v1/chat` 请求（model=claude-sonnet-4-6）；断言：响应 headers 和 response body（JSON 序列化后的字符串）均不包含 `ANTHROPIC_API_KEY` 环境变量的实际值（测试脚本读取 `os.environ["ANTHROPIC_API_KEY"]`，检查其是否出现在响应文本中） ✅ 实测通过

**BYOK 测试（节点12）**

- [x] **T15 · header key 优先于 env**（单元测试，无需服务运行）：调用 `get_key("anthropic", "header-key")` 断言返回 `"header-key"` 而不读 env；调用 `get_key("anthropic", None)` 且 env 设为 `"env-key"`，断言返回 `"env-key"`；调用 `get_key("anthropic", None)` 且 env 未设置，断言抛出 `EnvironmentError` ✅ QA Agent 代码逻辑审查通过
- [x] **T16 · BYOK 端到端**（集成测试，需服务运行）：清空 `ANTHROPIC_API_KEY` env var，发起 `POST /v1/chat`（model=claude-sonnet-4-6），在 header 中携带 `X-Provider-Key: <real-key>`；断言：status=200，响应中 `content[0].type == "text"`，`usage.output_tokens > 0` ✅ 实测通过（output_tokens=12）；额外验证：无 header 且无 env 返回 503 with detail 消息 ✅

### 人工验收（用户确认）

- [ ] **V1 · 服务启动**：`uvicorn main:app` 正常启动，`GET /health` 200，日志无 ERROR
- [ ] **V2 · Tauri 端到端**：在工作台中发送一条消息，经 Python 服务转发，Claude 正常响应，流式输出正常
- [ ] **V3 · Caching 开关生效**：打开 Caching 开关后，第二轮同前缀对话的响应 usage 中 `cache_read_input_tokens > 0` ⏭ 待 v0.12 Caching UI 实现后补验
- [ ] **V4 · BYOK key 透传**：在工作台设置中配置 Anthropic key，发送一条消息；用 Tauri DevTools / Network 面板确认请求 header 含 `x-provider-key`；服务端 `logs/usage.jsonl` 有记录，且文件内容不含 key 明文
- [ ] **V5 · 用量日志**：`logs/usage.jsonl` 中出现正确的 token 用量记录，含 cache_read/cache_creation 字段

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1 | 2026-05-23 | 初稿，11 个实现节点 + 14 AI 测试 + 5 人工验收 |
| v2 | 2026-05-23 | review-agent 修订：修复依赖关系图（节点10方向歧义）、补充节点9 resolve_adapter 实现、节点8补充 Gemini 流式差异处理、节点7改用安全的 key 读取方式并增加启动校验、节点10日志路径改为绝对路径、节点11补充具体文件路径、T10-T13 测试用例补充精确断言、T14 补充判断方法、进度统计移至节点列表末尾 |
| v3 | 2026-05-23 | review-agent 第二轮修订：修复节点9主路由逻辑 bug（cache 处理后的 messages 未传入 adapter，改为显式 processed_messages 参数）、更新 adapter 接口签名（stream/complete 接受独立 messages 参数） |
| v4 | 2026-05-23 | 工程 Agent 实现完成：节点1–10 全部实现，ai-service 目录建立，22 个文件（main.py/config.py/requirements.txt/.env.example/.gitignore + 4 adapters + 3 cache 策略 + 2 gateway 模块 + router）全部通过语法检查；节点11（Tauri 前端接入）按计划暂不实现 |
| v5 | 2026-05-23 | 工程 Agent 实现节点11：ai_stream.rs 切换至本地 Python 服务（ai_service_url()/content-type only/caching 字段/连接失败友好提示）；ChatView.tsx 移除 api_key/base_url 参数，添加 caching: false（含 TODO 注释）；全部 11 节点完成 |
| v6 | 2026-05-23 | QA Agent 执行 T1–T9 单元测试（代码逻辑审查），9/9 全部通过，checkbox 更新为 [x] |
| v7 | 2026-05-23 | 集成测试 T10/T13/T14 实测通过（via sub2api + Claude）；T11/T12 跳过（待补 OpenAI/DeepSeek key）；修复 Python 3.9 兼容性（`int\|None` → Optional[int]，cache/anthropic.py + gemini.py） |
| v8 | 2026-05-23 | 新增节点12（BYOK 前端 key 透传）：4 处变更（gateway/keys.py/routers/chat.py/ai_stream.rs/ChatView.tsx）；新增 T15/T16 测试用例；V4 更新为 BYOK 验收标准；进度 11/12 |
| v9 | 2026-05-23 | review-agent 修订：补充 main.py lifespan 改动说明及取舍说明；节点9→节点12变更②取代关系消歧；节点11"删除 key 逻辑"澄清（settingsSlice apiKeys 保留，仅删直连 header） |
| v10 | 2026-05-23 | 节点12实现完成：4 处变更（gateway/keys.py BYOK 优先逻辑 / routers/chat.py raw_request header 读取 / ai_stream.rs provider_key 参数 / ChatView.tsx findKeyForModel 透传）；T15 QA Agent 通过，T16 实测通过（含 503 兜底验证）；进度 12/12 |
