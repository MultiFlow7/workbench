---
project: 工作台
version: v0.9
status: approved
doc_revision: 3
created: 2026-05-20
updated: 2026-05-20
author: workbench-product
approved_by: workbench-ceo
approved_at: 2026-05-20
tags:
  - 类型/规划文档
  - 主题/技术/工作台
  - 状态/已批准
---

# product.md · 工作台 v0.9 · 对话体验提升 + 模型灵活性

---

## 版本主题

**对话体验提升 + 模型灵活性**

v0.8 完成了 Agent 沙盒与 Harness 管控层，工作台进入「基础设施稳固」阶段。v0.9 的重心转向用户可直接感知的对话层优化：让 AI 回答可读、让模型选择灵活、让成本有据可查。这三件事共同服务于「降低人管理 AI 团队的认知负担」这一核心目标。

---

## 版本目标

1. **对话可读性达到生产可用水平**：AI 回答中的 Markdown 语法正常渲染，消除当前「原始符号污染」的体验问题，让工作台具备日常主力对话工具的资格。

2. **模型选择从手动硬编码升级为角色级配置**：不同 Agent 角色可绑定不同底层模型，调度器在 dispatch 阶段自动注入，无需改代码。与产品方向「AI first 后端」原则对应——让后端调度器承担模型路由决策，而非前端用户手选。

3. **LLM 调用成本首次可见**：后端开始记录每次 API 调用的 token 数与耗时，前端 Dashboard 提供近 7 天汇总视图。这是 req-029 完整 Gateway 目标的最小可行子集，在不替换 sub2api 的前提下实现成本可观测性。

---

## 需求范围

### 纳入 v0.9 的需求

| ID | 标题 | 优先级 | 来源 | 说明 |
|----|------|--------|------|------|
| [req-032](../../requirements/req-032-markdown-rendering.md) | ChatView Markdown 渲染 | high | v0.9 新增 | 用户报告对话显示问题，CEO 需求打包 2026-05-20 |
| [req-024](../../requirements/req-024-per-agent-llm-config.md) | Agent 级别 LLM 配置 | medium | backlog 升格 | 调度器 req-014 已在 v0.7 完成，依赖满足，可实现 |
| [req-029（缩减版）](../../requirements/req-029-llm-gateway.md) | LLM 调用成本日志 | medium | 范围重新界定 | 从「Gateway 替换」缩减为「成本可见性」子集 |

### req-032 · ChatView Markdown 渲染（high）

当前 `ChatView.tsx` 的 `bubble--ai` 气泡直接渲染文本节点（第 285 行），AI 回答中的 `**bold**`、`# heading`、代码块等以原始符号显示。

v0.9 引入 `react-markdown` + `remark-gfm`，仅对 AI 消息气泡应用 Markdown 渲染，用户消息保持纯文本。Streaming 中的 `streamingText` 同步接入渲染，保持一致性。

**关键验收指标**（完整验收标准见 [req-032](../../requirements/req-032-markdown-rendering.md)）：

| 验收项 | 标准 |
|--------|------|
| 标题渲染 | `# H1` / `## H2` / `### H3` 渲染为对应 HTML heading，具备字号区分 |
| 粗体 / 斜体 | `**text**` 渲染为 `<strong>`，`*text*` 渲染为 `<em>` |
| 代码块 | 围栏代码块渲染为等宽字体区块，行内代码渲染为高亮 span |
| 列表 | `- item` 和 `1. item` 正常渲染为 `<ul>` / `<ol>` |
| 用户消息不受影响 | `bubble--user` 保持纯文本渲染 |
| Streaming 不崩溃 | 不完整的 Markdown 语法下不报错 |
| 安全性 | 渲染结果无 XSS 风险（react-markdown 默认不注入 raw HTML） |

### req-024 · Per-agent LLM 配置（medium）

在角色定义文件（`roles/{role_name}.yaml`）中新增 `model` 字段（provider / model_id / api_endpoint / max_tokens / temperature）。调度器（已有）在 dispatch 阶段读取角色配置，选择对应 provider 和 endpoint。

未配置时 fallback 到全局默认模型（当前 gemini-2.5-pro via sub2api），行为与现有一致。

**关键验收指标**：

| 验收项 | 标准 |
|--------|------|
| 配置字段支持 | 至少 3 个角色的 `.yaml` 中成功添加 `model` 字段，文件格式合法 |
| 调度器读取 | 配置了 `model` 字段的角色，dispatch 时实际调用对应 provider / endpoint |
| Fallback 行为 | 未配置 `model` 字段的角色，行为与现有一致（使用全局默认） |
| 无前端代码改动 | 模型路由决策全在后端调度器，前端无需新增 UI |

### req-029（缩减版）· LLM 调用成本日志（medium）

v0.9 范围仅包含：
- 后端 Rust 新增 `llm_calls` 表（model / input_tokens / output_tokens / duration_ms）
- 前端 Dashboard 新增「近 7 天 LLM 调用汇总」卡片

不替换 sub2api，不新增代理路由。完整 Gateway 替换推迟至 v0.10 或更晚评估。

**关键验收指标**：

| 验收项 | 标准 |
|--------|------|
| 表结构创建 | `llm_calls` 表在 SQLite 中成功创建，包含 model / input_tokens / output_tokens / duration_ms 字段 |
| 数据写入 | 发起一次 AI 调用后，`llm_calls` 表有对应记录写入 |
| Dashboard 卡片 | 近 7 天汇总卡片可见，展示总调用次数、总 input_tokens、总 output_tokens |
| 无数据时降级 | 无调用记录时 Dashboard 卡片显示「暂无数据」，不报错 |

**已知局限**：v0.9 的 `llm_calls` 写入逻辑挂载在现有 sub2api 调用路径上，仅覆盖经由该路径的调用。req-024 引入多 provider 后，其他 endpoint（非 sub2api）的调用暂时不会写入 `llm_calls` 表，成本数据会有缺口。完整多 provider 成本覆盖依赖 req-029 完整版 Gateway 实现后解决。

---

## Out of Scope

| ID | 标题 | 推迟原因 |
|----|------|---------|
| [req-021](../../requirements/req-021-memory-agent.md) | 记忆 Agent（语义上下文注入） | 依赖上下文构建器（req-015）深度改造尚未完成，且需要向量存储与语义检索方案选型未定；在这两项前置工作完成前纳入版本会引入不可控的范围蔓延。推迟至 v0.10+，届时上下文构建器稳定后重新评估。 |
| req-029（完整版）| Gateway 全面替换 sub2api | v0.9 仅完成 Phase 0（日志记录），Phase 1（透明代理路由切换）需要 Tauri `stream_ai` 的 `AI_ENDPOINT` 切换测试及流式 SSE 转发验证，影响主对话路径稳定性；Phase 2（原生 SSE + 多 provider）更依赖 req-024 多 provider 路由先稳定。待 v0.9 成本日志数据积累后，于 v0.10 重新评估 Phase 1 启动时机。 |

---

## 长期一致性说明

### 与「AI first 后端 / Human first 前端」原则的对应

产品方向文档确立了「后端逻辑 AI first，前端逻辑 Human first」的一体两面原则：

**req-024（Per-agent LLM 配置）**——后端 AI first 的直接体现。模型选择决策从「用户在前端下拉框手选」迁移到「调度器按角色配置自动注入」，减少人工干预，让 Agent 团队的模型路由成为可配置的系统行为而非临时操作。

**req-032（Markdown 渲染）**——前端 Human first 的直接体现。AI 的输出格式已经具备语义结构（Markdown），但前端没有将其可视化，造成信息密度损失。渲染优化让人类用户获得更低认知负担的阅读体验，是「前端服务于人」的核心工作。

**req-029 缩减版（成本日志）**——执行透明化原则的落地。产品方向强调「监控执行状态」是管理 AI 团队的核心能力之一。成本可见性是执行透明化的财务维度——知道每次 API 调用花了多少，是「人管理 AI」不可缺少的控制信息。

### 与四面板布局原则的一致性

req-032 的修改范围严格限于 P3（主工作区）内的消息气泡渲染层，不跨越面板职责边界。req-029 的 Dashboard 卡片归属 P3 工具模式视图，不影响 P2 结构面板。req-024 的模型配置是后端调度器行为，前端无需新增 UI（可选在 P4 详情面板展示当前角色模型配置，作为只读信息）。

---

## 数据埋点计划

| 需求 | 埋点事件 | 字段 | 触发时机 |
|------|---------|------|---------|
| req-024 | `model_config_changed` | `{agent_role, old_model, new_model, changed_at}` | 用户修改角色配置文件并保存时 |
| req-029 | `llm_call_logged`（核心功能，不额外埋点） | 已在 `llm_calls` 表记录 | 每次 API 调用完成后后端写入 |
| req-032 | `markdown_render_toggle` | `{enabled: boolean}` | 当前版本默认开启无开关，**暂不埋点**；引入开关后再启用 |

---

## 依赖关系

| 依赖项 | 说明 |
|--------|------|
| v0.8 T8-T11 验收 | **不依赖**。v0.9 三个需求均为独立功能，可与 v0.8 验收并行推进技术规划 |
| req-014（调度器） | req-024 依赖调度器已实现（v0.7 done），依赖满足 ✅ |
| req-028（Token 仪表盘） | req-029 缩减版与 req-028 共用 Dashboard 区域，样式和数据流复用，不存在冲突。req-028 已在 v0.8 规划范围内，Dashboard 区域可用（若 v0.8 验收延迟，req-029 卡片布局可与 req-028 同步落地） |
| sub2api | req-029 缩减版**不替换** sub2api，零依赖风险 |

---

## 修订记录

| 版本 | 日期 | 修改内容 |
|------|------|---------|
| doc_revision 1 | 2026-05-20 | 初稿，workbench-product 基于 CEO v0.9 指令创建 |
| doc_revision 2 | 2026-05-20 | review-agent 修复：① Out of Scope 推迟原因充实（req-021 / req-029 完整版具体化前置条件）；② 补充 req-029 缩减版「已知局限」（多 provider 成本数据缺口）；③ 三个需求均补充关键验收指标表；④ 依赖关系表补充 req-028 当前状态说明 |
| doc_revision 3 | 2026-05-20 | workbench-ceo 审批通过，status: draft → approved |
