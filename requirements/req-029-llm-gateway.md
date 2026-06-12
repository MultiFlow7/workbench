---
id: req-029
title: 自建 LLM Gateway（sub2api 内化替换）
status: dropped
priority: medium
source: 对话讨论 2026-05-18
created: 2026-05-18
version: v0.9
dropped_by: req-047
dropped_at: v0.13
drop_reason: 目标（API key 管理、成本可见性、模型路由）已被 req-047「AI 工具层 Python 后端服务」完整承接，不再独立实现
---

# req-029 · 自建 LLM Gateway

## 需求描述

将 LLM 调用网关从外部 sub2api Docker 容器逐步迁移至工作台自建服务，最终实现「数据与能力完全自主」。当前 sub2api 是从 GitHub 下载的第三方镜像（`docker run ...`），不透明且无法深度定制。

## 迁移阶段规划

### Phase 1 · v0.4：透明代理模式（不替换 sub2api）

在工作台 Rust 后端（v0.2 已有，运行于 43.135.174.27:8081）新增 `/llm/proxy` 路由：

- 接收来自 Tauri 的 LLM 请求（透传 model / messages / stream）
- 转发至目标 provider（Anthropic / Google / OpenAI API）
- 拦截响应，提取 usage 字段写入结构化日志（SQLite `llm_calls` 表）
- 将响应流透传回 Tauri

sub2api 依然运行，但主对话路径通过 `/llm/proxy` 走，获得透明成本数据。

### Phase 2 · v0.5：原生 SSE 流式支持

- 实现流式响应（Server-Sent Events）转发
- 支持 multi-provider 路由（根据 model 名称自动选择 provider）
- 账单聚合：`llm_calls` 表提供实际 token 数（替代 req-028 的公开价格估算）
- sub2api 可选退出，主对话和 Agent dispatch 均通过自建 gateway

### Phase 3 · v0.5+：功能扩展

- 请求去重 / 缓存（相同 prompt hash 命中缓存）
- 速率限制（防止异常 Agent 刷 token）
- 多 KEY 轮转（Google One 账号 pool）
- Webhook 通知（月度 token 用量预警）

## 数据结构

```sql
CREATE TABLE llm_calls (
    id          TEXT PRIMARY KEY,
    ts          INTEGER NOT NULL,          -- Unix timestamp ms
    model       TEXT NOT NULL,
    provider    TEXT NOT NULL,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    latency_ms  INTEGER,
    qa_atom_id  TEXT,                      -- 关联到具体 QA atom（可空）
    agent_role  TEXT                       -- Agent dispatch 时的角色名（可空）
);
```

## 与 sub2api 的关系

| 能力 | sub2api | 自建 Gateway |
|------|---------|-------------|
| LLM 转发 | ✅ | ✅ Phase 1+ |
| 流式 SSE | ✅ | ✅ Phase 2+ |
| token 日志 | ✅（孤立） | ✅（写入 SQLite，与 QA atom 关联） |
| 多账号轮转 | ✅ | ✅ Phase 3 |
| 成本预警 | ❌ | ✅ Phase 3 |
| 工作台集成 | ❌ | ✅ 完全集成 |

sub2api 在 Phase 1 保留作为 fallback，Phase 2 完成后可停用。

## 实现位置

- **Rust 后端**（43.135.174.27:8081）：新增 `llm/` 路由模块
- **Tauri `stream_ai`**：`AI_ENDPOINT` 环境变量指向自建 gateway（Phase 1 切换）
- **`get_token_stats` 命令**（req-028）：数据源从 atom frontmatter 扩展到 `llm_calls` 表

## 讨论记录

**2026-05-18**：用户说「sub2api 是 GitHub 上的代码直接下载到 Docker 中的，我要慢慢替换成完全是自己的」，并明确「这也是为什么我希望慢慢用工作台替代掉 sub2api」。req-029 规划了这条迁移路径——不是一次性切换，而是透明代理→原生流式→完整替代的三段式演进，每阶段都保留 fallback，降低迁移风险。

## v0.9 范围重新界定（CEO 决策 2026-05-20）

v0.5 的完整 LLM Gateway 目标（全面替换 sub2api）因复杂度过高持续推迟。

v0.9 将 req-029 范围缩减为「成本可见性」子集：
- 后端新增 `llm_calls` 表，记录每次 Claude API 调用的 model / input_tokens / output_tokens / duration_ms
- 前端 Dashboard 新增「近 7 天 LLM 调用汇总」卡片
- 不替换 sub2api，不新增代理路由

完整 Gateway 替换推迟至 v0.10 或更晚版本评估。
