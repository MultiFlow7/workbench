---
project: 工作台
version: v0.5
status: approved
doc_revision: 2
created: 2026-05-18
updated: 2026-05-19
author: workbench-product
approved_by: workbench-ceo
approved_at: 2026-05-19
---

# product.md · 工作台 v0.5

---

## 版本背景与目标

### 版本方向

**v0.5 的目标是完成 LLM 调用链的自主可控迁移，将 sub2api 降级为备用，并让仪表盘使用来自 gateway 的精确 token 数据。**

v0.4 建立了透明代理路由（`/llm/proxy`）和 `llm_calls` 数据表，但 Tauri 主对话路径仍走 sub2api。v0.5 完成三件事：
1. **req-029 Phase 2**：`/llm/proxy` 支持 SSE 流式响应转发，实现与 sub2api 功能对等
2. **流量切换**：Tauri `stream_ai` 的 `AI_ENDPOINT` 切换到自建 gateway，sub2api 降为备用
3. **仪表盘升级**：req-028 仪表盘新增 `llm_calls` 视图，成本估算基于 gateway 记录的精确 token 数（仍用 hardcode 价格表，token 数更准确）
4. **多 key 轮转**：Google API key 池，分散单 key 速率限制风险（req-029 Phase 3 前置）

**为什么现在做这四件事？**
- Phase 2 SSE 在 v0.4 没做的原因是流量还未切换，Phase 2+切换可以一次性完成，避免半成品状态
- 流量切换后立即面临单 Google key 速率限制风险，多 key 轮转需同步上线，不能分开
- 仪表盘升级是直接收益：gateway 记录的 token 数精确，且覆盖 Agent dispatch 调用（不只是 QA atom）

### 版本边界

**本版本做**：
- req-029 Phase 2：`/llm/proxy` SSE 流式转发（Axum + tokio async streaming，tee 模式确保 Tauri 可读 usage）
- req-029 Phase 2：Tauri `stream_ai` 切换 `AI_ENDPOINT` 至自建 gateway（配置文件修改）
- req-028 数据源升级：仪表盘新增 `llm_calls` 视图，与 atom frontmatter 视图并存，用户可切换
- 多 key 轮转（req-029 Phase 3 前置）：Google API key 池，轮询策略，单 key 429 自动切换下一 key

**本版本不做**：
- req-029 Phase 3 完整功能（请求缓存、速率限制、Webhook 预警）→ 推 v0.6
- 停用 sub2api Docker 容器 → 保留作为备用，不主动停止
- 接入真实账单 API（token 成本仍用 hardcode 价格表估算）
- 任何改变 Agent 调度架构的内容

> **Phase 3 前置说明**：req-029 规格书将多 key 轮转列为「Phase 3 · v0.5+」，即原计划推 v0.6。本版本将其提前到 v0.5，原因是流量切换（Phase 2）完成后立即面临单 Google key 速率限制风险，两者需同步上线才能稳定运行。Phase 3 其余功能（缓存、限流、Webhook）仍推 v0.6，本次仅实现轮转基础。

### 选取理由

- **可演示**：v0.5 完成后，整个主对话链路不再经过 sub2api——用户发消息、收到流式回复、`llm_calls` 记录实际 token 数、仪表盘「完整调用」视图展示精确估算成本，完整闭环
- **阶段降险**：Phase 2 SSE 先测试验收，sub2api 保留 fallback（切换是单行配置，随时可回退）
- **数据完整性**：切换后 llm_calls 包含所有调用（含 Agent dispatch），仪表盘数据质量飞跃

---

## 功能设计

### req-029 Phase 2 · SSE 流式转发

**核心功能**：`/llm/proxy` 新增流式模式（`stream: true`），将 provider 的 SSE 流以「tee 模式」（读取同时转发）原样透传给调用方。

**流式转发行为**：
- 请求体中含 `"stream": true` 时，进入流式模式（非流式路径完全不变，v0.4 已有）
- **透明转发**：Axum 使用 tee 模式——每个 SSE chunk 在转发给调用方（Tauri）的同时，Axum 侧读取以提取 usage 数据；原始 SSE 事件内容**不修改、不消费**，Tauri `stream_ai` 正常收到完整 SSE 流（包含 usage 事件），可正常解析 usage 并写入 qa_atom frontmatter
- **SSE 格式**：透传 provider 原生格式（Anthropic SSE，不做 OpenAI 格式转换）；流结束标志为 Anthropic 的 `event: message_stop`
- **usage 提取时机**：Axum 侧扫描每条 SSE 事件，从 `message_delta` 事件的 `usage.output_tokens` 字段读取 output token 数，从 `message_start` 事件的 `message.usage.input_tokens` 字段读取 input token 数（此格式与 v0.3 Tauri 侧解析的 SSE 格式相同，但解析的实现位置是 Axum，不是 Tauri）
- **usage 写入时机**：`message_stop` 事件接收后，将 input + output tokens 写入 `llm_calls`（一次性插入，不在每条 chunk 后写入）
- 流中断时（客户端断开或 provider 错误）：记录 `latency_ms` 为断开时刻，`input_tokens` / `output_tokens` 为已解析到的值（可能为 null，不阻断）

**兼容性保证**：
- 非流式请求（v0.4 已有路径）完全不变
- 流式模式仅支持 Anthropic 和 Google（已知 provider）；未知 provider 的流式请求返回 400

**验收标准**：
- `curl -N -X POST /llm/proxy -H 'Content-Type: application/json' -d '{"model":"claude-haiku-4-5-20251001","messages":[{"role":"user","content":"say hi"}],"max_tokens":20,"stream":true}'`，逐行输出 Anthropic 原生 SSE 事件（如 `data: {"type":"content_block_delta",...}`）；最终输出包含 `event: message_stop` 的行
- 流式完成后，`llm_calls` 表有新记录，`input_tokens` 和 `output_tokens` 均有值（非 null）
- 不含 `"stream"` 字段的请求走 v0.4 非流式路径，行为不变

---

### Tauri 流量切换

**核心功能**：将 Tauri `stream_ai` 命令的 LLM 请求目标从 sub2api 切换至自建 gateway。

**切换方式**：修改 `/data/workbench/workbench.env` 中的 `AI_ENDPOINT` 变量值（此变量在 v0.4 Phase 1 建设时已写入 env 文件，v0.5 仅修改其值），然后 reload systemd service：

```
# 修改前（v0.4 及之前）
AI_ENDPOINT=http://43.135.174.27:8080

# 修改后（v0.5）
AI_ENDPOINT=http://43.135.174.27:8081/llm/proxy
```

reload 命令：`systemctl reload workbench-backend`（或 restart，视 Tauri 进程管理而定）。

> **切换条件**：`/llm/proxy` 流式 SSE 转发（Phase 2）必须验收通过后才能切换；切换前确认多 key 轮转已配置（否则单 key 速率限制将导致 Tauri 对话 429 错误）。

**回退方案**：将 `AI_ENDPOINT` 改回 `http://43.135.174.27:8080` 并 reload，sub2api 不停用，随时可回退。

**验收标准**：
- 修改 `AI_ENDPOINT` 并 reload 后，Tauri 正常发送一条消息，P3 显示流式回复（字符逐渐出现，与切换前体验一致）
- `llm_calls` 表有新记录，确认流量经过 gateway
- sub2api `:8080` 仍然运行（`curl localhost:8080/v1/models` 返回 200）
- 将 `AI_ENDPOINT` 改回 sub2api 地址，Tauri 对话功能恢复（回退验证）

---

### req-028 数据源升级

**核心功能**：在 v0.4 仪表盘的基础上，新增 `llm_calls` 视图，与 atom frontmatter 视图并存，用户可在仪表盘内切换数据源。

**两种数据源对比**：

| 维度 | Atom Frontmatter（v0.4 视图） | llm_calls 表（v0.5 新增视图） |
|------|---------------------------|-----------------------------|
| 覆盖范围 | 仅 QA atom（主对话） | 所有调用（含 Agent dispatch） |
| 历史数据 | req-025 上线后有数据 | v0.4 /llm/proxy 路由建立后有记录 |
| Token 数准确性 | frontmatter 中 API 返回的精确 token 数（v0.3 写入） | API 返回的精确 token 数（gateway 记录） |
| 成本估算 | hardcode 价格表 × token 数 | hardcode 价格表 × token 数（token 数更全面）|
| 数据来源 | 本地磁盘扫描 | Rust Tauri 命令查询 SQLite |

> **注**：两个视图的成本估算都使用 hardcode 价格表，均非真实账单数据。「llm_calls」视图的优势在于覆盖面更广（含 Agent dispatch 调用），而非成本计算更精确。

**视图切换 UI**：仪表盘顶部增加切换标签：「对话记录（atom）」/「完整调用（gateway）」，切换后图表和卡片数据即时更新。

**`llm_calls` 视图需要新增 Rust Tauri 命令**（类似 v0.4 议题 E 的 E2 方案）：`get_token_stats_from_gateway({ date_from?, date_to? })`，查询 SQLite `llm_calls` 表，返回与 `DayModelBucket[]` 格式相同的数据。DashboardView 不需要改动渲染逻辑，只需切换数据来源。

**议题 E 兼容说明**：v0.4 议题 E 决定仪表盘主要用 E1（前端 JS）还是 E2（Rust 命令）来聚合 atom 数据。v0.5 的「完整调用」视图**必须**新增 Rust 命令（不能在前端 JS 中直接扫描 SQLite），两个视图数据来源不同但渲染层共用。

**降级处理**：`llm_calls` 表为空（v0.4 安装之前无数据）时，「完整调用」视图显示「gateway 数据尚未积累，发送消息后将自动记录」，不报错，不影响「对话记录」视图。

**验收标准**：
- 仪表盘顶部显示两个切换标签；切换到「完整调用」视图，卡片和图表显示来自 llm_calls 的数据（不同于 atom frontmatter 来源的数值，因为覆盖范围不同）
- llm_calls 表为空时，「完整调用」视图显示降级提示，不影响「对话记录」视图正常使用
- 两个视图的汇总卡片计算口径相同（如「日均消耗」分母均为有记录天数，而非总日历天数），确保跨视图数字可对比

---

### 多 key 轮转（req-029 Phase 3 前置）

**核心功能**：Rust gateway 支持配置多个 Google API key，按轮询策略选择 key 发送请求，分散单 key 速率限制风险。

**配置方式**：v0.5 将 v0.4 的 `GOOGLE_API_KEY`（单数）迁移为 `GOOGLE_API_KEYS`（复数，逗号分隔）。单个 key 时不含逗号，兼容格式一致：

```
# v0.4（废弃，v0.5 迁移后不再读取）
GOOGLE_API_KEY=key1

# v0.5（统一使用复数形式，单 key 也用此格式）
GOOGLE_API_KEYS=key1,key2,key3
```

`workbench.env` 中删除旧 `GOOGLE_API_KEY`，追加 `GOOGLE_API_KEYS`；Rust 侧删除读取 `GOOGLE_API_KEY` 的代码，改为读取 `GOOGLE_API_KEYS` 并解析为 `Vec<String>`。

**轮转策略**：原子计数器 `AtomicUsize`（存于 `AppState`），每次 Google 请求后 +1 对 key 数量取模，线程安全，无锁。

**单 key 429 处理**（议题 F 决策）：当前选用的 key 返回 429 时，**切换到下一个 key 并重新发送一次请求**（仅一次切换重试，不循环）；若所有 key 均已被尝试且均返回 429，则返回 429 给调用方。

**验收标准**：
- 配置 2 个 Google key（`GOOGLE_API_KEYS=key1,key2`），连续发送 4 次非流式请求，通过 `RUST_LOG=debug` 日志确认两个 key 各被使用 2 次（轮询交替）
- 模拟第一个 key 返回 429：gateway 自动切换到第二个 key，响应成功；`llm_calls` 中 `model` 字段正常记录
- 配置单个 key（`GOOGLE_API_KEYS=key1`），行为与 v0.4 单 key 模式一致，无报错

---

## 关键数据流

### v0.5 主对话数据流（切换后）

```
用户在 Tauri P3 输入消息
    ↓ invoke('stream_ai', ...)
Tauri Rust stream_ai（AI_ENDPOINT = http://43.135.174.27:8081/llm/proxy）
    ↓ POST /llm/proxy，stream: true
Axum /llm/proxy（Phase 2 流式模式）
    │                                ← tee 模式：
    ├─ 解析 SSE 事件中的 usage 字段（input_tokens / output_tokens）
    └─ 原样转发全部 SSE chunk → Tauri stream_ai 接收（usage 事件不被消费）

Provider API（Anthropic / Google）
    ↓ SSE 流式响应（原生 Anthropic 格式）

Tauri stream_ai 接收 SSE 流（完整，含 usage 事件）
    ↓ emit 'ai-token'（每个文字 delta）
    ↓ emit 'ai-done'（流结束，payload 含 usage，v0.3 已有逻辑）

Axum 收到 message_stop → INSERT INTO llm_calls（独立写入，不依赖 Tauri）

ChatView.tsx 接收 ai-done
    ↓ write_qa_atom（含 token 字段，v0.3 逻辑，数据来自 Tauri 解析的 usage）
```

### 仪表盘双数据源

```
[对话记录视图（v0.4 已有）]        [完整调用视图（v0.5 新增）]
  前端 JS / Rust 命令                  Rust Tauri 命令
  聚合 atom frontmatter                 查询 llm_calls SQLite
       ↓                                     ↓
             DashboardView（共用渲染层，标签切换数据源）
```

---

## 产品边界确认

**不做的事**：
- 不停用 sub2api（保留 fallback）
- 不实现请求缓存、速率限制、Webhook 预警（推 v0.6）
- 不接入真实账单 API（成本仍用 hardcode 价格表估算）
- 不做 Google 以外模型的多 key 轮转（Anthropic 单 key）

**v0.5 对用户的可见变化**：
- 对话功能外观不变，但流量路径变了（sub2api → 自建 gateway）
- 仪表盘新增「完整调用」视图标签，数据更全
- Google API key 配置方式从 `GOOGLE_API_KEY` 迁移为 `GOOGLE_API_KEYS`（需手动更新 workbench.env）

---

## 版本一致性说明

v0.5 是「迁移完成版」——完成 req-029 规划中最核心的目标：工作台主对话链路不再依赖第三方不透明 Docker 镜像，数据完全自主可控。

**与 req-029 规格书的阶段偏差**：本版本将「多 key 轮转」（规格书 Phase 3，原计划 v0.5+）提前至 v0.5 实施，原因是流量切换（Phase 2）完成后立即面临单 key 速率限制风险，两者需同步上线。Phase 3 其余功能（缓存、限流、Webhook）仍推 v0.6，此次仅实现轮转基础。

与产品方向「数据随内容走」原则一致；「渐进式迁移」原则体现在 sub2api 保留为 fallback，未强制停用。

---

## 修订记录

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1 | 2026-05-18 | workbench-product | 初稿 |
| v2 | 2026-05-18 | workbench-product | review-agent 第 1 轮修复：B-01 SSE usage 提取主体澄清（Axum 独立实现，非复用 Tauri 代码）、B-02 tee 模式说明（Axum 读取 usage 同时原样转发所有 SSE chunk，Tauri 仍可读 usage）、B-03 议题 F 决策写入（单 key 429 切换下一 key 一次，全部 429 返回 429，与正文统一）、B-04 Phase 3 前置声明（版本一致性说明中说明阶段偏差原因）、W-01 验收标准去掉 [DONE]（Anthropic 格式是 message_stop，非 OpenAI [DONE]）、W-02 AI_ENDPOINT 变量来源说明（v0.4 已写入，v0.5 只改值）、W-03 验收标准改为行为描述（计算口径相同而非函数名相同）、W-04 「精确成本」修正为「基于 gateway 精确 token 数的估算，成本仍用 hardcode 价格表」、W-05 GOOGLE_API_KEY→GOOGLE_API_KEYS 迁移策略明确 |
