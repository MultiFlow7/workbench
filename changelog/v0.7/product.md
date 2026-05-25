---
project: 工作台
version: v0.7
status: approved
doc_revision: 4
created: 2026-05-19
updated: 2026-05-19
author: workbench-product
approved_by: workbench-ceo
approved_at: 2026-05-19
tags:
  - 类型/规划文档
  - 主题/技术/工作台
  - 状态/已批准
---

# product.md · 工作台 v0.7 · Dispatch Layer

---

## A3 路线图定位

> **本版本是 A3 完整实现路线图的第二阶段。**
>
> A3 完整目标：真实多 Agent 并发调度 + 隔离实例 + 完整 UI 套件全部落地。
> 路线图分三阶段：
> - **v0.6（已完成）**：UI + 数据层——Control Room 界面 + Agent 任务状态机，打通数据通道
> - **v0.7（本版本）**：真实调度层——从工作台 UI 触发任务 → 后端调度器调用 Claude API → Agent 实际执行 → 结果写回状态机 → 前端可见；同步纳入上下文构建器、主对话隔离保护、第一条流水线触发规则
> - **v0.8（第三阶段）**：隔离与管控——req-022 Agent 沙盒、req-023 Harness 管控层，完成 A3 完整实现

---

## 版本背景与定位

### v0.6 做了什么

v0.6 完成了「Control Room」的 UI 和数据层：

- **req-013**：Agent 任务状态机后端（SQLite + REST API + WebSocket 推送）
- **req-030**：Agent 注册表 UI（工具管理模式 P2/P4）
- **req-016 精简版**：任务总览（跨项目按状态分组）
- **req-017 精简版**：执行流视图（只读）
- **req-018**：决策收件箱（含 TopBar 角标通知）
- **req-031**：手动触发任务（创建 status=pending 任务记录）

**v0.6 的核心约束**：手动触发的任务停留在 `pending`，没有任何后台 Agent 实际执行。用户能看到状态机和 UI，但背后没有真实 Agent 在工作。

### v0.7 要解决什么

**v0.7 的目标是打通「触发 → 执行 → 可见」的完整闭环**。

当用户在 v0.6 UI 触发一个任务后，现在它会：

1. 后端调度器检测到 `pending` 任务
2. 上下文构建器为该 Agent 角色组装完整的 prompt context
3. 调度器向 Claude API 发起真实调用（独立隔离实例）
4. API 响应写回状态机（status → running → completed/failed）
5. 前端通过现有 WebSocket 通道实时看到状态变化和执行输出

与此同时，v0.7 还解决两个配套问题：
- **主对话保护**（req-020）：后台任务完成不污染主对话流，只通过 TopBar badge 通知
- **第一条流水线规则**（req-019 精简版）：所有任务节点完成 → qa-agent 自动触发测试清单

### 版本边界定义

**本版本做**：
- req-014（完整）：真实多 Agent 调度——后端 tokio 调度器 + 独立 Claude API 调用实例
- req-015（完整）：Agent 上下文构建器——Push-based 上下文注入，包含 role system prompt、任务状态、指定文件列表、触发原因
- req-020（完整）：主对话保护——后台任务结果只推 SSE 通知流，不进入主对话
- req-019（精简为第一条规则）：「所有任务节点 [x] → qa-agent 自动触发测试清单」；完整规则引擎推 v0.8

**本版本不做**：
- req-022 Agent 沙盒 → 推 v0.8
- req-023 Harness 管控层 → 推 v0.8
- req-019 完整规则引擎（可视化配置、自定义规则） → 推 v0.8
- req-024 Agent 级别 LLM 配置 → 继续推迟（v0.6 原规划为「与调度器同期」，但 v0.7 优先保证基础调度闭环，LLM 配置层作为增强功能推 v0.8，届时与完整规则引擎同期实现）
- req-016 Agent 平面打断/重新引导 → 继续推后（超出本版本范围）
- req-021 记忆 Agent → 推 v0.x 后期（无确定版本）

---

## 纳入需求表

| req | 标题 | 优先级 | v0.7 策略 | 调整说明 |
|-----|------|--------|-----------|---------|
| req-014 | 真实多 Agent 调度 | CORE | 完整纳入 | v0.6 已建状态机数据层，v0.7 接通真实执行层 |
| req-015 | Agent 上下文构建器 | CORE | 完整纳入 | req-014 的前置依赖，调度器调用前必须先组装 context |
| req-020 | 主对话保护 | HIGH | 完整纳入 | 真实调度上线后主对话污染风险实际存在，必须同期解决 |
| req-019 | 流水线触发规则 | MEDIUM | 精简为第一条规则 | 仅实现「所有节点 [x] → qa-agent 自动触发」；可视化规则引擎和自定义规则推 v0.8 |

---

## 功能设计

### req-014 · 真实多 Agent 调度

#### 架构定位

调度器运行在后端 Axum 服务中，作为 tokio background task 常驻。不在前端，不依赖用户会话。

```
[任务状态机 SQLite]
        ↓  pending 任务检测（轮询或 trigger hook）
[Dispatch Manager（tokio task）]
        ↓  调用上下文构建器
[Context Builder]
        ↓  组装完整 prompt context
[Claude API 调用（独立 task per agent）]
        ↓  streaming 响应写回
[状态机 PATCH /tasks/:id]
        ↓  WebSocket 推送
[前端 Control Room UI]
```

#### 隔离性保证

- 每次 Agent 调用 = 一个独立的 tokio::task + 一次独立的 Claude API HTTP 请求
- 不同角色、不同任务之间不共享上下文（上下文由构建器从状态机拉取，不由 Agent 对话历史维持）
- 同一 Agent 类型可同时处理多个任务（多租户），互不干扰

#### 并发控制

- 默认最大并发 Agent 数：4（可通过环境变量 `MAX_CONCURRENT_AGENTS` 调整）
- 超出并发上限时，任务在队列中等待（status 保持 `pending`，不报错）
- 每个任务调用超时：10 分钟（`AGENT_TIMEOUT_SECS`，可配置）

#### API key 注入

- API key 通过环境变量 `ANTHROPIC_API_KEY` 注入，不写入数据库，不出现在日志
- 调度器启动时检查 `ANTHROPIC_API_KEY` 是否存在；不存在则调度器不启动，日志报错，前端任务状态保持 `pending`

#### 状态流转

```
pending → running（调度器接取任务，API 调用已发出）
running → completed（API 返回成功，产出写回 output 字段）
running → failed（API 调用失败或超时，错误信息写入 output 字段）
```

Agent 完成产出时，调度器调用：
```
PATCH /tasks/:id { status: "completed", output: "<产出摘要或文件路径>" }
```

#### 验收标准

1. 在 UI 触发一个任务（POST /tasks，status=pending）→ 调度器在 5 秒内接取（status → running）
2. Claude API 实际被调用（可通过 API 账单或日志确认），非 mock 响应
3. 任务完成后 status → completed，`output` 字段有实际内容（非空）
4. 同时触发两个不同角色的任务 → 两个任务并发运行（status 同时为 running）
5. `ANTHROPIC_API_KEY` 未设置时，触发任务 → 调度器不接取（状态保持 pending），后端日志有明确错误

---

### req-015 · Agent 上下文构建器

#### 构建逻辑（Push-based）

上下文构建器在调度器发出 API 调用前执行，将以下内容打包为完整 prompt context：

| 层级 | 内容 | 来源 |
|------|------|------|
| 1. Role System Prompt | 该 Agent 角色的固定行为边界和职责定义 | `agent-registry/registry.yaml` 中对应角色的 `system_prompt` 字段 |
| 2. Task State | 当前任务的结构化状态（task_id、title、input_context、status、blocking_on 等） | 状态机 `agent_tasks` 表 |
| 3. Relevant Documents | 任务定义中明确列出的文件内容（由任务创建时的 `file_refs` 字段指定） | 文件系统读取 |
| 4. Trigger Context | 触发本次调用的原因（用户手动触发 / 前置任务完成 / 流水线规则触发） | 调度器注入 |

**Push 原则**：Agent 看到的就是构建器推送的全部内容。Agent 不主动拉取任何信息，也不依赖历史对话维持状态。这是上下文隔离的结构性保证。

#### 文件引用字段

`agent_tasks` 表新增 `file_refs` 字段（TEXT，JSON 数组，存储文件路径列表）。

**数据库迁移说明**：`file_refs` 为 v0.7 新增字段，需对 v0.6 已有的 `agent_tasks` 表执行以下迁移：
```sql
ALTER TABLE agent_tasks ADD COLUMN file_refs TEXT;
```
迁移后，已有任务记录的 `file_refs` 默认为 NULL（等同于空文件列表，构建器跳过文件注入步骤）。

字段值示例：
```json
["changelog/v0.7/product.md", "requirements/req-014-true-multi-agent-dispatch.md"]
```

上下文构建器按此列表读取文件内容，注入 context。文件不存在时，该条目降级为路径字符串（不报错，但在 context 中标注「文件未找到」）。

#### 隔离约束

| Agent 类型 | 收到的 context 范围 |
|-----------|-----------------|
| review-agent | 仅待审文档内容 + 当前任务状态；不含工程 Agent 的执行日志 |
| 工程 Agent（frontend-ui 等） | 仅本任务的文件列表 + 状态；不含其他并行工程 Agent 的中间状态 |
| qa-agent | 测试清单 + technical.md 已完成节点列表；不含产品规划过程 |
| CEO Agent（事件响应模式） | 所有任务的状态摘要（非详细执行日志） |

#### 验收标准

1. 触发 review-agent 任务，context 中包含 file_refs 指定的文档内容，不包含无关任务的执行日志
2. 同时运行两个 engineering Agent 任务，两个 API 调用的 context 互不包含对方的中间状态（可通过截取 API 调用日志验证）
3. file_refs 列表中包含不存在的文件路径时，构建器不崩溃，API 调用正常发出，context 中标注「文件未找到」
4. 流水线规则 R-001 触发的 qa-agent 任务，其 `file_refs` 指向对应的 `changelog/{version}/technical.md`；构建器读取该文件内容后，qa-agent 的 context 中包含所有 `[x]` 已完成节点的完整文本（技术依据：technical.md 节点进度存储在文件内容中，通过 file_refs 机制注入，不依赖状态机字段）

---

### req-020 · 主对话保护

#### 隔离机制

从主对话视角看，后台任务的执行结果**只**通过以下两个通道到达前端：

1. **状态机持久化**：`PATCH /tasks/:id` 更新 output 字段（可在控制台模式执行流视图主动查看）
2. **SSE 通知流**（新建）：`GET /sse/notifications`，推送轻量级通知事件（全应用常驻，仅用于 TopBar badge 和瞬态提示）

控制台模式内部还使用现有 WebSocket 通道 `/ws/tasks` 实现任务总览和执行流视图的实时更新——这是控制台 UI 内部机制，属于用户**主动进入控制台后**的可见范围，不属于对主对话的自动推送通道。

主对话（P3 对话模式）完全不订阅 `/ws/tasks`；该连接仅在控制台模式 P3 激活时建立。

#### SSE 通知事件格式

```json
{
  "type": "task_completed",
  "task_id": "xxx",
  "role": "workbench-product",
  "title": "v0.7 产品文档初稿",
  "summary": "product.md 已生成，共 8 章节",
  "timestamp": "2026-05-19T10:30:00Z"
}
```

事件类型：
- `task_completed`：任务完成
- `task_failed`：任务失败（含简短失败原因）
- `pipeline_triggered`：流水线规则触发了新任务
- `decision_requested`：新的 awaiting-decision 任务（TopBar badge +1）

#### TopBar badge 行为

TopBar 已有决策角标（req-018，v0.6 已实现）。v0.7 新增：

- 任务完成时，TopBar 右侧显示「✓ 完成」瞬态提示（3 秒后自动消失），不打断当前对话
- 任务失败时，TopBar 显示「✗ 失败」橙色瞬态提示（不自动消失，需用户点击关闭）
- 提示只显示任务名称，不显示输出内容（详情需主动进入控制台查看）

#### CEO Agent 双模式上下文

CEO Agent 在两种上下文下被独立调用，使用不同的 context 包：

| 模式 | 触发方式 | 上下文内容 | 产出写入 |
|------|---------|-----------|---------|
| 主对话模式 | 用户在 P3 发消息 | 用户消息 + 项目状态摘要（任务数量、决策数，不含执行日志） | 主对话消息流 |
| 事件响应模式 | 后台任务完成 / 决策请求 | 任务输出 + 当前状态机快照 | 状态机 + 收件箱 |

两种模式使用同一个 Claude API key，但 context 严格分离，产出不交叉。

#### SSE 与 WebSocket 连接生命周期说明

两个实时通道的连接范围不同：

| 通道 | 连接范围 | 说明 |
|------|---------|------|
| `/sse/notifications` | **全应用常驻**（所有模式均保持连接） | TopBar badge 和瞬态提示在主对话模式也需要实时更新，因此必须常驻 |
| `/ws/tasks` | **仅控制台模式 P3 激活时连接** | 任务总览卡片和执行流视图只在控制台模式渲染，其他模式无需此推送 |

#### 验收标准

1. 后台任务从 running → completed，主对话 P3 的消息列表**不**出现任何新消息
2. 任务完成时，TopBar 出现「✓ 完成」瞬态提示，3 秒后自动消失（主对话模式下同样生效）
3. 用户在主对话问「现在有什么任务在跑？」，CEO Agent 回复（来自主对话模式调用），不自动触发任何后台任务
4. 切换到控制台模式 → `/ws/tasks` 建立连接；切换回对话模式 → `/ws/tasks` 断开连接；`/sse/notifications` 全程保持连接

---

### req-019（精简版）· 第一条流水线规则

#### 纳入的唯一规则

**规则 R-001**：「所有任务节点 [x] → qa-agent 自动触发测试清单」

触发条件：某 `technical.md` 文件中，所有 `- [ ]` checkbox 更新为 `- [x]`（即技术文档进度 = 100%）

触发动作：调度器自动创建一个新任务：
```json
{
  "type": "qa",
  "role": "qa-agent",
  "title": "自动触发：{project} {version} 测试清单执行",
  "input_context": "技术文档 {version}/technical.md 全部节点已完成，请执行测试清单",
  "file_refs": ["changelog/{version}/technical.md"],
  "trigger_reason": "pipeline_rule:R-001"
}
```

#### 检测机制

v0.7 采用轮询方案（每 30 秒执行一次），扫描范围：**所有 `project` 字段非空且 `version` 字段有效的 `agent_tasks` 记录**，根据其 `project` 和 `version` 字段构造对应的 `changelog/{version}/technical.md` 文件路径，检查其中 checkbox 完成进度。若所有 `- [ ]` 均已变为 `- [x]`（进度 = 100%）且尚未触发过 qa-agent 任务，执行规则 R-001。

轮询排除条件（防重复触发）：若已存在一条 `role=qa-agent` 且 `trigger_reason=pipeline_rule:R-001` 且属于同一 `version` 的任务，跳过触发。

v0.8 计划迁移到事件驱动方案（监听 `agent_task_events` 中 `event_type=file-write` 涉及 technical.md 的写入事件），无需持续轮询所有文件。

#### 完整规则引擎（v0.8 展望）

req-019 原始需求中的其余规则（technical.md approved → 启动下一版本产品规划、review-agent 返回 🔴=0 → 进入 CEO 审批队列等）推 v0.8，届时同步实现：
- 规则在 UI 中可视化查看（哪些规则激活中）
- 规则参数可在 UI 中配置（不需要改代码）

#### 验收标准

1. 手动将 technical.md 中所有 `[ ]` 改为 `[x]`（模拟工程 Agent 完成所有节点）→ 30 秒内调度器自动创建一条 qa-agent 任务（status=pending）
2. 该自动创建的任务在控制台任务总览中可见，`trigger_reason` 字段值为 `pipeline_rule:R-001`
3. technical.md 节点未全部完成时，qa-agent 不被自动触发（避免误触发）

---

## 关键数据流

### v0.7 完整调度数据流

```
用户点击「+ 触发任务」→ POST /tasks（status=pending）
        ↓ WebSocket 推送 task_created
前端：任务总览「待执行」分组出现新卡片

─────────────────────────────────────────────────────
Dispatch Manager（tokio background task）检测到 pending 任务
        ↓ 调用 Context Builder
Context Builder 组装 prompt context：
  · role system prompt（来自 registry.yaml）
  · task state（来自状态机）
  · file_refs 文件内容
  · trigger_reason
        ↓ PATCH /tasks/:id { status: "running" }
        ↓ WebSocket 推送 task_updated（running）
前端：卡片状态变为「运行中」，蓝色指示器

─────────────────────────────────────────────────────
Claude API 调用（独立 tokio::task）
        ↓ streaming 响应逐步写入 agent_task_events
        ↓ POST /tasks/:id/events（每个 streaming chunk 追加）
        ↓ WebSocket 推送 event_appended
前端：执行流视图实时出现新事件条目

─────────────────────────────────────────────────────
API 调用结束（成功）
        ↓ PATCH /tasks/:id { status: "completed", output: "..." }
        ↓ WebSocket 推送 task_updated（completed）
        ↓ SSE /sse/notifications 推送 task_completed 事件
前端：任务卡片移入「已完成」分组；TopBar 出现「✓ 完成」3 秒提示
主对话 P3：无任何变化（主对话隔离保护）

─────────────────────────────────────────────────────
（若 technical.md 全部节点完成）
Dispatch Manager R-001 规则检测到 100% 进度
        ↓ POST /tasks（qa-agent 任务，status=pending）
        ↓ SSE 推送 pipeline_triggered 事件
前端：TopBar 出现「流水线触发：qa-agent」瞬态提示；控制台任务总览新增卡片
```

### 上下文隔离验证路径

```
任务 A（review-agent）上下文：
  system_prompt_A + task_state_A + file_refs_A（待审文档）

任务 B（frontend-ui）上下文：
  system_prompt_B + task_state_B + file_refs_B（前端实现文件）

两者 API 调用独立发出，Claude 看到的 context 完全分离
验证：在调度器日志中打印每次 API 调用的 context token 数，
      review-agent 的 context 不包含 frontend-ui 的 file_refs 内容
```

---

## 架构约束（CEO 预裁决，不推翻）

以下架构决策已由 CEO 裁定，技术规划 Agent 直接执行，不重新评估：

| 决策项 | 内容 |
|--------|------|
| 调度器位置 | 后端 Axum 服务中（tokio background task），不在前端 |
| API key 注入 | 环境变量 `ANTHROPIC_API_KEY`，不写数据库，不出现在日志 |
| 上下文推送方式 | Push-based：构建器主动组装并注入，Agent 不主动拉取 |
| 任务结果通道 | 只推送到 SSE 通知流，不进入主对话 |

---

## 数据埋点计划

根据团队章程 6.5 要求，v0.7 新增以下埋点，写入现有 `ui_events` 表（v0.6 已建）：

| 埋点名称 | 触发场景 | payload 字段 |
|---------|---------|-------------|
| `agent_dispatch_triggered` | 调度器接取一个 pending 任务 | `{ task_id, role, queue_wait_seconds }` |
| `agent_dispatch_completed` | 任务 status → completed | `{ task_id, role, duration_seconds, output_tokens }` |
| `agent_dispatch_failed` | 任务 status → failed | `{ task_id, role, error_type, duration_seconds }` |
| `context_build_duration` | 上下文构建器执行耗时 | `{ task_id, role, context_tokens, build_ms }` |
| `pipeline_rule_triggered` | 流水线规则 R-001 触发 | `{ rule_id: "R-001", source_task_id, target_role: "qa-agent" }` |
| `main_conversation_protected` | 后台任务完成，主对话未收到消息（验证隔离有效） | `{ task_id, main_chat_message_count_unchanged: true }` |

### 关键指标（product 关注）

- **调度延迟**：`queue_wait_seconds` 均值（任务从 pending 到 running 的时间，目标 < 5 秒）
- **任务成功率**：completed / (completed + failed)（反映 Claude API 调用稳定性）
- **上下文构建耗时**：`build_ms` 均值（反映构建器性能，目标 < 500ms）
- **流水线自动触发率**：`pipeline_rule_triggered` 次数 / 手动触发次数（反映自动化程度）

---

## 董事长验收标准

> 以下四条为本版本发布的必要条件，全部满足才可进入 v0.8 规划。

### AC-1：触发 → 执行 → 可见闭环

从工作台 UI 触发一个任务，无需打开终端：
- 任务卡片状态依次经过：`待执行（Pending）` → `运行中（Running）` → `已完成（Completed）`
- 任务完成后，执行流视图中至少有一条 `event_type=output` 的事件条目，`content` 字段非空（来自真实 Claude API 响应，非 mock 数据）

### AC-2：两个并发任务上下文互不干扰

同时触发两个不同 Agent 角色的任务（例如 review-agent + frontend-ui）：
- 两个任务同时处于 `Running` 状态
- 可通过调度器日志验证：两个 API 调用的 context 中，review-agent 不包含 frontend-ui 的文件内容，frontend-ui 不包含 review-agent 的待审文档

### AC-3：主对话不被后台任务污染

一个后台任务从 Running → Completed 的过程中：
- 主对话 P3 的消息列表不出现任何自动生成的消息
- 仅 TopBar 出现「✓ 完成」瞬态提示（3 秒后消失）

### AC-4：第一条流水线规则生效

将某版本 technical.md 的所有 `[ ]` 节点标记为 `[x]`：
- 30 秒内，控制台任务总览自动出现一条新的 qa-agent 任务（status=pending）
- 该任务的 `trigger_reason` 值为 `pipeline_rule:R-001`，不需要用户手动触发

---

## 版本一致性说明

### 与产品方向的一致性

- **「AI 服务于我 + 我管理 AI」**：v0.7 是两者的交汇点——AI 真正开始执行任务（AI 服务于我），同时用户通过控制台全程可见（我管理 AI）
- **「后端逻辑 AI first」**：调度器和上下文构建器是纯后端逻辑，完全自动，符合 AI first 定位
- **「前端逻辑 Human first」**：主对话保护确保用户注意力不被后台任务打断，TopBar badge 是人友好的非侵入通知
- **「降低人管理 AI 团队的认知负担，保留人的控制权」**：任务自动执行降低负担；决策收件箱（v0.6）保留控制权；两者在 v0.7 首次完整协同

### 与 v0.6 的继承关系

v0.7 不改动 v0.6 已交付的任何功能：
- req-013 状态机（SQLite + API + WebSocket）：v0.7 在此之上新增调度器，不修改状态机接口
- req-030 Agent 注册表 UI：不变
- req-016/017 任务总览/执行流视图：v0.7 执行的任务自动出现在这两个视图中（复用 v0.6 UI）
- req-018 决策收件箱：不变（awaiting-decision 任务继续走收件箱流程）
- req-031 手动触发：继续使用，v0.7 的调度器会自动接取通过 req-031 创建的 pending 任务

### 与 v0.8 的边界

v0.7 **不**引入以下能力，留给 v0.8：
- Agent 沙盒（req-022）：v0.7 的 Agent 调用共享同一 Axum 进程，不做进程隔离
- Harness 管控层（req-023）：v0.7 不实现 Agent 调用的拦截/审计/限流中间件
- 完整流水线规则引擎（req-019）：仅硬编码 R-001，不做规则 UI 和自定义配置

---

## 修订记录

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1 | 2026-05-19 | workbench-product | 初稿，基于 CEO 裁决指令起草 v0.7 Dispatch Layer product.md |
| v2 | 2026-05-19 | review-agent | Round 1 修复：B-01 补充 `file_refs` 字段的 ALTER TABLE 迁移说明（明确对 v0.6 已有表执行 DDL 变更）；B-02 厘清 SSE/WebSocket 连接生命周期（`/sse/notifications` 全应用常驻，`/ws/tasks` 仅控制台模式）；W-01 轮询检测机制明确扫描范围（仅 project/version 有效的任务）和防重触发条件；W-02 在「本版本不做」列表补充 req-024 继续推迟及原因说明；W-03 AC-1 验收标准明确「实际输出」定义为至少一条 event_type=output 且 content 非空；W-04 frontmatter 补充 tags 字段 |
| v3 | 2026-05-19 | review-agent | Round 2 修复：W-01 req-015 验收标准第 4 条补充「技术依据」说明（technical.md 节点进度通过 file_refs 读取文件内容注入，不依赖状态机字段）；W-02 req-020 隔离机制措辞修正（明确 /ws/tasks 属于控制台 UI 内部机制，不是主对话推送通道，消除与 SSE 双通道说明的歧义）|
