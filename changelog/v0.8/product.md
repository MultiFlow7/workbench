---
project: 工作台
version: v0.8
status: approved
doc_revision: 2
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

# product.md · 工作台 v0.8 · Isolation & Control

---

## A3 路线图定位

> **本版本是 A3 完整实现路线图的第三阶段，也是 A3 的收官版本。**
>
> A3 完整目标：真实多 Agent 并发调度 + 隔离实例 + 完整 UI 套件全部落地。
> 路线图分三阶段：
> - **v0.6（已完成）**：UI + 数据层——Control Room 界面 + Agent 任务状态机，打通数据通道
> - **v0.7（已完成）**：真实调度层——从工作台 UI 触发任务 → 后端调度器调用 Claude API → Agent 实际执行 → 结果写回状态机 → 前端可见；同步纳入上下文构建器、主对话隔离保护、第一条流水线触发规则
> - **v0.8（本版本）**：隔离与管控——req-022 Agent 沙盒、req-023 Harness 管控层，完成 A3 完整实现

---

## 版本背景与定位

### v0.7 做了什么

v0.7 完成了「触发 → 执行 → 可见」的完整调度闭环：

- **req-014**：真实多 Agent 调度——后端 tokio 调度器 + 独立 Claude API 调用实例，每个 Agent 任务对应独立 tokio::task
- **req-015**：Agent 上下文构建器——Push-based 上下文注入（role system prompt + 任务状态 + file_refs 文件内容 + 触发原因）
- **req-020**：主对话保护——后台任务结果只推 SSE 通知流，不进入主对话；TopBar 瞬态 badge 提示
- **req-019（精简）**：第一条流水线规则 R-001——所有节点完成 → qa-agent 自动触发

**v0.7 的核心约束**：Agent 在逻辑层面已经隔离（通过 Push-based 上下文注入保证每次 API 调用的 context 独立），但缺少以下管控能力：

1. **无沙盒边界**：Agent 仍可理论上通过工具调用访问未授权文件或触发未受控的副作用；上下文隔离依赖构建器约定，没有结构性强制
2. **无 Hook 拦截**：任务状态变更直接写入状态机，没有前置条件门控（pre-hook）和副作用触发机制（post-hook）
3. **无能力式权限**：决策收件箱 Approve 操作不会自动颁发结构化令牌；下游任务的触发条件靠人工判断，不靠机器可检查的令牌状态
4. **前端缺口**：主对话保护后端已在 v0.7.2 修复（`SseNotification::DecisionRequested` 已通过 notify_tx 发送），但 TopBar 通知 badge 的前端验收尚未通过（req-020 标记为 in-progress）

### v0.8 要解决什么

**v0.8 的目标是为已运行的 Agent 团队加装「围栏 + 管控层」**。

不改变 v0.7 已经运行的调度闭环，而是在其之上叠加两层保证：

1. **沙盒**（req-022）：每个 Agent 的读写权限在结构上受限，不再依赖构建器约定——Agent 看不到不该看的，写不到不该写的
2. **Harness 管控层**（req-023）：任务状态变更经过 Hook 网关（前置门控 + 副作用触发 + 失败处理）；工作流按确定性 DAG 推进；Approve 决策自动颁发可机器检查的令牌

同时，v0.8 收尾 v0.7 遗留的前端验收缺口（req-020 TopBar badge）。

---

## 版本范围

### 纳入需求总览

| req | 标题 | 优先级 | v0.8 策略 | 说明 |
|-----|------|--------|-----------|------|
| req-020 | 主对话保护前端（TopBar 通知 badge 验收） | HIGH | 完整验收 | v0.7 后端已打通，v0.8 补齐前端验收缺口 |
| req-022 | Agent 沙盒（隔离执行环境） | HIGH | 完整纳入 | 结构性沙盒边界，方案待董事长裁定（见下节） |
| req-023 | Harness 管控层（hooks + 工作流 + 权限管理） | HIGH | 完整纳入 | Hook 网关三层完整实现 + DAG 工作流 + 能力式令牌 |

---

### req-020（收尾）· 主对话保护前端验收

#### 背景

v0.7.2 已修复后端 `SseNotification::DecisionRequested` 通过 `notify_tx` 发送的问题。前端 TopBar 通知 badge 验收尚未通过，列为 in-progress 遗留项。

#### v0.8 需完成的工作

1. **TopBar badge 计数逻辑联通**：`decision_requested` 事件到达前端 SSE 流后，TopBar badge 计数 +1；用户进入决策收件箱查看后，计数归零
2. **Task 状态瞬态提示**：`task_completed` / `task_failed` 事件触发 TopBar 右侧瞬态提示（已在 v0.7 设计，v0.8 完成验收）
3. **端到端验收测试**：从后端触发 `SseNotification::DecisionRequested` → 前端 badge 数字变化，全程无需刷新页面

#### 验收标准

1. 新的 `awaiting-decision` 任务创建后，TopBar badge 在 3 秒内显示 +1（无需刷新）
2. 进入决策收件箱点击「查看」后，badge 计数归零
3. 后台任务 `running → completed`，主对话消息列表不新增任何消息；TopBar 出现「✓ 完成」瞬态提示，3 秒后消失（后端隔离逻辑已在 v0.7 验证，v0.8 本条仅做端到端回归确认）

---

### req-022 · Agent 沙盒（隔离执行环境）

#### 沙盒边界定义

每个 Agent 实例的权限边界如下：

| 维度 | 可访问 | 不可访问 |
|------|--------|---------|
| **读** | 当前任务状态描述 + `file_refs` 指定文档 + 自身 role system prompt | 其他 Agent 的对话历史 + 内部决策过程 + 未在 `file_refs` 中列出的文件 |
| **写** | 任务产出物（经输出槽写入 `output` 字段）+ 状态更新请求（经 hook 验证后写入） | 直接操作状态机（绕过 hook）+ 其他 Agent 的输入槽 |

> 用户原话：「每个 Agent 应该有自己的独立沙盒管控，沙盒内的 Agent 是无状态的」

#### 无状态性保证

- Agent 每次调用 = 一次无状态 API 调用（v0.7 已实现）
- v0.8 强化：Agent 的工具调用（如文件读取、状态更新）必须经过沙盒层过滤；工具调用结果由沙盒层代理返回，不由 Agent 直接执行
- 沙盒层在 Context Builder 之后、Claude API 调用之前生效；Agent 发出的任何写操作请求在回程经过沙盒层验证

#### 具体实施（见下节 [需董事长决策]）

沙盒的 OS 级实现方案有三个选项（方案 A/B/C），实施细节取决于董事长裁定结果。无论选择哪个方案，以下逻辑层约束在 v0.8 均须实现：

- 文件读取请求：对照 `file_refs` 白名单过滤，白名单外路径返回「无访问权限」错误
- 状态写入请求：必须经过 Harness Hook 网关的 pre-hook 验证（见 req-023）
- 跨 Agent 干扰检测：调度器记录每个 Agent 实例尝试访问的资源，超出白名单的尝试写入审计日志

#### 验收标准

1. Agent A 的 `file_refs` 不包含文件 X，Agent A 请求读取文件 X → 沙盒层返回拒绝，Claude API 的 context 不含文件 X 内容，审计日志记录一条越界尝试
2. Agent A 尝试直接调用 `PATCH /tasks/:id`（绕过 hook）→ 请求被沙盒层拦截，状态机不变更，日志记录拦截事件
3. 同时运行 Agent A 和 Agent B，Agent A 无法向 Agent B 的输入槽写入任何内容（API 调用层面验证）
4. Agent 调用结束后，沙盒实例销毁，不保留任何跨调用的持久化上下文（无状态性）

---

### req-023 · Harness 管控层

#### 三子系统概述

```
[任务状态机]
      ↓ 状态变更请求
[Harness Hook 网关]
  pre-hook: 前置条件门控（令牌检查 + 依赖检查）
  post-hook: 副作用触发（令牌颁发 + 下游任务触发 + 通知）
  error-hook: 失败处理（重试策略 + 人工介入请求）
      ↓ 通过后写入
[状态机 + 能力令牌表]
      ↓ DAG 推进
[工作流调度（确定性 DAG）]
```

#### 子系统 1：Hook 网关

**pre-hook（前置条件门控）**

每次状态变更（如 `pending → running`、`running → completed`、`awaiting-decision → approved`）在执行前经过 pre-hook 检查：

| 状态变更 | pre-hook 检查项 |
|---------|----------------|
| `pending → running` | 依赖任务是否已完成（`blocking_on` 字段）；并发配额是否可用 |
| `running → completed` | 产出物是否非空（`output` 字段有实际内容）|
| `awaiting-decision → approved` | 当前用户是否有审批权限（CEO Agent 或董事长）|
| `document → deliverable` | 对应 review-agent 任务是否已完成且无 🔴 问题 |

v0.7 已有 `check_pre_hook()` 雏形（检查 `TokenType::Approved`）。v0.8 将其扩展为完整前置门控体系。

**post-hook（副作用触发）**

状态变更成功后自动触发：

| 触发条件 | 副作用 |
|---------|--------|
| 任务 `→ completed` | SSE 推送 `task_completed`；流水线规则检查（R-001 等） |
| 决策 `→ approved`（CEO Approve） | 自动颁发 `APPROVED` 令牌到 `capability_tokens` 表 |
| review-agent `→ completed`（无 🔴）| 自动颁发 `DELIVERABLE` 令牌 |
| qa-agent `→ completed`（测试通过）| 自动颁发 `MERGEABLE` 令牌 |
| 任务 `→ failed` | 触发 error-hook（见下） |

**error-hook（失败处理）**

| 失败类型 | 处理策略 |
|---------|---------|
| API 调用超时（< 3 次） | 自动重试，间隔 exponential backoff（30s / 60s / 120s） |
| API 调用超时（≥ 3 次）| 状态 → `failed`；SSE 推送 `task_failed`；创建 `awaiting-decision` 任务请求人工介入 |
| pre-hook 检查未通过 | 状态不变更；日志记录阻断原因；SSE 推送拒绝原因（不创建新任务） |
| Agent 产出为空 | 状态 → `failed`；error-hook 触发人工介入请求 |

#### 子系统 2：工作流 DAG（确定性代码实现）

**设计原则**：不引入独立工作流引擎（Temporal / Airflow）。用确定性 Rust 代码 + frontmatter `status` 字段实现 DAG 推进。

DAG 节点 = 一个 `agent_task` 记录；DAG 边 = `blocking_on` 字段（JSON 数组，存储前置任务 ID）。

**DAG 推进逻辑**：

```
每次 post-hook 执行后：
  1. 检查当前完成任务的下游节点（blocking_on 中包含当前任务 ID 的所有任务）
  2. 对每个下游节点，检查其 blocking_on 列表中所有依赖是否已全部 completed
  3. 若全部完成 → 将下游节点 status 从 pending 变为「可调度」（调度器下一轮接取）
  4. 若未全部完成 → 下游节点保持 pending，等待下一次 post-hook 触发检查
```

v0.7 的流水线规则 R-001 是 DAG 的一个特例（单节点触发）；v0.8 将其泛化为通用 DAG 推进机制。

**v0.8 预置工作流**（硬编码，非可视化配置）：

| 工作流 ID | 描述 | 触发条件 | 节点序列 |
|-----------|------|---------|---------|
| `WF-001` | 文档审查 → CEO 决策 → 实现 | review-agent 完成且无 🔴 | review-agent → awaiting-decision → engineering-agent |
| `WF-002` | 实现 → QA → 合并 | 所有 technical.md 节点完成 | engineering-agent → qa-agent → awaiting-merge |

#### 子系统 3：能力式权限（令牌机制）

**令牌类型**：

| 令牌类型 | 颁发条件 | 用途 |
|---------|---------|------|
| `DELIVERABLE` | review-agent 完成且 🔴=0 | 解锁 CEO 审批队列（文档可进入决策收件箱） |
| `APPROVED` | CEO Agent 执行 Approve 操作 | 解锁下游工程 Agent 启动（pre-hook 检查） |
| `MERGEABLE` | qa-agent 完成且测试通过 | 解锁合并操作（pre-hook 检查） |

**`capability_tokens` 表**（v0.7 已存在，v0.8 完善）：

```sql
-- 现有表结构（v0.7）：
-- id, project, version, token_type, granted_by, granted_at, revoked_at

-- v0.8 新增字段（均允许 NULL，向后兼容 v0.7 已有记录）：
ALTER TABLE capability_tokens ADD COLUMN task_id TEXT;   -- 关联触发颁发的任务；NULL = 非任务触发颁发（v0.7 旧记录）
ALTER TABLE capability_tokens ADD COLUMN expires_at TEXT; -- 可选过期时间；NULL = 永不过期
-- 迁移执行时机：应用启动时 create_tables() 中自动执行（同 v0.7 file_refs 迁移方式）
```

**UI 管理界面（v0.8 新增）**：

能力令牌需要 CEO 可视化管理，方案为在 Agent 注册表 UI 中新增「令牌管理」标签页：

- 列表展示当前项目各版本的令牌状态（颁发时间、颁发来源、是否有效）
- CEO 可手动颁发令牌（绕过自动触发条件，用于特殊情况）
- CEO 可撤销令牌（`revoked_at` 字段写入撤销时间）
- 令牌撤销后，依赖该令牌的 pre-hook 检查自动失败（不影响已完成的下游任务）

#### 验收标准

1. CEO Agent 在决策收件箱执行 Approve → `capability_tokens` 表自动插入一条 `APPROVED` 令牌记录（无需手动操作）
2. 工程 Agent 任务的 pre-hook 检查 `APPROVED` 令牌：令牌存在 → 任务 `pending → running`；令牌不存在 → 任务保持 `pending`，日志记录阻断原因；前端 SSE 流收到携带 `block_reason` 的拒绝事件（对应 `pre_hook_blocked` 埋点）
3. review-agent 产出无 🔴 → `DELIVERABLE` 令牌自动颁发；进入 CEO 决策收件箱后显示该令牌状态
4. 令牌管理 UI：列表正确展示当前项目的令牌；CEO 手动撤销一条令牌后，依赖该令牌的任务 pre-hook 在下次检查时返回「令牌已撤销」拒绝结果
5. error-hook：触发 3 次超时后，状态机中出现一条新的 `awaiting-decision` 任务（类型为「人工介入请求」）

---

## [需董事长决策] · 沙盒实现方案

> 本节标注 [需董事长决策]。沙盒隔离属于架构级决策，涉及外部依赖引入和运营成本，CEO 无权单独裁定，需董事长确认后技术规划 Agent 方可执行。

### 三方案对比

| 维度 | 方案 A · Docker 容器隔离 | 方案 B · Landlock + seccomp（Linux 内核级） | 方案 C · 逻辑隔离（上下文层，不做 OS 级） |
|------|--------------------------|---------------------------------------------|------------------------------------------|
| **隔离强度** | 最强（进程 + 文件系统 + 网络完全隔离） | 强（文件系统路径级 + syscall 白名单） | 中（依赖沙盒层代码约束，无 OS 强制） |
| **外部依赖** | 需要 Docker Engine 常驻 | 无新外部服务（Linux 内核原生） | 无 |
| **与现有栈兼容性** | 需要在 Axum 服务中管理容器生命周期，引入 Docker SDK | 与 Rust/Tokio 原生兼容（`landlock` crate） | 完全兼容（纯 Rust 代码） |
| **开发环境适用性** | macOS/Linux 均可（Docker Desktop 支持 macOS） | 仅 Linux（服务器适用，本地 macOS 开发需跳过） | 全平台 |
| **运营成本** | 高（容器启动延迟 + 镜像维护 + 资源占用） | 低（内核级，无额外服务） | 最低 |
| **实施复杂度** | 高 | 中（需为每个 Agent 配置 landlock 规则集） | 低 |
| **v0.8 可交付性** | 可交付，但引入较大范围外部依赖 | 可交付 | 可交付，且成本最低 |

### CEO 倾向性

CEO 倾向 **方案 C → B 渐进路线**：

1. v0.8 先实现方案 C（逻辑隔离），强化沙盒层代码约束，确保逻辑层面无越界
2. v0.8.x 增量引入方案 B（Landlock），在 Linux 服务器上叠加内核级文件系统路径保护；macOS 本地开发环境跳过 Landlock，测试沙盒逻辑层
3. 方案 A（Docker）作为备选，仅在业务对隔离级别有极高要求时评估

**理由**：方案 C 解决了当前最紧迫的问题（无结构性约束），且成本最低；方案 B 在 v0.8.x 增量引入可以做到最小化风险；方案 A 的运营成本在当前阶段不值得承担。

### 请董事长裁定

> 以下三个选项，请董事长选择一项：
>
> **选项 1**：批准 CEO 倾向方向——v0.8 方案 C，v0.8.x 增量方案 B，不引入 Docker
>
> **选项 2**：直接上 Landlock（方案 B）——v0.8 一步到位实现内核级隔离（服务器），本地开发通过 feature flag 跳过
>
> **选项 3**：维持方案 C 作为长期策略——逻辑隔离足够，不做 OS 级物理隔离（节省工程成本，接受隔离强度较低的风险）

技术规划 Agent 在收到裁定结果后，在 `technical.md` 中对应调整实现节点。

---

## 技术边界说明

### v0.8 做

| 功能 | 归属 req | 说明 |
|------|---------|------|
| 沙盒逻辑层（方案 C，白名单过滤 + 审计日志） | req-022 | 无论董事长选哪个选项，逻辑层沙盒均在 v0.8 实现 |
| Hook 网关三层完整实现（pre/post/error） | req-023 | v0.7 只有 pre-hook 雏形，v0.8 完整覆盖 |
| 工作流 DAG 确定性推进（硬编码 WF-001/WF-002） | req-023 | 不引入外部引擎，Rust 代码实现 |
| 能力式令牌 UI（Agent 注册表「令牌管理」标签页） | req-023 | `capability_tokens` 表已有，补齐 UI 管理界面 |
| 决策 Approve → 自动颁发 APPROVED 令牌 | req-023 | 打通决策收件箱与 Harness 的集成 |
| TopBar 通知 badge 前端验收（req-020 遗留）| req-020 | 后端已打通，补齐前端 |
| `capability_tokens` 表迁移（新增 task_id / expires_at 字段）| req-023 | DDL 变更，迁移脚本需向后兼容 |

### v0.8 不做（推后）

| 功能 | 推后原因 |
|------|---------|
| Landlock + seccomp OS 级隔离（方案 B） | 视董事长裁定，可能为 v0.8.x 增量；仅限 Linux，本地开发 macOS 需额外 feature flag 处理 |
| Docker 容器隔离（方案 A） | 运营成本过高，当前阶段不值得引入 |
| req-019 完整规则引擎（可视化配置） | v0.7 精简版（R-001 硬编码）已满足当前需求；可视化配置推 v0.9 |
| req-024 Agent 级别 LLM 配置 | 无确定排期，推 v0.x 后期；与 Harness 管控层不强依赖 |
| req-016 Agent 平面打断/重新引导 | 超出本版本范围 |
| req-021 记忆 Agent | 推 v0.x 后期，无确定版本 |

---

## 用户交互变化

### 新增 UI：令牌管理标签页

**位置**：控制台模式 → Agent 注册表 → 新增「令牌管理」标签页

**交互设计**：

```
[Agent 注册表]
  ├── [注册 Agent] （已有）
  └── [令牌管理]（新增）
        ├── 过滤：项目 / 版本 / 令牌类型
        ├── 列表：令牌类型 | 颁发来源 | 颁发时间 | 状态（有效/已撤销）
        ├── [手动颁发] 按钮（CEO 权限，选择类型 + 项目 + 版本）
        └── [撤销] 按钮（逐条，撤销后不可恢复）
```

**注意事项**：令牌管理为 CEO 专属操作，UI 上应有明显的权限提示；撤销操作需弹窗二次确认（撤销不可逆，但不影响已完成任务）。

### 变化的 UI：决策收件箱

**新增信息**：收件箱中每条 `awaiting-decision` 任务，在详情面板新增「令牌状态」区域：

- 显示当前任务关联文档的 `DELIVERABLE` 令牌是否存在（是 review-agent 通过的前提）
- Approve 操作完成后，实时显示 `APPROVED` 令牌已自动颁发（无需刷新）

**行为变化**：点击「Approve」后，后端同步颁发 `APPROVED` 令牌（通过 post-hook）；前端收到 SSE 更新，令牌状态标记变为「已颁发」。

### 变化的 UI：TopBar 通知 badge（req-020 收尾）

- 角标数字与后端 `awaiting-decision` 任务数量实时同步（SSE 驱动，无需刷新）
- 角标进入收件箱后归零（点击行为 → 标记为已查看 → badge 计数更新）

### 无变化的 UI

以下 v0.7 已有 UI 在 v0.8 不改动：
- 任务总览（req-016）
- 执行流视图（req-017）
- 手动触发任务（req-031）
- Agent 注册表主列表（req-030）

---

## 数据埋点计划

> 本章节为章程第 6.5 条强制要求，不可缺失。

根据团队章程 6.5 要求，v0.8 新增以下埋点，写入现有 `ui_events` 表（v0.6 已建）：

### Hook 网关埋点

| 埋点名称 | 触发场景 | payload 字段 |
|---------|---------|-------------|
| `pre_hook_passed` | 状态变更通过 pre-hook 检查 | `{ task_id, from_status, to_status, check_duration_ms }` |
| `pre_hook_blocked` | 状态变更被 pre-hook 阻断 | `{ task_id, from_status, to_status, block_reason, missing_token_type }` |
| `post_hook_executed` | post-hook 成功执行副作用 | `{ task_id, hook_type, side_effect_type, duration_ms }` |
| `error_hook_triggered` | error-hook 被触发 | `{ task_id, error_type, retry_count, action_taken }` |
| `error_hook_escalated` | error-hook 触发人工介入请求（≥ 3 次失败） | `{ task_id, final_error, decision_task_id }` |

### 沙盒越界埋点

| 埋点名称 | 触发场景 | payload 字段 |
|---------|---------|-------------|
| `sandbox_access_denied` | Agent 请求读取白名单外文件被拒绝 | `{ task_id, role, requested_path, allowed_paths_count }` |
| `sandbox_write_intercepted` | Agent 尝试绕过 hook 直接写入状态机被拦截 | `{ task_id, role, attempted_operation }` |

### 令牌操作埋点

| 埋点名称 | 触发场景 | payload 字段 |
|---------|---------|-------------|
| `token_granted_auto` | post-hook 自动颁发令牌 | `{ token_type, project, version, trigger_task_id }` |
| `token_granted_manual` | CEO 手动颁发令牌 | `{ token_type, project, version, granted_by: "ceo-manual" }` |
| `token_revoked` | CEO 撤销令牌 | `{ token_type, project, version, revoked_by, token_age_hours }` |

### 工作流 DAG 埋点

| 埋点名称 | 触发场景 | payload 字段 |
|---------|---------|-------------|
| `workflow_node_advanced` | DAG 推进——下游节点解锁（blocking_on 全部满足） | `{ workflow_id, completed_task_id, unlocked_task_id, dag_depth }` |
| `workflow_blocked` | DAG 推进受阻——下游节点有未完成依赖 | `{ workflow_id, completed_task_id, blocked_task_id, pending_deps_count }` |

### 关键指标（product 关注）

- **Hook 通过率**：`pre_hook_passed` / (`pre_hook_passed` + `pre_hook_blocked`)——反映工作流设计合理性（阻断率过高说明依赖配置有问题）
- **沙盒越界频率**：`sandbox_access_denied` 次数——v0.8 初期预期为 0（无合法越界），出现则为 Agent system prompt 配置问题
- **令牌自动颁发率**：`token_granted_auto` / (`token_granted_auto` + `token_granted_manual`)——反映 Harness 自动化程度（目标 > 90%）
- **人工介入率**：`error_hook_escalated` 次数 / 总任务数——反映 Agent 稳定性（目标 < 5%）
- **DAG 推进成功率**：`workflow_node_advanced` / (`workflow_node_advanced` + `workflow_blocked`)——反映工作流 DAG 配置的完整性

---

## 与其他需求的关系

### req-021（记忆 Agent）继续 backlog 的原因

记忆 Agent 需要一个稳定的沙盒环境作为前置——Agent 的读写边界未确定之前，记忆 Agent 的访问权限设计无从落地。v0.8 完成沙盒和 Harness 后，req-021 具备了实现条件，但鉴于其实施复杂度（需要持久化 Agent 跨任务记忆、解决记忆一致性问题），继续保留在 backlog，无确定版本排期。

### req-024（Agent 级别 LLM 配置）继续推迟的原因

req-024 允许为不同 Agent 角色配置不同的 LLM 模型和参数（temperature、max_tokens 等）。当前 v0.7/v0.8 阶段，所有 Agent 共用同一套 Claude API 配置（`ANTHROPIC_API_KEY` + 默认参数），功能完整性不受影响。req-024 是增强功能，不影响核心调度闭环，推 v0.x 后期（与完整规则引擎可视化配置一并评估）。

### req-019 完整规则引擎推 v0.9 的原因

v0.7 精简版（R-001 硬编码）已覆盖最常用场景。v0.8 通过 Harness DAG 机制泛化了流水线推进逻辑（WF-001/WF-002 硬编码），但可视化规则配置（在 UI 中拖拽配置规则触发条件和动作）工程量较大，且当前阶段规则集相对固定，不值得投入。推 v0.9，届时与「工作流 UI」一并规划。

---

## 长期一致性说明

### 与产品方向的一致性

- **「AI 服务于我 + 我管理 AI」**：v0.8 的 Harness 管控层正是「我管理 AI」的核心基础设施——Hook 网关、令牌机制、DAG 工作流，让人对 Agent 团队的管理从「依赖约定」升级为「结构性保证」
- **「后端逻辑 AI first」**：沙盒和 Harness 均为纯后端逻辑，完全自动运行；CEO 人工干预（令牌撤销、手动颁发）是例外路径，不是常规路径
- **「前端逻辑 Human first」**：令牌管理 UI 和决策收件箱的令牌状态展示，让人对 Harness 状态可见、可干预，保留人的控制权
- **「降低人管理 AI 团队的认知负担，保留人的控制权」**：Hook 网关的自动化（post-hook 自动颁发令牌、DAG 自动推进）降低认知负担；CEO 令牌 UI 和决策收件箱保留控制权——两者在 v0.8 首次作为完整体系协同运行

### 与架构原则的一致性

- **「Panel 之间只通过选中状态事件通信」**：令牌管理 UI 作为 Agent 注册表的新标签页，不破坏面板通信约定
- **「不想堵死」**：Harness DAG 以硬编码实现，但 DAG 节点的数据结构（`blocking_on` JSON 数组）是可扩展的——v0.9 可以在同一数据结构上叠加可视化配置，无需数据迁移

### 与 v0.7 的继承关系

v0.8 不改动 v0.7 已交付的任何功能：
- req-014 调度器 + req-015 上下文构建器：v0.8 在其之上加装 Hook 网关，不改变调度逻辑本身
- req-013 状态机（SQLite + REST API + WebSocket）：状态机接口不变，Hook 网关作为状态变更的中间件层插入（不修改 API 接口）
- req-019 R-001 流水线规则：v0.8 DAG 机制是 R-001 的泛化；R-001 的触发逻辑被 WF-002 的 DAG 推进机制所包含，以 `workflow_id=WF-002` 的方式继续生效，不废弃

### 与 v0.9 的边界

v0.8 **不**引入以下能力，留给 v0.9：
- 规则引擎可视化配置 UI（req-019 完整版）
- Landlock 内核级沙盒（方案 B，视董事长裁定可能提前到 v0.8.x）
- req-021 记忆 Agent
- req-024 Agent 级别 LLM 配置

---

## 修订记录

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1 | 2026-05-20 | workbench-product | 初稿，基于 CEO 裁决指令起草 v0.8 Isolation & Control product.md |
| v2 | 2026-05-20 | workbench-ceo（review 修订） | 修复 review-agent 五条 🟡：补 updated 字段、req-020 AC-3 括注、R-001→WF-002 映射措辞、req-023 AC-2 补 SSE 拒绝事件验收、capability_tokens DDL 兼容性说明 |
