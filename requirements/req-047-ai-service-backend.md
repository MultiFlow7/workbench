---
id: req-047
title: AI 工具层 Python 后端服务（Model Router + LLM Gateway）
status: done
priority: high
source: architecture-decision
created: 2026-05-23
version: v0.13
---

# req-047 · AI 工具层 Python 后端服务

## 背景与目标

当前 Tauri 前端直接调用各 AI 模型 API，带来以下问题：
- 格式转换逻辑分散在前端，难以维护
- API key 存在客户端，无法统一管理
- 不同模型的 Cache 策略复杂度高，前端不适合处理
- 未来引入多用户协作时，无法做权限控制和审计

目标：建立独立的 Python 后端服务，作为 Tauri 前端与各 AI 模型之间的统一中间层。前端调用统一接口，模型差异在服务内部消化。

## 服务边界

- 独立部署在用户自己的服务器上，不随 Tauri 应用打包
- Tauri 前端不再直接调 AI API，改为调此服务
- Auth 暂不实现（当前单用户阶段）

---

## 内部模块

### Model Router（模型路由器）

- 接收 normalized 格式请求，路由到对应模型
- 格式转换：normalized ↔ 各模型原生 API 格式
- Cache 策略：按模型差异化处理（见下方「Cache 策略」）
- Tool use 格式映射（Claude `tool_use` blocks vs OpenAI `tool_calls`）
- Thinking blocks 处理（Claude-specific，历史中必须完整保留）

**支持模型：**
- Anthropic Claude（claude-sonnet-4-6 等）
- OpenAI（gpt-4o 等）
- DeepSeek（deepseek-chat 等）
- Google Gemini（gemini-pro 等）

### LLM Gateway（网关层）

- API key 管理：BYOK 无存储模式（见下方「API Key 安全设计」）
- 请求/响应日志记录
- token 用量与成本记录（含 cache_read / cache_creation）
- 预留扩展点：权限管理、Rate limiting（多用户阶段启用）

---

## API Key 安全设计（BYOK 无存储模式）

**设计目标**：用户使用自己的 API key，后端完全不持久化任何用户 key。

| 环节 | 行为 |
|------|------|
| 客户端存储 | Tauri 读取用户配置的 key，写入系统安全存储（macOS Keychain / tauri-plugin-stronghold） |
| 传输 | 每次请求通过 HTTP 请求头携带，格式见下方 |
| 后端接收 | 从请求头读取 key，仅在当次请求内存中使用，请求结束后立即丢弃 |
| 持久化 | 零持久化——不写数据库、不写日志、不写任何文件 |

**请求头格式：**
```
X-Anthropic-Key: sk-ant-xxx
X-OpenAI-Key: sk-xxx
X-DeepSeek-Key: sk-xxx
X-Gemini-Key: AIzaSyxxx
```

请求携带哪个 key，取决于本次调用的目标 provider；路由逻辑不感知 key 来源，只负责读取对应 header。

**影响范围：**
- `gateway/keys.py`：key 来源从 env var 改为从 request header 读取
- `adapters/`、`cache/`、`routers/`：**完全不变**，路由逻辑对 key 透明
- 服务端 `.env`：不再存放用户 key，仅保留服务级配置（日志路径、端口等）

**多用户兼容性：**  
每个用户在 Tauri 客户端各自持有自己的 key，后端每请求独立读取 header，天然支持多用户场景，无需共享 key 池。

---

## 统一 API 接口

### POST /v1/chat

**请求头：**
```
Content-Type: application/json
X-Anthropic-Key: sk-ant-xxx      # 按目标 provider 选择携带
```

**请求体：**
```json
{
  "model": "claude-sonnet-4-6",
  "messages": [...],
  "caching": true,
  "stream": true,
  "max_tokens": 1000,
  "tools": []
}
```

**响应（非流式）：**
```json
{
  "role": "assistant",
  "content": [...],
  "usage": {
    "input_tokens": 100,
    "output_tokens": 200,
    "cache_read_input_tokens": 50,
    "cache_creation_input_tokens": 0
  }
}
```

**流式：** SSE，各模型原生流式转为统一格式后输出。

---

## Normalized Message 格式

以 Claude content block 格式为基准（表达力最强，可无损覆盖所有模型场景）：

```typescript
interface NormalizedMessage {
  role: "user" | "assistant"
  content: ContentBlock[]
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: object }    // assistant
  | { type: "tool_result"; tool_use_id: string; content: string }   // user
  | { type: "thinking"; thinking: string }                           // Claude-specific
```

格式转换必须保持**确定性**（同一输入永远产生同一输出），以确保 DeepSeek 等模型的磁盘缓存能命中跨模型对话历史。

---

## Cache 策略

| 模型 | 策略 | 服务端处理 |
|------|------|-----------|
| Anthropic Claude | Automatic Caching | `caching=true` 时在顶层注入 `cache_control`，`caching=false` 时不注入 |
| OpenAI | 自动（服务端透明） | 无需处理，128 token 粒度自动命中 |
| DeepSeek | 自动（磁盘缓存） | 无需处理，64 token 起自动命中，TTL 以天计 |
| Gemini | 隐式自动 | 无需处理，默认 90% 折扣 |

---

## 目录结构

```
ai-service/
├── main.py
├── config.py               # API key、服务配置
├── routers/
│   └── chat.py             # POST /v1/chat
├── models/
│   └── normalized.py       # NormalizedMessage / ContentBlock 类型定义
├── adapters/               # 格式转换，每个模型一个
│   ├── base.py
│   ├── anthropic.py
│   ├── openai.py
│   ├── deepseek.py
│   └── gemini.py
├── cache/                  # Cache 策略，每个模型一个
│   ├── base.py
│   ├── anthropic.py        # Automatic Caching 注入
│   └── noop.py             # OpenAI / DeepSeek / Gemini（无需处理）
└── gateway/
    ├── keys.py             # API key 读取与分发
    └── cost.py             # token 用量 + 成本记录
```

**技术栈：** Python + FastAPI + httpx（异步 HTTP，支持 SSE 流式透传）

---

## 与 req-029 的关系

req-029「自建 LLM Gateway」的目标（成本可见性、API key 管理）由本服务的 `gateway/` 模块承接。req-029 被本需求吸收，建议标记为 dropped（目标已转移）。

---

## 验收指标

| 验收项 | 标准 |
|--------|------|
| 统一入口 | POST /v1/chat 接受 normalized 格式，正确路由到对应模型 |
| Claude 格式转换 | content block 格式正确传入，响应正确解析 |
| OpenAI 格式转换 | plain string 转换正确，tool_calls 与 tool_use 互转正确 |
| DeepSeek 格式转换 | 同 OpenAI 格式，确定性转换不破坏磁盘缓存命中 |
| Caching 开关 | `caching=true` 时 Claude 注入 `cache_control`，其他模型无变化 |
| SSE 流式透传 | 流式响应正常透传，前端延迟无明显增加 |
| token 用量记录 | 每次请求的 usage 写入日志，含 cache_read / cache_creation |
| BYOK 无存储 | key 从请求头读取，不写入数据库/日志/文件；服务端 .env 无用户 key |
