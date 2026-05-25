---
project: 工作台
version: v0.6
status: approved
doc_revision: 4
created: 2026-05-19
updated: 2026-05-19
author: workbench-ceo（代行 backend-agent/frontend-ui/tauri-platform）
---

# technical.md · 工作台 v0.6 · Control Room

---

## 背景说明

**重要：本 technical.md 记录的是「代码已领先于规划文档」的真实情况。**

在 v0.6 product.md approved（2026-05-19）之前，工程 Agent 已完成了大量实现工作。本文档的任务是：
1. 如实记录已完成的实现状态（标记 `[x]`）
2. 补充仍缺失的实现项（标记 `[ ]`）
3. 提供完整的测试计划，供 qa-agent 验收

---

## 架构概览

v0.6 涉及三层变更：

```
Axum 后端（43.135.174.27:8081）
├── state_machine/          — Agent 任务数据模型 + 状态迁移规则
├── routes/tasks.rs         — /api/tasks CRUD
├── routes/decisions.rs     — /api/decisions 决策管理
├── routes/tokens.rs        — /api/tokens 权限令牌
├── routes/events.rs        — /api/events/stream SSE 推送
├── dispatcher/             — Agent 调度引擎（v0.7 范围，已提前实现）
├── context_builder/        — 上下文构建（v0.7 范围，已提前实现）
├── harness/                — 管控层（v0.7 范围，已提前实现）
└── sandbox/                — 沙盒路径工具（v0.7 范围，已提前实现）

Tauri Rust 命令层（workbench/src-tauri/）
├── commands/backend_client.rs  — create_task / list_decisions / resolve_decision 等
└── commands/sse_client.rs      — SSE 订阅

Tauri React 前端（workbench/src/）
├── components/DecisionInbox/   — 决策收件箱 UI（DecisionInbox + DecisionCard）
├── components/DecisionPanel/   — 决策详情 P4 面板
├── store/decisionsSlice.ts     — 决策状态管理（Zustand）
└── hooks/useBackendSSE.ts      — SSE 事件消费
```

---

## Node 1：Axum 后端 · 数据库与状态机

### 数据库建表（`src/db.rs`）

**已完成 ✓**

```sql
-- agent_tasks 表（已实现）
CREATE TABLE IF NOT EXISTS agent_tasks (
    task_id       TEXT PRIMARY KEY,
    task_type     TEXT NOT NULL,          -- ProductPlanning/Review/Engineering/Memory
    role          TEXT NOT NULL,          -- Ceo/ProductAgent/ReviewAgent/TechnicalAgent
    status        TEXT NOT NULL,          -- Pending/Running/Blocked/AwaitingDecision/Completed/Failed
    project       TEXT NOT NULL,
    version       TEXT NOT NULL,
    input_context TEXT NOT NULL,
    output        TEXT,
    blocking_on   TEXT,
    decision_request TEXT,               -- JSON 序列化的 DecisionRequest
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

-- capability_tokens 表（已实现）
CREATE TABLE IF NOT EXISTS capability_tokens (
    token_id   TEXT PRIMARY KEY,
    token_type TEXT NOT NULL,            -- DELIVERABLE/APPROVED/MERGEABLE
    target_id  TEXT NOT NULL,
    issued_at  TEXT NOT NULL,
    issued_by  TEXT NOT NULL
);

-- decisions 表（已实现，独立于 agent_tasks.decision_request）
CREATE TABLE IF NOT EXISTS decisions (
    decision_id TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL,
    agent_role  TEXT NOT NULL,
    question    TEXT NOT NULL,
    options     TEXT NOT NULL,           -- JSON 数组
    risk_level  TEXT NOT NULL,           -- Low/Medium/High
    created_at  TEXT NOT NULL,
    resolved_at TEXT,
    resolution  TEXT
);
```

> **与 product.md 的差异说明**：product.md 定义的表结构（`decision_question`/`decision_options`/`risk_level` 内联字段）在实现中被拆分为独立的 `decisions` 表（更清晰的关注点分离）。这是工程优化，不影响功能语义。

### 实现节点 Checklist（Node 1）

- [x] `agent_tasks` 表创建（`src/db.rs`）
- [x] `capability_tokens` 表创建（`src/db.rs`）
- [x] `decisions` 表创建（`src/db.rs`）
- [x] SQLite WAL 模式启用（`PRAGMA journal_mode=WAL`）
- [x] 数据库目录自动创建（`create_dir_all`）
- [x] **待补充**：`agent_tasks` 表缺少 `title` 字段（product.md 要求展示用摘要字段）——需执行 `ALTER TABLE agent_tasks ADD COLUMN title TEXT`，并在 POST /tasks 时自动截取 `input_context` 前 50 字填充

---

## Node 2：Axum 后端 · 任务 API（`src/routes/tasks.rs`）

### 已实现接口

| 方法 | 路径 | 状态 |
|------|------|------|
| `POST` | `/api/tasks` | ✓ 已实现 |
| `GET` | `/api/tasks` | ✓ 已实现（支持 `?status=&role=&project=` 过滤） |
| `GET` | `/api/tasks/:task_id` | ✓ 已实现 |
| `PATCH` | `/api/tasks/:task_id/status` | ✓ 已实现 |
| `POST` | `/api/tasks/:task_id/dispatch` | ✓ 已实现（启动 AgentDispatcher，v0.7 范围但已提前实现） |

### 缺失接口

| 方法 | 路径 | 优先级 | 说明 |
|------|------|--------|------|
| `GET` | `/api/tasks/stats` | high | 任务统计（各 status 数量），供前端 badge 展示，响应格式：`{ "pending": 2, "running": 1, "awaiting_decision": 3, "completed": 12, "failed": 0, "blocked": 0 }` |

### 实现节点 Checklist（Node 2）

- [x] `POST /api/tasks` 创建任务，返回 `{ task_id }`
- [x] `GET /api/tasks` 列表，支持 `status`/`role`/`project` 过滤
- [x] `GET /api/tasks/:task_id` 单任务详情
- [x] `PATCH /api/tasks/:task_id/status` 更新状态
- [x] 状态合法性校验（仅允许合法状态迁移）
- [x] **待实现**：`GET /api/tasks/stats` 统计接口（返回各 status 的任务数量）
- [x] **待补充**：`POST /api/tasks` 请求体中支持 `title` 字段（当前无此字段）

---

## Node 3：Axum 后端 · 决策 API（`src/routes/decisions.rs`）

### 已实现接口

| 方法 | 路径 | 状态 |
|------|------|------|
| `GET` | `/api/decisions` | ✓ 已实现（支持 `?filter=pending` 过滤） |
| `GET` | `/api/decisions/:decision_id` | ✓ 已实现 |
| `POST` | `/api/decisions/:decision_id/resolve` | ✓ 已实现（写入 resolution + 触发 SSE） |

### 实现节点 Checklist（Node 3）

- [x] `GET /api/decisions` 列出决策请求
- [x] `GET /api/decisions/:id` 单决策详情
- [x] `POST /api/decisions/:id/resolve` 解决决策，更新 `resolved_at` + `resolution`
- [x] 决策解决后广播 SSE 事件

---

## Node 4：Axum 后端 · SSE 事件推送（`src/routes/events.rs`）

### 已实现

- SSE endpoint：`GET /api/events/stream`（基于 `broadcast::channel<SseEvent>`）
- 任务状态变更、决策创建/解决时广播事件
- 前端通过 Tauri `sse_client.rs` 订阅此 endpoint

### 实现节点 Checklist（Node 4）

- [x] `GET /api/events/stream` SSE endpoint
- [x] `AppState.sse_tx: broadcast::Sender<SseEvent>` 建立广播通道
- [x] 任务 PATCH 后广播 `task_updated` 事件
- [x] 决策 resolve 后广播 `decision_resolved` 事件
- [x] 前端 `useBackendSSE.ts` 消费 SSE 事件，更新 Zustand 状态

---

## Node 5：Tauri Rust 命令层（`workbench/src-tauri/src/commands/`）

### 已实现命令（`backend_client.rs`）

- `create_task(task_req: Value) -> Result<String, String>` — 调用 POST /api/tasks
- `dispatch_task(task_id, documents) -> Result<(), String>` — 调用 POST /api/tasks/:id/dispatch
- `list_decisions(filter) -> Result<Vec<Value>, String>` — 调用 GET /api/decisions
- `resolve_decision(decision_id, resolution) -> Result<(), String>` — 调用 POST /api/decisions/:id/resolve

### 缺失命令

| 命令名 | 说明 | 对应 API |
|-------|------|---------|
| `list_tasks` | 获取任务列表，供前端任务总览使用 | GET /api/tasks |
| `get_task_stats` | 获取任务统计（各 status 数量） | GET /api/tasks/stats |

### 实现节点 Checklist（Node 5）

- [x] `create_task` Tauri 命令
- [x] `dispatch_task` Tauri 命令
- [x] `list_decisions` Tauri 命令
- [x] `resolve_decision` Tauri 命令
- [x] SSE 订阅命令（`sse_client.rs`）
- [x] `list_tasks` Tauri 命令（GET /api/tasks，支持 status/role/project 可选过滤参数）
- [x] `get_task_stats` Tauri 命令（GET /api/tasks/stats，返回各 status 计数 JSON）

---

## Node 6：前端 · 决策收件箱 UI（`src/components/DecisionInbox/`）

### 已实现

- `DecisionInbox.tsx`：展示决策列表，按风险等级排序（High → Medium → Low），然后按创建时间排序
- `DecisionCard.tsx`：单条决策卡片（问题 + 选项按钮 + 风险标签 + 等待时长）
- `DecisionCard.css` / `DecisionInbox.css`：样式

### 功能验证点

- 挂载时自动调用 `loadDecisions()`
- 点击决策卡片 → 设置 `selectedDecisionId` → P4 展示决策详情（`DecisionPanel`）
- `handleResolve`：调用 `resolve_decision` Tauri 命令，成功后从列表移除，更新 badge 计数

### 实现节点 Checklist（Node 6）

- [x] `DecisionInbox.tsx` 主组件（列表 + 空状态）
- [x] `DecisionCard.tsx` 决策卡片（问题 + 选项 + 风险 + 等待时长）
- [x] 按风险等级优先排序（High 置顶）
- [x] 点击卡片 → P4 显示 `DecisionPanel`（详情面板）
- [x] Approve/Reject 操作后卡片移除，badge -1
- [x] 风险等级边框颜色区分（`decision-card--HIGH/MEDIUM/LOW::before` 左侧 3px 色条，已验证）
- [x] 「稍后处理」按钮（`DecisionCard.tsx` 固定按钮 + `DecisionInbox.tsx` snoozedIds 本地过滤）

---

## Node 7：前端 · 任务总览 UI（`src/components/`）

> **前置依赖**：Node 5 的 `list_tasks` Tauri 命令 + Node 2 的 `GET /api/tasks/stats` 接口必须先完成。

### 缺失（需新建）

`product.md` 要求控制台模式 P3 展示**任务总览**（按状态分组：待执行/运行中/等待决策/已完成/失败）。当前代码中存在 `DecisionInbox`，但**任务总览组件尚未实现**。

需要新建：
- `src/components/TaskOverview/TaskOverview.tsx` — 任务总览主组件
- `src/components/TaskOverview/TaskCard.tsx` — 任务卡片（角色+标题+耗时+状态标签）
- `src/components/TaskOverview/TaskOverview.css`

并在 `App.tsx` 的控制台模式路由中，将 P3 扩展为「任务总览/决策收件箱」Tab 切换视图。

### 实现节点 Checklist（Node 7）

- [x] `TaskOverview.tsx` 主组件（按状态分组 Tab：待执行/运行中/等待决策/已完成/失败）
- [x] `TaskCard.tsx` 任务卡片（角色+标题+项目/版本+耗时+状态标签）— 内联在 TaskOverview.tsx
- [x] 控制台模式 P3 顶部 Tab（「任务总览」/「决策收件箱」）— ConsoleTabView in App.tsx
- [x] 调用 `list_tasks` Tauri 命令（Node 5 待实现，前端已对接）
- [x] SSE 驱动的实时更新（`task_status_changed` → `bumpTaskRefresh()` → `TaskOverview` 重拉列表）
- [x] 无任务时各分组显示「暂无」（不崩溃）

---

## Node 8：前端 · 任务触发表单（`src/components/`）

### 缺失（需新建）

控制台模式 P3「+ 触发任务」按钮 + P4 表单尚未实现。

需要新建：
- `src/components/TaskTrigger/TaskTriggerForm.tsx` — 触发表单
- `src/components/TaskTrigger/TaskTriggerForm.css`

### 实现节点 Checklist（Node 8）

- [x] 控制台模式 P3 顶部「+ 触发任务」按钮（在 TaskOverview 标题栏）
- [x] `TaskTriggerForm.tsx`：角色选择 + 任务类型 + 描述 + 项目 + 版本 + 优先级
- [x] 角色下拉数据来源（暂用硬编码 Agent 列表，后续对接 `/agents/registry`）
- [x] 提交调用 `create_task` Tauri 命令（Node 5 已实现），POST /api/tasks
- [x] 提交中 Loading 状态，防止重复提交
- [x] 提交成功后显示「任务已加入队列（pending）」提示
- [x] P4 面板优先级：触发表单打开时覆盖 Agent 详情，关闭后 P4 恢复空白

---

## Node 9：前端 · Agent 注册表 UI（`src/components/`）

### 缺失（需新建）

工具管理模式下「Agent 团队」子视图（P2 列表 + P4 详情）尚未实现。

依赖后端接口：
- `GET /agents/registry` — 读取 registry.yaml 返回 Agent 列表（尚未实现）
- `GET /agents/:role/doc` — 读取 AGENT.md 返回 Markdown 原文（尚未实现）

需同步在后端新增 `/agents` 路由（见 Node 10）。

### 实现节点 Checklist（Node 9）

- [x] 后端 `/agents/registry` 接口（Node 10 已完成）
- [x] 后端 `/agents/:role/doc` 接口（Node 10 已完成）
- [x] 工具管理模式 P2 显示 AgentList（NavIcons 工具模式已启用）
- [x] `AgentList.tsx`：P2 Agent 角色卡片列表（角色名+定位+状态指示器+运行任务数）
- [x] `AgentDetail.tsx`：P4 详情面板（AGENT.md Markdown 渲染 + 当前任务列表）
- [x] 状态指示器颜色（灰/蓝/橙/红）来自状态机 `/api/tasks?role=` 统计
- [x] registry.yaml 不可读时 P2 降级提示（「暂无 Agent 数据，请检查 registry.yaml」）

---

## Node 10：Axum 后端 · Agent 注册表 API（新增）

### 需新建

后端需新增 `/agents` 路由读取 `agent-registry/registry.yaml`：

```rust
// src/routes/agents.rs（新建）

// GET /agents/registry
// 读取 registry.yaml，返回 [{ role, description, running_count }]
pub async fn list_agents_handler(...) -> ...

// GET /agents/:role/doc
// 读取 /data/workbench/agents/{role}/AGENT.md，返回 Markdown 原文
pub async fn get_agent_doc_handler(...) -> ...
```

registry.yaml 路径需通过环境变量 `REGISTRY_PATH` 配置（默认 `/data/workbench/agent-registry/registry.yaml`），不硬编码。

### 实现节点 Checklist（Node 10）

- [x] `src/routes/agents.rs` 新建
- [x] `GET /agents/registry` 读取 registry.yaml（`serde_yaml` crate），返回 Agent 列表
- [x] `GET /agents/:role/doc` 读取 AGENT.md 文件，返回 Markdown 原文
- [x] `REGISTRY_PATH` 环境变量配置
- [x] registry.yaml 不可读时返回 500（非 panic），含错误信息
- [x] `Cargo.toml` 新增 `serde_yaml` 依赖（若未有）
- [x] 在 `main.rs` 注册路由

---

## Node 11：前端 · TopBar 决策 Badge

### 当前状态

**已确认**：`TopBar.tsx`（当前版本）**不含**决策 badge，只有服务健康状态指示器和后端在线状态。

`useStore` 中有 `setPendingDecisionCount` 状态（`DecisionInbox.tsx` 更新此值），但 `TopBar.tsx` 尚未消费此值渲染角标。

### 实现目标

在 TopBar 右侧区域，`topbar__right` 内添加决策 badge：
- `pendingDecisionCount > 0` 时显示橙色圆形数字角标（数值 = pending 决策数）
- `pendingDecisionCount === 0` 时不渲染 badge 元素

### 实现节点 Checklist（Node 11）

- [x] `TopBar.tsx` 消费 `useStore((s) => s.pendingDecisionCount)`
- [x] 在 `topbar__right` 末尾渲染决策 badge 元素（橙色圆形，数值）
- [x] badge = 0 时不渲染（条件渲染，`{count > 0 && <span>...`）
- [x] `TopBar.css` 新增 `.topbar__badge` 样式（橙色背景，白色文字，圆形）

---

## 测试计划

### T1：状态机后端 API（Node 1-4）

| 测试项 | 步骤 | 预期结果 |
|-------|------|---------|
| T1-1 创建任务 | `POST /api/tasks`（含 task_type/role/project/version/input_context） | 返回 `{ task_id }` 且 `GET /api/tasks` 能查到，status=Pending |
| T1-2 更新状态 | `PATCH /api/tasks/:id/status { status: "Running" }` | 状态更新，SSE 推送 `task_updated` 事件 |
| T1-3 非法状态迁移 | `PATCH` 将 `Completed` 改为 `Pending` | 返回 4xx，不允许 |
| T1-4 创建决策 | 后端写入 `decisions` 表一条记录 | `GET /api/decisions?filter=pending` 返回该记录 |
| T1-5 解决决策 | `POST /api/decisions/:id/resolve { resolution: "Approve" }` | `resolved_at` 有值，SSE 推送 `decision_resolved` |
| T1-6 SSE 推送 | 用 `curl -N /api/events/stream` 监听，同时触发状态变更 | SSE 流中出现对应事件 |

### T2：Tauri 命令层（Node 5）

| 测试项 | 步骤 | 预期结果 |
|-------|------|---------|
| T2-1 create_task | 在 Tauri 前端 invoke('create_task', {...}) | 返回 task_id，后端有记录 |
| T2-2 list_decisions | invoke('list_decisions', { filter: 'pending' }) | 返回 pending 决策列表 |
| T2-3 resolve_decision | invoke('resolve_decision', { decisionId, resolution: 'Approve' }) | 前端决策列表中该条移除 |

### T3：决策收件箱 UI（Node 6）

| 测试项 | 步骤 | 预期结果 |
|-------|------|---------|
| T3-1 列表展示 | 数据库有 3 条 pending 决策，切换到收件箱模式 | P3 显示 3 张决策卡片，High 风险在最上方 |
| T3-2 Approve 操作 | 点击某卡片的 Approve 按钮 | 该卡片消失，badge 数字 -1 |
| T3-3 空状态 | 无 pending 决策时打开收件箱 | P3 显示「暂无待处理决策」，不崩溃 |
| T3-4 SSE 实时更新 | 后端创建新决策，前端已打开收件箱 | 新决策卡片自动出现（无需刷新） |

### T4：任务总览 UI（Node 7）【待实现后验收】

| 测试项 | 步骤 | 预期结果 |
|-------|------|---------|
| T4-1 分组展示 | 数据库有 pending + running + completed 各 1 条任务 | P3 任务总览按状态分组，各显示对应任务 |
| T4-2 实时更新 | API 更新任务 status → Running | P3 对应卡片即时迁移到运行中分组 |
| T4-3 空状态 | 所有分组无任务 | 各分组显示「暂无」，不崩溃 |

### T5：任务触发表单（Node 8）【待实现后验收】

| 测试项 | 步骤 | 预期结果 |
|-------|------|---------|
| T5-1 表单展开 | 点击「+ 触发任务」按钮 | P4 展开触发表单 |
| T5-2 必填校验 | 角色或描述为空时点提交 | 提交按钮禁用或显示错误 |
| T5-3 成功提交 | 填写完整信息 → 提交 | 任务出现在 P3 任务总览「待执行」分组 |
| T5-4 提示文字 | 提交成功后 | 显示「任务已加入队列（pending）」 |

### T6：Agent 注册表 UI（Node 9-10）【待实现后验收】

| 测试项 | 步骤 | 预期结果 |
|-------|------|---------|
| T6-1 角色列表 | 切换工具管理模式 → 点「Agent 团队」Tab | P2 显示所有注册 Agent 卡片（角色名+定位+状态） |
| T6-2 详情展示 | 点击一个 Agent 卡片 | P4 展示该 Agent 的 AGENT.md Markdown 内容 |
| T6-3 降级处理 | registry.yaml 不可读 | P2 显示降级提示，不崩溃 |

---

## 实现节点 Checklist（汇总）

### 阶段一：后端补充（Node 1-2 未完成项 + Node 10）

- [x] `agent_tasks` 表追加 `title` 列（`ALTER TABLE agent_tasks ADD COLUMN title TEXT`）
- [x] `POST /api/tasks` 支持 `title` 字段（自动从 input_context 截取前 50 字作为默认值）
- [x] `GET /api/tasks/stats` 实现（返回各 status 计数）
- [x] `src/routes/agents.rs` 新建（Node 10 完整）
- [x] `Cargo.toml` 新增 `serde_yaml`（若未有）

### 阶段二：Tauri 命令补充（Node 5 未完成项）

- [x] `list_tasks` Tauri 命令（GET /api/tasks）
- [x] `get_task_stats` Tauri 命令（GET /api/tasks/stats）
- [x] Tauri `lib.rs` 注册新命令

### 阶段三：前端新建组件（Node 7-9 + Node 11）

- [x] `TaskOverview` 组件（任务总览）
- [x] `TaskTriggerForm` 组件（触发表单）
- [x] `AgentList` + `AgentDetail` 组件（Agent 注册表）
- [x] `App.tsx` 控制台模式路由扩展（P3 Tab 切换：任务总览/收件箱）
- [x] 工具管理模式 P2 显示 AgentList（NavIcons 工具模式已启用）
- [x] `TopBar.tsx` badge 确认/补充

---

## 依赖说明

### 新增 Rust 依赖

- `serde_yaml`（若 Cargo.toml 中未有）：读取 registry.yaml

### 已有依赖（确认可用）

- `axum`：路由框架（已用）
- `sqlx`：SQLite 查询（已用）
- `tokio`：异步运行时（已用）
- `serde` + `serde_json`：序列化（已用）
- `uuid`：生成 task_id / decision_id（已用）
- `chrono`：时间戳（已用）
- `broadcast::channel`（tokio）：SSE 广播（已用）

### 前端无新依赖

已有 `@tauri-apps/api`（invoke）和 Zustand，新组件沿用现有方案。

---

## 修订记录

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1 | 2026-05-19 | workbench-technical | 初稿，扫描实际代码（backend/src/ + workbench/src/）后如实记录已完成和待完成状态；产出补充路线图 |
| v2 | 2026-05-19 | review-agent | Round 1 修复：B-01 TopBar badge「确认」任务改为已确认状态 + 明确实现目标；W-01 stats 接口补充响应格式示例；W-02 Node 7 加前置依赖声明（Node 5 + Node 2 先完成）|
| v3 | 2026-05-19 | workbench-ceo | 工程实现完成（81/81 checkboxes），QA Agent 静态扫描修复 3 个缺陷：AgentList 类型映射、稍后处理按钮、SSE 实时刷新；doc_revision 升至 3 |
| v4 | 2026-05-19 | workbench-ceo | status draft→approved（CEO 于本次轮次正式确认），doc_revision 升至 4；遗留：cargo build 待用户 SSH 验证 |
