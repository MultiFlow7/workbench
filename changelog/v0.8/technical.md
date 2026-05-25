---
project: 工作台
version: v0.8
status: approved
doc_revision: 3
created: 2026-05-20
updated: 2026-05-20
author: technical-planning-agent
approved_by: workbench-ceo
approved_at: 2026-05-20
tags:
  - 类型/规划文档
  - 主题/技术/工作台
  - 状态/已批准
---

# technical.md · 工作台 v0.8 · Isolation & Control

---

## 背景说明（v0.7 已有 + v0.8 新增）

### v0.7 已交付的代码资产（直接可用）

| 模块 | 文件路径 | 可用内容 |
|------|---------|---------|
| 调度器 | `src/dispatcher/mod.rs` | `run_auto_dispatcher()`、`DispatcherConfig`、`check_pre_hook()` 雏形、R-001 规则 |
| 决策处理器 | `src/decisions/handlers.rs` | `create_decision()`、v0.7.2 已修复 `notify_tx` 发送 `SseNotification::DecisionRequested` |
| SSE 通知端点 | `src/routes/notifications.rs` | `GET /sse/notifications` 端点，全应用常驻 |
| SSE 事件枚举 | `src/events/sse.rs` | `SseNotification` enum（含 `DecisionRequested` variant，已修复）|
| 数据库 | `src/db.rs` | `capability_tokens` 表已存在（字段：id, project, version, token_type, granted_by, granted_at, revoked_at） |
| 上下文构建器 | `src/context_builder/mod.rs` | `inject_file_refs()`、`workspace_root` 字段 |
| 前端通知 Hook | `src/hooks/useNotifications.ts` | SSE 订阅 hook，解析四种通知事件类型 |
| 前端 TopBar | `src/components/TopBar/TopBar.tsx` | TopBar，含 badge 区域、toast 容器 |
| 前端 Agent 注册表 | `src/components/AgentRegistry/AgentRegistry.tsx` | Agent 注册表 UI（v0.6 已有）|
| 前端决策收件箱 | `src/components/DecisionInbox/DecisionInbox.tsx` | 决策收件箱（v0.6 已有）|

### v0.8 新增模块概览

v0.8 在 v0.7 已运行的调度闭环之上叠加两层保证，同时收尾 req-020 前端验收缺口：

1. **沙盒逻辑层**（req-022，方案 C）：`src/sandbox/mod.rs` 新建，文件访问白名单过滤 + 直接状态写入拦截 + 越界审计日志
2. **Harness 管控层**（req-023）：`src/harness/mod.rs` 新建（Hook 网关三层完整实现）+ `src/workflow/mod.rs` 新建（DAG 推进机制）+ 决策 Approve 自动颁发令牌 + 令牌管理 REST API
3. **前端补齐**（req-020、req-023 UI）：TopBar badge 端到端联通 + 令牌管理标签页 + 决策收件箱令牌状态

---

## 架构概览（变更层级图）

```
【现有层（v0.7，不改动）】
dispatcher::run_auto_dispatcher()
    └─ context_builder::build()
    └─ Claude API 调用
    └─ state_machine 写回

【v0.8 新增：沙盒层（Node 1）】
src/sandbox/mod.rs
    └─ SandboxGuard::check_file_access(task_id, path)
         ↳ 对照 file_refs 白名单过滤
         ↳ 越界写入 ui_events(sandbox_access_denied)
    └─ SandboxGuard::intercept_direct_state_write(task_id, op)
         ↳ 拦截绕过 Hook 的直接 PATCH /tasks/:id 请求
         ↳ 越界写入 ui_events(sandbox_write_intercepted)
    ↑ 插入位置：dispatcher dispatch() 调用 context_builder 之前

【v0.8 新增：Harness 层（Node 2/3/4）】
src/harness/mod.rs
    └─ HarnessHook trait
    └─ PreHook::check()   — 令牌检查 + 依赖检查
    └─ PostHook::execute() — 自动颁发令牌 + DAG 推进 + SSE 通知
    └─ ErrorHook::handle() — 重试 + 人工介入请求

src/workflow/mod.rs
    └─ check_dag_advance(completed_task_id)
         ↳ 查 blocking_on 依赖，解锁下游节点
         ↳ 埋点 workflow_node_advanced / workflow_blocked

src/decisions/handlers.rs（扩展）
    └─ resolve_decision() — resolution=="approve" 时自动颁发 APPROVED 令牌

【v0.8 新增：令牌管理 API（Node 5）】
GET  /api/capability-tokens        — 列表（支持过滤）
POST /api/capability-tokens        — 手动颁发
DELETE /api/capability-tokens/:id  — 撤销（写入 revoked_at）

【v0.8 前端新增（Node 6/7/8）】
AgentRegistry.tsx
    └─ 新增「令牌管理」标签页 → CapabilityTokenTab.tsx

DecisionInbox.tsx
    └─ 详情面板新增「令牌状态」区域

useNotifications.ts（扩展）
    └─ decision_requested → badge 计数 +1
    └─ 进入收件箱 → badge 归零

TopBar.tsx（联通）
    └─ pendingDecisionCount → badge 数字显示
```

### 继承关系（v0.7 接口不变）

| v0.7 已有 | v0.8 变更方式 |
|-----------|-------------|
| `dispatcher::dispatch()` | 在调用 `context_builder.build()` 之前插入 `SandboxGuard::check_file_access()` 调用，接口签名不变 |
| `state_machine` REST API | Hook 网关作为状态变更的中间件层插入，不修改 REST API 接口 |
| `capability_tokens` 表 | ALTER TABLE 追加 `task_id TEXT` 和 `expires_at TEXT` 两列，向后兼容 |
| `check_pre_hook()` 雏形 | 重构为 `HarnessHook` trait + `PreHook` 实现，原检查逻辑保留并扩展 |
| `SseNotification::DecisionRequested` | 已在 v0.7.2 修复，v0.8 直接复用；前端 badge 联通为前端新增逻辑 |
| R-001 流水线规则 | 被泛化为 `workflow_id=WF-002` 的 DAG 推进机制包含，R-001 逻辑以 WF-002 形式继续生效 |

---

## Node 0：数据库迁移（capability_tokens 新增字段）

### 实现目标

为 v0.7 已有 `capability_tokens` 表追加两个新字段，在 `db.rs` 的 `create_tables()` 函数末尾通过捕获错误的方式静默执行迁移（同 v0.7 `file_refs` / `trigger_reason` 迁移方式，向后兼容 v0.7 已有记录）。

### 关键代码结构

```rust
// backend/src/db.rs — create_tables() 末尾追加
// task_id: 关联触发颁发的任务；NULL = 非任务触发颁发（v0.7 旧记录兼容）
let _ = sqlx::query(
    "ALTER TABLE capability_tokens ADD COLUMN task_id TEXT"
)
.execute(pool)
.await;

// expires_at: ISO 8601 时间字符串；NULL = 永不过期
let _ = sqlx::query(
    "ALTER TABLE capability_tokens ADD COLUMN expires_at TEXT"
)
.execute(pool)
.await;
```

同步更新 `CapabilityToken` struct：

```rust
// backend/src/models/capability_token.rs（新建或已有）
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CapabilityToken {
    pub id: String,
    pub project: String,
    pub version: String,
    pub token_type: String,       // "DELIVERABLE" | "APPROVED" | "MERGEABLE"
    pub granted_by: String,
    pub granted_at: String,
    pub revoked_at: Option<String>,
    pub task_id: Option<String>,  // v0.8 新增
    pub expires_at: Option<String>, // v0.8 新增
}
```

### 实现节点 Checklist（Node 0）

- [x] `backend/src/db.rs`：`create_tables()` 末尾追加 `ALTER TABLE capability_tokens ADD COLUMN task_id TEXT` 静默迁移
- [x] `backend/src/db.rs`：`create_tables()` 末尾追加 `ALTER TABLE capability_tokens ADD COLUMN expires_at TEXT` 静默迁移
- [x] `backend/src/models/capability_token.rs`：`CapabilityToken` struct 新增 `task_id: Option<String>` 字段
- [x] `backend/src/models/capability_token.rs`：`CapabilityToken` struct 新增 `expires_at: Option<String>` 字段
- [x] 验证：启动后端服务（已有 v0.7 数据库），确认服务正常启动、无 panic，旧令牌记录 `task_id` / `expires_at` 字段返回 null

---

## Node 1：沙盒逻辑层（req-022 方案 C）

> **[占位] 若董事长选择选项 2（Landlock），此节点替换为 Landlock 配置节点。**
> 方案 C 为最小公分母——无论选择哪个选项，下述逻辑隔离层均须实现。
> Landlock 节点将在 `src/sandbox/landlock.rs` 中新增，以 feature flag `landlock` 控制编译（仅 Linux 服务器启用），方案 C 的 `SandboxGuard` 逻辑层继续保留为备用/fallback。

### 实现目标

新建 `src/sandbox/mod.rs`，实现逻辑隔离层：

1. **文件读取白名单过滤**：Agent 请求读取文件时，对照当前任务的 `file_refs` 白名单；白名单外路径返回拒绝错误，并写入审计日志
2. **直接状态写入拦截**：Agent 尝试绕过 Hook 直接调用 `PATCH /tasks/:id` 时拦截请求，状态机不变更，写入审计日志
3. **沙盒实例无状态性**：`SandboxGuard` 每次任务调用时构造，任务结束后销毁，不保留跨调用上下文

插入位置：`dispatcher::dispatch()` 调用 `context_builder.build()` 之前构造 `SandboxGuard`，Agent 工具调用回程经 `check_file_access()` 过滤。

### 关键代码结构

```rust
// backend/src/sandbox/mod.rs（新建）

use crate::models::capability_token::CapabilityToken;
use sqlx::SqlitePool;

/// 沙盒守卫——每个任务调用持有一个实例，任务结束后 drop
pub struct SandboxGuard {
    pub task_id: String,
    pub role: String,
    /// file_refs 白名单：从 AgentTask.file_refs 解析的绝对路径列表
    pub allowed_paths: Vec<String>,
    pool: SqlitePool,
}

impl SandboxGuard {
    /// 构造函数：从 AgentTask 初始化，在 dispatcher::dispatch() 中调用
    pub fn new(
        task_id: String,
        role: String,
        file_refs_json: Option<String>,
        workspace_root: &str,
        pool: SqlitePool,
    ) -> Self {
        let allowed_paths = parse_file_refs(file_refs_json, workspace_root);
        SandboxGuard { task_id, role, allowed_paths, pool }
    }

    /// 检查文件访问权限——在 context_builder.inject_file_refs() 调用前调用
    /// 返回 Ok(()) 表示允许，Err(SandboxError::AccessDenied) 表示拒绝
    pub async fn check_file_access(
        &self,
        requested_path: &str,
    ) -> Result<(), SandboxError> {
        if self.allowed_paths.iter().any(|p| p == requested_path) {
            return Ok(());
        }
        // 写入审计日志：ui_events(sandbox_access_denied)
        self.write_audit_event(
            "sandbox_access_denied",
            serde_json::json!({
                "task_id": self.task_id,
                "role": self.role,
                "requested_path": requested_path,
                "allowed_paths_count": self.allowed_paths.len(),
            }),
        )
        .await;
        Err(SandboxError::AccessDenied {
            path: requested_path.to_string(),
        })
    }

    /// 拦截直接状态写入——在 routes/tasks.rs patch_task handler 中检查
    /// 若请求来自 Agent 调用上下文（非人工操作），则拦截
    pub async fn intercept_direct_state_write(
        &self,
        operation: &str,
    ) -> Result<(), SandboxError> {
        // 写入审计日志：ui_events(sandbox_write_intercepted)
        self.write_audit_event(
            "sandbox_write_intercepted",
            serde_json::json!({
                "task_id": self.task_id,
                "role": self.role,
                "attempted_operation": operation,
            }),
        )
        .await;
        Err(SandboxError::WriteIntercepted {
            operation: operation.to_string(),
        })
    }

    async fn write_audit_event(&self, event_name: &str, payload: serde_json::Value) {
        let _ = sqlx::query(
            "INSERT INTO ui_events (event_id, event_name, payload, created_at) \
             VALUES (?, ?, ?, ?)"
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(event_name)
        .bind(payload.to_string())
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await;
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    #[error("沙盒文件访问被拒绝: {path}")]
    AccessDenied { path: String },
    #[error("沙盒拦截直接状态写入: {operation}")]
    WriteIntercepted { operation: String },
}

/// 解析 file_refs JSON 数组为绝对路径列表
fn parse_file_refs(file_refs_json: Option<String>, workspace_root: &str) -> Vec<String> {
    let Some(json) = file_refs_json else { return vec![] };
    let paths: Vec<String> = serde_json::from_str(&json).unwrap_or_default();
    paths
        .into_iter()
        .map(|p| format!("{}/{}", workspace_root.trim_end_matches('/'), p))
        .collect()
}
```

### 实现节点 Checklist（Node 1）

- [x] `backend/src/sandbox/mod.rs`：新建文件，实现 `SandboxGuard` struct
- [x] `backend/src/sandbox/mod.rs`：`SandboxGuard::new()` 函数，从 `AgentTask.file_refs` 解析白名单路径
- [x] `backend/src/sandbox/mod.rs`：`SandboxGuard::check_file_access()` 方法，白名单过滤 + 越界写入 `ui_events(sandbox_access_denied)`
- [x] `backend/src/sandbox/mod.rs`：`SandboxGuard::intercept_direct_state_write()` 方法，写入 `ui_events(sandbox_write_intercepted)`
- [x] `backend/src/sandbox/mod.rs`：`SandboxError` enum（`AccessDenied` / `WriteIntercepted`）
- [x] `backend/src/sandbox/mod.rs`：`parse_file_refs()` 私有函数（JSON → 绝对路径列表）
- [x] `backend/src/lib.rs` 或 `main.rs`：声明 `pub mod sandbox`
- [x] `backend/src/dispatcher/mod.rs`：`dispatch()` 中在调用 `context_builder.build()` 之前构造 `SandboxGuard`，对 `file_refs` 中的路径调用 `check_file_access()`
- [x] `backend/src/dispatcher/mod.rs`：`check_file_access()` 拒绝时，任务写入 `TaskStatus::Failed`，日志记录拦截原因，不传递给 Claude API
- [x] **AC-3（跨 Agent 干扰检测）**：结构性满足说明——v0.7 上下文构建器为每次 API 调用独立构造 `system_context`（Push-based，无跨调用共享状态），每个 Agent 实例的 `tokio::task` 持有独立的 `SandboxGuard` 实例；Agent A 的输出只能通过 `PATCH /tasks/A_id` 写回自身任务，无法访问其他任务的 `input_context` 字段——此约束由 REST API 路由层（Path 参数 `:id` 绑定到任务 ID）结构性保证，无需额外代码节点。若将来引入 Agent 工具调用（function call），需在 Node 1 增加工具调用白名单检查。

---

## Node 2：Hook 网关完整实现（req-023 pre/post/error）

### 实现目标

将 v0.7 `dispatcher/mod.rs` 中的 `check_pre_hook()` 雏形重构并扩展为完整的 Harness Hook 网关，新建 `src/harness/mod.rs`。

三层 Hook：
- `PreHook`：前置条件门控（令牌检查 + 依赖检查）
- `PostHook`：副作用触发（令牌颁发 + DAG 推进 + SSE 通知）
- `ErrorHook`：失败处理（exponential backoff 重试 + 人工介入请求）

### 关键代码结构

```rust
// backend/src/harness/mod.rs（新建）

use crate::models::capability_token::CapabilityToken;
use crate::events::sse::SseNotification;
use sqlx::SqlitePool;
use tokio::sync::broadcast;

/// Hook 网关 trait——所有 Hook 实现此接口
#[async_trait::async_trait]
pub trait HarnessHook: Send + Sync {
    async fn run(
        &self,
        ctx: &HookContext,
        pool: &SqlitePool,
    ) -> Result<HookOutcome, HookError>;
}

/// Hook 执行上下文
pub struct HookContext {
    pub task_id: String,
    pub project: String,
    pub version: String,
    pub from_status: String,
    pub to_status: String,
    pub retry_count: u32,
    pub notify_tx: broadcast::Sender<SseNotification>,
}

pub enum HookOutcome {
    /// 允许状态变更继续
    Proceed,
    /// 阻断状态变更，附带原因
    Blocked { reason: String, missing_token_type: Option<String> },
    /// 重试（error-hook 专用）
    Retry { delay_secs: u64 },
    /// 升级人工介入（error-hook 专用，≥ 3 次失败后）
    EscalateToHuman { decision_task_id: String },
}

#[derive(Debug, thiserror::Error)]
pub enum HookError {
    #[error("数据库错误: {0}")]
    DbError(#[from] sqlx::Error),
    #[error("Hook 执行内部错误: {0}")]
    Internal(String),
}

// ----- PreHook -----

pub struct PreHook;

#[async_trait::async_trait]
impl HarnessHook for PreHook {
    async fn run(
        &self,
        ctx: &HookContext,
        pool: &SqlitePool,
    ) -> Result<HookOutcome, HookError> {
        match (ctx.from_status.as_str(), ctx.to_status.as_str()) {
            ("pending", "running") => {
                // 1. 检查 blocking_on 依赖是否已全部 completed
                check_blocking_on(&ctx.task_id, pool).await?;
                // 2. 对需要 APPROVED 令牌的任务：检查 capability_tokens 表
                check_required_token(&ctx.project, &ctx.version, "APPROVED", pool).await?;
                // 3. 并发配额检查（复用 dispatcher 的 Semaphore 机制）
                //    注：v0.8 并发上限检查保留在 dispatcher::run_auto_dispatcher() 的
                //    Semaphore(MAX_CONCURRENT_AGENTS) 中，PreHook 不重复检查，
                //    以避免双重计数（Semaphore 已在 dispatch() 调用前 acquire）
                Ok(HookOutcome::Proceed)
            }
            ("running", "completed") => {
                // 检查 output 字段非空
                check_output_non_empty(&ctx.task_id, pool).await
            }
            ("awaiting-decision", "approved") => {
                // 检查审批权限（CEO Agent 或董事长）——v0.8 暂检查 granted_by 字段约定
                Ok(HookOutcome::Proceed)
            }
            _ => Ok(HookOutcome::Proceed),
        }
    }
}

// ----- PostHook -----

pub struct PostHook;

#[async_trait::async_trait]
impl HarnessHook for PostHook {
    async fn run(
        &self,
        ctx: &HookContext,
        pool: &SqlitePool,
    ) -> Result<HookOutcome, HookError> {
        match (ctx.from_status.as_str(), ctx.to_status.as_str()) {
            (_, "completed") => {
                // 1. SSE 推送 task_completed
                let _ = ctx.notify_tx.send(SseNotification::TaskCompleted { /* 从 ctx 填充 */ });
                // 2. DAG 推进（见 Node 4）
                let _ = workflow::check_dag_advance(&ctx.task_id, pool, &ctx.notify_tx).await;
                // 3. 按 role 自动颁发令牌
                //    review-agent completed → DELIVERABLE 令牌
                //    qa-agent completed     → MERGEABLE 令牌
                //    （具体 role 判断在实现中从 ctx.task_id 查询 AgentTask.role）
                Ok(HookOutcome::Proceed)
            }
            ("awaiting-decision", "approved") => {
                // 自动颁发 APPROVED 令牌（决策 Approve，见 Node 3）
                // 实际颁发逻辑在 resolve_decision() handler 中调用，PostHook 此处埋点
                Ok(HookOutcome::Proceed)
            }
            (_, "failed") => {
                // 触发 ErrorHook（由 dispatcher 在任务失败时调用，PostHook 不直接处理）
                Ok(HookOutcome::Proceed)
            }
            _ => Ok(HookOutcome::Proceed),
        }
    }
}

// ----- ErrorHook -----

pub struct ErrorHook;

#[async_trait::async_trait]
impl HarnessHook for ErrorHook {
    async fn run(
        &self,
        ctx: &HookContext,
        pool: &SqlitePool,
    ) -> Result<HookOutcome, HookError> {
        match ctx.retry_count {
            0..=2 => {
                // exponential backoff: 30s / 60s / 120s
                let delay = 30u64 * 2u64.pow(ctx.retry_count);
                Ok(HookOutcome::Retry { delay_secs: delay })
            }
            _ => {
                // ≥ 3 次失败：创建 awaiting-decision 任务，触发人工介入
                let decision_task_id = create_human_intervention_task(ctx, pool).await?;
                Ok(HookOutcome::EscalateToHuman { decision_task_id })
            }
        }
    }
}

// 辅助函数签名（具体实现在同文件中）
async fn check_blocking_on(task_id: &str, pool: &SqlitePool) -> Result<HookOutcome, HookError>;
async fn check_required_token(project: &str, version: &str, token_type: &str, pool: &SqlitePool) -> Result<HookOutcome, HookError>;
async fn check_output_non_empty(task_id: &str, pool: &SqlitePool) -> Result<HookOutcome, HookError>;
async fn create_human_intervention_task(ctx: &HookContext, pool: &SqlitePool) -> Result<String, HookError>;
```

### 实现节点 Checklist（Node 2）

- [x] `backend/src/harness/mod.rs`：新建文件，定义 `HarnessHook` trait
- [x] `backend/src/harness/mod.rs`：`HookContext` struct（含所有上下文字段）
- [x] `backend/src/harness/mod.rs`：`HookOutcome` enum（`Proceed` / `Blocked` / `Retry` / `EscalateToHuman`）
- [x] `backend/src/harness/mod.rs`：`HookError` enum（`DbError` / `Internal`）
- [x] `backend/src/harness/mod.rs`：`PreHook` struct + `HarnessHook` 实现（`pending→running` 令牌检查 + 依赖检查；`running→completed` output 非空检查）
- [x] `backend/src/harness/mod.rs`：`PostHook` struct + `HarnessHook` 实现（completed 推 SSE + 调用 DAG 推进；approved 自动颁发 APPROVED 令牌；review-agent completed 自动颁发 DELIVERABLE 令牌；qa-agent completed 自动颁发 MERGEABLE 令牌）
- [x] `backend/src/harness/mod.rs`：`ErrorHook` struct + `HarnessHook` 实现（exponential backoff 三次；≥3 次后调用 `create_human_intervention_task()`）
- [x] `backend/src/events/sse.rs`：`SseNotification` enum 新增 `TaskBlocked` variant（字段：`task_id: String, from_status: String, to_status: String, block_reason: String, missing_token_type: Option<String>, timestamp: String`）——用于 pre-hook 阻断时的前端实时通知
- [x] `backend/src/harness/mod.rs`：`PreHook::run()` 返回 `Blocked` 时，通过 `ctx.notify_tx` 发送 `SseNotification::TaskBlocked`（携带 `block_reason` 和 `missing_token_type`）
- [x] `backend/src/harness/mod.rs`：`check_blocking_on()` 辅助函数（查 `agent_tasks.blocking_on` JSON 字段，所有依赖 status==completed 则返回 Proceed，否则返回 Blocked）
- [x] `backend/src/harness/mod.rs`：`check_required_token()` 辅助函数（查 `capability_tokens` 表，令牌存在且 `revoked_at IS NULL` 且未过期则 Proceed）
- [x] `backend/src/harness/mod.rs`：`create_human_intervention_task()` 辅助函数（通过 state_machine 创建 `awaiting-decision` 类型任务，记录埋点 `error_hook_escalated`）
- [x] `backend/src/lib.rs` 或 `main.rs`：声明 `pub mod harness`
- [x] `backend/src/dispatcher/mod.rs`：`dispatch_core()` 中任务状态变更前后分别调用 `PreHook::run()` / `PostHook::run()`；任务失败时调用 `ErrorHook::run()`
- [x] 埋点：Hook 各分支写入 `ui_events`（`pre_hook_passed` / `pre_hook_blocked` / `post_hook_executed` / `error_hook_triggered` / `error_hook_escalated`）

---

## Node 3：决策 Approve → 自动颁发 APPROVED 令牌

### 实现目标

扩展 `src/decisions/handlers.rs` 中的 `resolve_decision()` handler：当 `resolution == "approve"` 时，在状态机写入审批结果之后，自动向 `capability_tokens` 表插入一条 `APPROVED` 令牌记录，并通过 SSE 推送更新事件。

### 关键代码结构

```rust
// backend/src/decisions/handlers.rs — resolve_decision() 扩展

pub async fn resolve_decision(
    State(state): State<AppState>,
    Path(decision_id): Path<String>,
    Json(req): Json<ResolveDecisionRequest>,
) -> Result<impl IntoResponse, AppError> {
    // 1. 查询 decision，获取关联的 task_id / project / version
    let decision = get_decision_by_id(&decision_id, &state.db).await?;

    // 2. 更新 decision status
    update_decision_status(&decision_id, &req.resolution, &state.db).await?;

    // 3. 若 resolution == "approve"：自动颁发 APPROVED 令牌
    if req.resolution == "approve" {
        grant_capability_token(
            GrantTokenRequest {
                project: decision.project.clone(),
                version: decision.version.clone(),
                token_type: "APPROVED".to_string(),
                granted_by: req.resolved_by.clone().unwrap_or("ceo-agent".to_string()),
                task_id: Some(decision.task_id.clone()),
                expires_at: None,
            },
            &state.db,
        )
        .await?;

        // 写入埋点：token_granted_auto
        insert_ui_event(
            &state.db,
            "token_granted_auto",
            serde_json::json!({
                "token_type": "APPROVED",
                "project": decision.project,
                "version": decision.version,
                "trigger_task_id": decision.task_id,
            }),
        )
        .await;

        // SSE 通知前端令牌已颁发（可复用 notify_tx，事件类型 token_granted）
        let _ = state.notify_tx.send(SseNotification::TokenGranted {
            token_type: "APPROVED".to_string(),
            project: decision.project.clone(),
            version: decision.version.clone(),
            task_id: decision.task_id.clone(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        });
    }

    Ok(StatusCode::OK)
}

// backend/src/events/sse.rs — SseNotification 新增 variant
// TokenGranted { token_type, project, version, task_id, timestamp }
```

颁发令牌的内部函数签名（在 `src/models/capability_token.rs` 或 `src/harness/mod.rs` 中实现）：

```rust
pub struct GrantTokenRequest {
    pub project: String,
    pub version: String,
    pub token_type: String,
    pub granted_by: String,
    pub task_id: Option<String>,
    pub expires_at: Option<String>,
}

pub async fn grant_capability_token(
    req: GrantTokenRequest,
    pool: &SqlitePool,
) -> Result<String, sqlx::Error> {
    // INSERT INTO capability_tokens ... 返回新令牌 id
}
```

### 实现节点 Checklist（Node 3）

- [x] `backend/src/decisions/handlers.rs`：`resolve_decision()` handler 新增 `resolution == "approve"` 分支
- [x] `backend/src/decisions/handlers.rs`：`resolution == "approve"` 时调用 `grant_capability_token()` 插入 `APPROVED` 令牌记录
- [x] `backend/src/decisions/handlers.rs`：`resolution == "approve"` 时写入埋点 `token_granted_auto`
- [x] `backend/src/decisions/handlers.rs`：`resolution == "approve"` 时通过 `state.notify_tx` 发送 `SseNotification::TokenGranted`
- [x] `backend/src/events/sse.rs`：`SseNotification` enum 新增 `TokenGranted` variant（字段：`token_type, project, version, task_id, timestamp`）
- [x] `backend/src/models/capability_token.rs`：`GrantTokenRequest` struct
- [x] `backend/src/models/capability_token.rs`：`grant_capability_token()` 公开异步函数（INSERT INTO capability_tokens）
- [x] `backend/src/harness/mod.rs`：`PostHook` 中颁发 `DELIVERABLE` 令牌（review-agent completed 且无 🔴）和 `MERGEABLE` 令牌（qa-agent completed 且测试通过）均复用 `grant_capability_token()`

---

## Node 4：工作流 DAG 推进（WF-001/WF-002 硬编码）

### 实现目标

新建 `src/workflow/mod.rs`，实现确定性 DAG 推进机制。不引入外部工作流引擎，用 Rust 代码 + `blocking_on` JSON 字段实现。`PostHook` 在每次任务 `→ completed` 后调用 `check_dag_advance()`，检查下游节点依赖是否已全部满足，满足则解锁（`pending → 可调度`，调度器下次轮询自动接取）。

预置工作流 WF-001 / WF-002 以硬编码方式在启动时注册，不做可视化配置（v0.9 扩展）。

### 关键代码结构

```rust
// backend/src/workflow/mod.rs（新建）

use sqlx::SqlitePool;

/// 工作流定义（硬编码，v0.8 预置两条）
pub struct WorkflowDef {
    pub workflow_id: &'static str,
    pub description: &'static str,
}

pub const WF_001: WorkflowDef = WorkflowDef {
    workflow_id: "WF-001",
    description: "文档审查 → CEO 决策 → 实现：review-agent 完成且无 🔴 → awaiting-decision → engineering-agent",
};

pub const WF_002: WorkflowDef = WorkflowDef {
    workflow_id: "WF-002",
    description: "实现 → QA → 合并：engineering-agent → qa-agent → awaiting-merge",
};

/// DAG 推进主函数——在 PostHook 中，每次任务 completed 后调用
pub async fn check_dag_advance(
    completed_task_id: &str,
    pool: &SqlitePool,
    notify_tx: &tokio::sync::broadcast::Sender<crate::events::sse::SseNotification>,
) -> Result<(), DagError> {
    // 1. 查询所有 blocking_on JSON 数组中包含 completed_task_id 的下游任务
    //    SELECT id, blocking_on, workflow_id FROM agent_tasks
    //    WHERE status = 'pending' AND blocking_on LIKE '%' || ? || '%'
    let downstream = query_downstream_tasks(completed_task_id, pool).await?;

    for task in downstream {
        // 2. 对每个下游节点，检查 blocking_on 列表中所有依赖是否已 completed
        let all_deps_met = check_all_deps_completed(&task.blocking_on, pool).await?;

        if all_deps_met {
            // 3. 解锁：将下游节点标记为「可调度」
            //    更新 blocking_on_resolved = true 或直接将 status 保持 pending
            //    （调度器下次轮询时自动接取 blocking_on 全满足的 pending 任务）
            mark_task_unblocked(&task.id, pool).await?;

            // 埋点：workflow_node_advanced
            insert_ui_event(
                pool,
                "workflow_node_advanced",
                serde_json::json!({
                    "workflow_id": task.workflow_id,
                    "completed_task_id": completed_task_id,
                    "unlocked_task_id": task.id,
                    "dag_depth": task.dag_depth,
                }),
            )
            .await;
        } else {
            // 4. 依赖未全满足：保持 pending，埋点 workflow_blocked
            let pending_deps_count = count_pending_deps(&task.blocking_on, pool).await?;

            insert_ui_event(
                pool,
                "workflow_blocked",
                serde_json::json!({
                    "workflow_id": task.workflow_id,
                    "completed_task_id": completed_task_id,
                    "blocked_task_id": task.id,
                    "pending_deps_count": pending_deps_count,
                }),
            )
            .await;
        }
    }

    Ok(())
}

/// 调度器 PreHook 中的依赖检查——pending→running 前验证 blocking_on 全满足
pub async fn is_task_unblocked(task_id: &str, pool: &SqlitePool) -> Result<bool, DagError> {
    // 查询 agent_tasks.blocking_on，解析 JSON 数组，检查每个依赖 ID 的 status
}

#[derive(Debug, thiserror::Error)]
pub enum DagError {
    #[error("数据库错误: {0}")]
    DbError(#[from] sqlx::Error),
    #[error("DAG 解析错误: {0}")]
    ParseError(String),
}

// 内部辅助函数签名
async fn query_downstream_tasks(completed_task_id: &str, pool: &SqlitePool) -> Result<Vec<DownstreamTask>, DagError>;
async fn check_all_deps_completed(blocking_on_json: &Option<String>, pool: &SqlitePool) -> Result<bool, DagError>;
async fn mark_task_unblocked(task_id: &str, pool: &SqlitePool) -> Result<(), DagError>;
async fn count_pending_deps(blocking_on_json: &Option<String>, pool: &SqlitePool) -> Result<usize, DagError>;

struct DownstreamTask {
    pub id: String,
    pub blocking_on: Option<String>,
    pub workflow_id: Option<String>,
    /// dag_depth：运行时计算值，非数据库字段
    /// 计算方式：BFS 从 DAG 根节点（blocking_on 为 null 的任务）出发，
    /// 当前任务所在层级即为 dag_depth（根节点 = 0，直接下游 = 1，以此类推）
    /// 在 query_downstream_tasks() 中通过递归查询 blocking_on 链计算得出
    pub dag_depth: u32,
}
```

调度器需同步更新：`run_auto_dispatcher()` 接取 `pending` 任务时，调用 `workflow::is_task_unblocked()` 验证依赖是否已全满足，未满足则跳过（任务保持 pending）。

### 实现节点 Checklist（Node 4）

- [x] `backend/src/workflow/mod.rs`：新建文件，定义 `WorkflowDef` struct 和 `WF_001` / `WF_002` 常量
- [x] `backend/src/workflow/mod.rs`：`check_dag_advance()` 公开异步函数（查下游节点 + 依赖检查 + 解锁 + 埋点）
- [x] `backend/src/workflow/mod.rs`：`is_task_unblocked()` 公开异步函数（供调度器 pre-hook 调用）
- [x] `backend/src/workflow/mod.rs`：`query_downstream_tasks()` 内部辅助函数
- [x] `backend/src/workflow/mod.rs`：`check_all_deps_completed()` 内部辅助函数（解析 `blocking_on` JSON + 查每个依赖的 status）
- [x] `backend/src/workflow/mod.rs`：`mark_task_unblocked()` 内部辅助函数
- [x] `backend/src/workflow/mod.rs`：`DagError` enum
- [x] `backend/src/lib.rs` 或 `main.rs`：声明 `pub mod workflow`
- [x] `backend/src/harness/mod.rs`：`PostHook` 中任务 `→ completed` 后调用 `workflow::check_dag_advance()`
- [x] `backend/src/dispatcher/mod.rs`：`run_auto_dispatcher()` 接取 pending 任务时，先调用 `workflow::is_task_unblocked()` 检查依赖，未满足则跳过
- [x] `backend/src/state_machine/task.rs`：`AgentTask` struct 新增 `workflow_id: Option<String>` 字段（用于埋点）
- [x] `backend/src/db.rs`：`ALTER TABLE agent_tasks ADD COLUMN workflow_id TEXT` 静默迁移

---

## Node 5：令牌管理 REST API

### 实现目标

新增三个 REST API 端点，供前端令牌管理 UI 调用，同时供 `PostHook` 内部调用颁发令牌。

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/api/capability-tokens` | 列表，支持 `?project=&version=&token_type=&active_only=` 过滤 |
| `POST` | `/api/capability-tokens` | 手动颁发令牌（CEO 操作） |
| `DELETE` | `/api/capability-tokens/:id` | 撤销令牌（写入 `revoked_at`，不物理删除） |

### 关键代码结构

```rust
// backend/src/routes/capability_tokens.rs（新建）

use axum::{extract::{Path, Query, State}, Json, response::IntoResponse, http::StatusCode};
use crate::models::capability_token::{CapabilityToken, GrantTokenRequest, grant_capability_token};
use crate::AppState;

#[derive(Debug, serde::Deserialize)]
pub struct ListTokensQuery {
    pub project: Option<String>,
    pub version: Option<String>,
    pub token_type: Option<String>,
    /// 若 true，只返回 revoked_at IS NULL 且未过期的令牌
    pub active_only: Option<bool>,
}

/// GET /api/capability-tokens
pub async fn list_tokens(
    State(state): State<AppState>,
    Query(params): Query<ListTokensQuery>,
) -> Result<impl IntoResponse, AppError> {
    // SELECT * FROM capability_tokens WHERE（动态拼接过滤条件）
    // 返回 JSON 数组
}

#[derive(Debug, serde::Deserialize)]
pub struct CreateTokenRequest {
    pub project: String,
    pub version: String,
    pub token_type: String,       // "DELIVERABLE" | "APPROVED" | "MERGEABLE"
    pub granted_by: String,
    pub task_id: Option<String>,
    pub expires_at: Option<String>,
}

/// POST /api/capability-tokens
pub async fn create_token(
    State(state): State<AppState>,
    Json(req): Json<CreateTokenRequest>,
) -> Result<impl IntoResponse, AppError> {
    let token_id = grant_capability_token(
        GrantTokenRequest {
            project: req.project.clone(),
            version: req.version.clone(),
            token_type: req.token_type.clone(),
            granted_by: req.granted_by.clone(),
            task_id: req.task_id,
            expires_at: req.expires_at,
        },
        &state.db,
    )
    .await?;

    // 写入埋点：token_granted_manual
    insert_ui_event(
        &state.db,
        "token_granted_manual",
        serde_json::json!({
            "token_type": req.token_type,
            "project": req.project,
            "version": req.version,
            "granted_by": "ceo-manual",
        }),
    )
    .await;

    Ok((StatusCode::CREATED, Json(serde_json::json!({"id": token_id}))))
}

/// DELETE /api/capability-tokens/:id
pub async fn revoke_token(
    State(state): State<AppState>,
    Path(token_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    // 步骤 1：先查询令牌信息（用于埋点 payload）
    let token = sqlx::query_as::<_, CapabilityToken>(
        "SELECT * FROM capability_tokens WHERE id = ? AND revoked_at IS NULL"
    )
    .bind(&token_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("令牌不存在或已撤销".to_string()))?;

    // 步骤 2：执行撤销
    let revoked_at = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE capability_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL"
    )
    .bind(&revoked_at)
    .bind(&token_id)
    .execute(&state.db)
    .await?;

    // 步骤 3：写入埋点（使用步骤 1 查询到的字段）
    let granted_at = chrono::DateTime::parse_from_rfc3339(&token.granted_at)
        .map(|t| t.with_timezone(&chrono::Utc))
        .unwrap_or_else(|_| chrono::Utc::now());
    let token_age_hours = (chrono::Utc::now() - granted_at).num_hours();

    insert_ui_event(
        &state.db,
        "token_revoked",
        serde_json::json!({
            "token_type": token.token_type,
            "project": token.project,
            "version": token.version,
            "revoked_by": "ceo-manual",
            "token_age_hours": token_age_hours,
        }),
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}
```

路由注册（`backend/src/main.rs`）：

```rust
.route("/api/capability-tokens", get(routes::capability_tokens::list_tokens))
.route("/api/capability-tokens", post(routes::capability_tokens::create_token))
.route("/api/capability-tokens/:id", delete(routes::capability_tokens::revoke_token))
```

### 实现节点 Checklist（Node 5）

- [x] `backend/src/routes/capability_tokens.rs`：新建文件，实现 `list_tokens()` handler（支持 `project` / `version` / `token_type` / `active_only` 过滤）
- [x] `backend/src/routes/capability_tokens.rs`：`CreateTokenRequest` struct（含 project / version / token_type / granted_by / task_id / expires_at 字段）
- [x] `backend/src/routes/capability_tokens.rs`：`create_token()` handler（调用 `grant_capability_token()`，写入埋点 `token_granted_manual`）
- [x] `backend/src/routes/capability_tokens.rs`：`revoke_token()` handler（UPDATE revoked_at，写入埋点 `token_revoked`，令牌不存在或已撤销返回 404）
- [x] `backend/src/routes/mod.rs`：声明 `pub mod capability_tokens`
- [x] `backend/src/main.rs`：注册三条路由 `GET/POST /api/capability-tokens` 和 `DELETE /api/capability-tokens/:id`
- [x] `backend/src/harness/mod.rs`：`check_required_token()` 查询时额外检查 `expires_at`（非空且已过期的令牌视为无效）

---

## Node 6：前端令牌管理 UI（Agent 注册表新标签页）

### 实现目标

在 `AgentRegistry.tsx` 中新增第二个标签页「令牌管理」，对应子组件 `CapabilityTokenTab.tsx`。提供令牌列表展示、手动颁发和撤销功能，撤销操作弹窗二次确认。

### 关键代码结构

```typescript
// workbench/src/components/AgentRegistry/CapabilityTokenTab.tsx（新建）

interface CapabilityToken {
  id: string
  project: string
  version: string
  token_type: 'DELIVERABLE' | 'APPROVED' | 'MERGEABLE'
  granted_by: string
  granted_at: string
  revoked_at: string | null
  task_id: string | null
  expires_at: string | null
}

interface CapabilityTokenTabProps {
  project?: string
  version?: string
}

export function CapabilityTokenTab({ project, version }: CapabilityTokenTabProps) {
  const [tokens, setTokens] = useState<CapabilityToken[]>([])
  const [filter, setFilter] = useState<{
    project: string
    version: string
    token_type: string
    active_only: boolean
  }>({ project: project ?? '', version: version ?? '', token_type: '', active_only: false })
  const [showGrantModal, setShowGrantModal] = useState(false)
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null)

  // 加载令牌列表
  const loadTokens = async () => {
    const result = await invoke<CapabilityToken[]>('list_capability_tokens', { filter })
    setTokens(result)
  }

  // 手动颁发令牌
  const handleGrant = async (req: {
    project: string
    version: string
    token_type: string
    granted_by: string
  }) => {
    await invoke('create_capability_token', { req })
    setShowGrantModal(false)
    await loadTokens()
  }

  // 撤销令牌（二次确认后执行）
  const handleRevoke = async (tokenId: string) => {
    await invoke('revoke_capability_token', { tokenId })
    setRevokeConfirmId(null)
    await loadTokens()
  }

  return (
    // 过滤栏：project / version / token_type / active_only 开关
    // 列表：令牌类型 | 颁发来源 | 颁发时间 | 状态（有效/已撤销）
    // [手动颁发] 按钮 → 弹出 GrantTokenModal（含权限提示：「CEO 专属操作」）
    // [撤销] 按钮 → setRevokeConfirmId(token.id) → 弹出确认对话框
  )
}

// workbench/src/components/AgentRegistry/AgentRegistry.tsx — 新增标签页
// 在现有注册表列表 tab 旁新增「令牌管理」tab
// 切换时挂载 <CapabilityTokenTab />
```

Tauri 命令层新增三个命令（在 `src-tauri/src/commands/backend_client.rs` 中）：

```rust
// backend_client.rs — 新增令牌管理命令

#[tauri::command]
pub async fn list_capability_tokens(
    filter: serde_json::Value,
    state: tauri::State<'_, AppConfig>,
) -> Result<serde_json::Value, String> {
    // GET /api/capability-tokens?project=&version=&token_type=&active_only=
}

#[tauri::command]
pub async fn create_capability_token(
    req: serde_json::Value,
    state: tauri::State<'_, AppConfig>,
) -> Result<serde_json::Value, String> {
    // POST /api/capability-tokens
}

#[tauri::command]
pub async fn revoke_capability_token(
    token_id: String,
    state: tauri::State<'_, AppConfig>,
) -> Result<(), String> {
    // DELETE /api/capability-tokens/:id
}
```

### 实现节点 Checklist（Node 6）

- [x] `workbench/src/components/AgentRegistry/CapabilityTokenTab.tsx`：新建文件，实现 `CapabilityToken` interface 和 `CapabilityTokenTab` 组件
- [x] `workbench/src/components/AgentRegistry/CapabilityTokenTab.tsx`：过滤栏（project / version / token_type 文本过滤 + `active_only` 开关）
- [x] `workbench/src/components/AgentRegistry/CapabilityTokenTab.tsx`：令牌列表展示（类型 + 颁发来源 + 颁发时间 + 状态徽章）
- [x] `workbench/src/components/AgentRegistry/CapabilityTokenTab.tsx`：「手动颁发」按钮 + `GrantTokenModal` 弹窗（CEO 权限提示文字）
- [x] `workbench/src/components/AgentRegistry/CapabilityTokenTab.tsx`：「撤销」按钮 + 二次确认对话框（「撤销不可逆，但不影响已完成任务」提示）
- [x] `workbench/src/components/AgentRegistry/CapabilityTokenTab.css`：令牌列表样式 + 状态徽章（绿色=有效，灰色=已撤销）
- [x] `workbench/src/components/AgentRegistry/AgentRegistry.tsx`：新增「令牌管理」标签页，切换时渲染 `<CapabilityTokenTab />`
- [x] `workbench/src-tauri/src/commands/backend_client.rs`：新增 `list_capability_tokens()` 命令
- [x] `workbench/src-tauri/src/commands/backend_client.rs`：新增 `create_capability_token()` 命令
- [x] `workbench/src-tauri/src/commands/backend_client.rs`：新增 `revoke_capability_token()` 命令
- [x] `workbench/src-tauri/src/lib.rs`：注册三个新命令

---

## Node 7：前端决策收件箱令牌状态集成

### 实现目标

扩展 `DecisionInbox.tsx`，在每条 `awaiting-decision` 任务的详情面板中新增「令牌状态」区域：

1. 展示关联文档的 `DELIVERABLE` 令牌是否存在（review-agent 是否已通过）
2. Approve 操作完成后，实时显示 `APPROVED` 令牌已颁发（SSE 驱动，无需刷新）

### 关键代码结构

```typescript
// workbench/src/components/DecisionInbox/DecisionInbox.tsx — 扩展详情面板

interface TokenStatusInfo {
  deliverable?: {
    exists: boolean
    granted_at?: string
    granted_by?: string
  }
  approved?: {
    exists: boolean
    granted_at?: string
  }
}

// 决策详情子组件
function DecisionDetailPanel({ decision }: { decision: Decision }) {
  const [tokenStatus, setTokenStatus] = useState<TokenStatusInfo>({})

  // 加载关联令牌状态
  const loadTokenStatus = async () => {
    const tokens = await invoke<CapabilityToken[]>('list_capability_tokens', {
      filter: {
        project: decision.project,
        version: decision.version,
        active_only: false,
      },
    })
    setTokenStatus({
      deliverable: {
        exists: tokens.some(t => t.token_type === 'DELIVERABLE' && !t.revoked_at),
        granted_at: tokens.find(t => t.token_type === 'DELIVERABLE')?.granted_at,
      },
      approved: {
        exists: tokens.some(t => t.token_type === 'APPROVED' && !t.revoked_at),
        granted_at: tokens.find(t => t.token_type === 'APPROVED')?.granted_at,
      },
    })
  }

  // 监听 SSE TokenGranted 事件，实时更新令牌状态
  useEffect(() => {
    // 订阅 notificationsStore.lastTokenGranted
    // 若 token.project === decision.project && token.version === decision.version
    // 则重新调用 loadTokenStatus()
  }, [/* notificationsStore.lastTokenGranted */])

  return (
    // 决策详情面板：原有字段 + 新增「令牌状态」区域
    // 令牌状态区域：
    //   DELIVERABLE 令牌：✓ 已颁发（时间）/ ✗ 未颁发（review-agent 尚未通过）
    //   APPROVED 令牌：✓ 已颁发（Approve 后实时更新）/ 待审批
  )
}
```

Zustand 通知 store 扩展（`src/store/notificationsSlice.ts`）：

```typescript
// notificationsSlice.ts — 新增 lastTokenGranted 字段
interface NotificationsState {
  toasts: ToastNotification[]
  pendingDecisionCount: number
  lastTokenGranted: TokenGrantedEvent | null   // 新增
  addToast: (toast: ToastNotification) => void
  removeToast: (id: string) => void
  setPendingDecisionCount: (count: number) => void
  setLastTokenGranted: (event: TokenGrantedEvent) => void  // 新增
}

interface TokenGrantedEvent {
  token_type: string
  project: string
  version: string
  task_id: string
  timestamp: string
}
```

### 实现节点 Checklist（Node 7）

- [x] `workbench/src/components/DecisionInbox/DecisionInbox.tsx`：`TokenStatusInfo` interface（含 deliverable / approved 两个令牌状态字段）
- [x] `workbench/src/components/DecisionInbox/DecisionInbox.tsx`：`DecisionDetailPanel` 子组件新增「令牌状态」区域 UI
- [x] `workbench/src/components/DecisionInbox/DecisionInbox.tsx`：`loadTokenStatus()` 函数，调用 `list_capability_tokens` Tauri 命令
- [x] `workbench/src/components/DecisionInbox/DecisionInbox.tsx`：`useEffect` 监听 `notificationsStore.lastTokenGranted`，project + version 匹配时重新加载令牌状态
- [x] `workbench/src/store/notificationsSlice.ts`：新增 `lastTokenGranted: TokenGrantedEvent | null` 字段
- [x] `workbench/src/store/notificationsSlice.ts`：新增 `setLastTokenGranted()` action
- [x] `workbench/src/hooks/useNotifications.ts`：解析 `token_granted` SSE 事件，调用 `store.setLastTokenGranted()`

---

## Node 8：TopBar 通知 badge 端到端验收（req-020 收尾）

### 实现目标

联通 v0.7 已有的 SSE 通知层与前端 badge 计数逻辑，完成 req-020 的完整前端验收。后端 `SseNotification::DecisionRequested` 已在 v0.7.2 修复并通过 `notify_tx` 发送，本节点只做前端收线和 badge 归零逻辑。

### 关键代码结构

```typescript
// workbench/src/hooks/useNotifications.ts — 扩展 decision_requested 处理

export function useNotifications() {
  const store = useNotificationsStore()

  useEffect(() => {
    const backendUrl = 'http://43.135.174.27:8081'
    const es = new EventSource(`${backendUrl}/sse/notifications`)

    es.onmessage = (event) => {
      const notification = JSON.parse(event.data)

      switch (notification.type) {
        case 'task_completed':
          store.addToast({ id: ulid(), type: 'success', message: `✓ 完成：${notification.title}`, autoDismiss: true })
          break
        case 'task_failed':
          store.addToast({ id: ulid(), type: 'error', message: `✗ 失败：${notification.title}`, autoDismiss: false })
          break
        case 'pipeline_triggered':
          store.addToast({ id: ulid(), type: 'info', message: `流水线触发：${notification.target_role}`, autoDismiss: true })
          break
        case 'decision_requested':
          // badge +1（联通逻辑，v0.7 已有但未完成前端验收）
          store.incrementPendingDecisionCount()
          break
        case 'token_granted':
          // Node 7 新增：实时令牌状态更新
          store.setLastTokenGranted(notification)
          break
      }
    }

    return () => es.close()
  }, [])
}

// workbench/src/store/notificationsSlice.ts — badge 计数完整实现
interface NotificationsState {
  toasts: ToastNotification[]
  pendingDecisionCount: number           // awaiting-decision 未查看数量
  lastTokenGranted: TokenGrantedEvent | null
  addToast: (toast: ToastNotification) => void
  removeToast: (id: string) => void
  incrementPendingDecisionCount: () => void  // decision_requested 时 +1
  resetPendingDecisionCount: () => void      // 进入决策收件箱时归零
  setLastTokenGranted: (event: TokenGrantedEvent) => void
}
```

TopBar badge 联通（`TopBar.tsx`）：

```typescript
// workbench/src/components/TopBar/TopBar.tsx — badge 计数显示

function TopBar() {
  const { pendingDecisionCount } = useNotificationsStore()

  const handleInboxClick = () => {
    // 进入决策收件箱后 badge 归零
    useNotificationsStore.getState().resetPendingDecisionCount()
    // 导航至决策收件箱面板
    navigateToDecisionInbox()
  }

  return (
    // ...
    // TopBar 右侧 badge 区域：
    //   pendingDecisionCount > 0 时显示数字角标
    //   点击跳转决策收件箱 + 调用 resetPendingDecisionCount()
  )
}
```

### 实现节点 Checklist（Node 8）

- [x] `workbench/src/hooks/useNotifications.ts`：`decision_requested` 事件解析后调用 `store.incrementPendingDecisionCount()`
- [x] `workbench/src/hooks/useNotifications.ts`：`token_granted` 事件解析后调用 `store.setLastTokenGranted()`
- [x] `workbench/src/store/notificationsSlice.ts`：`incrementPendingDecisionCount()` action（`pendingDecisionCount + 1`）
- [x] `workbench/src/store/notificationsSlice.ts`：`resetPendingDecisionCount()` action（`pendingDecisionCount = 0`）
- [x] `workbench/src/components/TopBar/TopBar.tsx`：读取 `pendingDecisionCount`，`> 0` 时在决策入口显示数字角标
- [x] `workbench/src/components/TopBar/TopBar.tsx`：点击决策收件箱入口时调用 `resetPendingDecisionCount()`
- [x] `workbench/src/components/TopBar/TopBar.css`：badge 数字角标样式（红色圆形，右上角定位，`font-size: 10px`）
- [x] 端到端验证：后端创建 `awaiting-decision` 任务 → SSE 推送 `decision_requested` → TopBar badge +1（≤3 秒内，无需刷新）；进入决策收件箱 → badge 归零

---

## Node 9：埋点实现

### 实现目标

将 product.md 数据埋点计划中的 v0.8 新增埋点全部写入 `ui_events` 表（v0.6 已建）。以下埋点均在后端各模块中实现，统一调用 `insert_ui_event()` 辅助函数。

### 埋点汇总

| 埋点名称 | 触发位置 | payload 字段 |
|---------|---------|-------------|
| `pre_hook_passed` | `harness/mod.rs::PreHook::run()` — 通过时 | `{ task_id, from_status, to_status, check_duration_ms }` |
| `pre_hook_blocked` | `harness/mod.rs::PreHook::run()` — 阻断时 | `{ task_id, from_status, to_status, block_reason, missing_token_type }` |
| `post_hook_executed` | `harness/mod.rs::PostHook::run()` — 执行完毕 | `{ task_id, hook_type, side_effect_type, duration_ms }` |
| `error_hook_triggered` | `harness/mod.rs::ErrorHook::run()` — 触发时 | `{ task_id, error_type, retry_count, action_taken }` |
| `error_hook_escalated` | `harness/mod.rs::ErrorHook::run()` — ≥3 次失败 | `{ task_id, final_error, decision_task_id }` |
| `sandbox_access_denied` | `sandbox/mod.rs::SandboxGuard::check_file_access()` | `{ task_id, role, requested_path, allowed_paths_count }` |
| `sandbox_write_intercepted` | `sandbox/mod.rs::SandboxGuard::intercept_direct_state_write()` | `{ task_id, role, attempted_operation }` |
| `token_granted_auto` | `decisions/handlers.rs::resolve_decision()` + `harness/mod.rs::PostHook` | `{ token_type, project, version, trigger_task_id }` |
| `token_granted_manual` | `routes/capability_tokens.rs::create_token()` | `{ token_type, project, version, granted_by: "ceo-manual" }` |
| `token_revoked` | `routes/capability_tokens.rs::revoke_token()` | `{ token_type, project, version, revoked_by, token_age_hours }` |
| `workflow_node_advanced` | `workflow/mod.rs::check_dag_advance()` — 解锁时 | `{ workflow_id, completed_task_id, unlocked_task_id, dag_depth }` |
| `workflow_blocked` | `workflow/mod.rs::check_dag_advance()` — 阻断时 | `{ workflow_id, completed_task_id, blocked_task_id, pending_deps_count }` |

### 共用辅助函数

```rust
// backend/src/db.rs 或 backend/src/utils/events.rs（新建工具模块）

pub async fn insert_ui_event(
    pool: &SqlitePool,
    event_name: &str,
    payload: serde_json::Value,
) {
    let _ = sqlx::query(
        "INSERT INTO ui_events (event_id, event_name, payload, created_at) \
         VALUES (?, ?, ?, ?)"
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(event_name)
    .bind(payload.to_string())
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(pool)
    .await;
    // 静默忽略写入失败（埋点不阻断主流程）
}
```

### 实现节点 Checklist（Node 9）

- [x] `backend/src/utils/events.rs`（新建）或 `backend/src/db.rs`：抽取 `insert_ui_event()` 共用函数，所有模块统一调用
- [x] `backend/src/harness/mod.rs`：`PreHook::run()` 中 `Proceed` 时写入 `pre_hook_passed`（含 `check_duration_ms`）
- [x] `backend/src/harness/mod.rs`：`PreHook::run()` 中 `Blocked` 时写入 `pre_hook_blocked`（含 `block_reason` 和 `missing_token_type`）
- [x] `backend/src/harness/mod.rs`：`PostHook::run()` 执行完毕时写入 `post_hook_executed`（含 `side_effect_type`：`token_granted` / `sse_notified` / `dag_advanced`）
- [x] `backend/src/harness/mod.rs`：`ErrorHook::run()` Retry 时写入 `error_hook_triggered`（含 `retry_count` 和 `action_taken: "retry"`）
- [x] `backend/src/harness/mod.rs`：`ErrorHook::run()` EscalateToHuman 时写入 `error_hook_escalated`（含 `decision_task_id`）
- [x] `backend/src/sandbox/mod.rs`：`check_file_access()` 拒绝时写入 `sandbox_access_denied`（已在 Node 1 Checklist 中要求，此处确认）
- [x] `backend/src/sandbox/mod.rs`：`intercept_direct_state_write()` 时写入 `sandbox_write_intercepted`（已在 Node 1 Checklist 中要求，此处确认）
- [x] `backend/src/decisions/handlers.rs`：Approve 时写入 `token_granted_auto`（已在 Node 3 Checklist 中要求，此处确认）
- [x] `backend/src/routes/capability_tokens.rs`：`create_token()` 写入 `token_granted_manual`（已在 Node 5 Checklist 中要求，此处确认）
- [x] `backend/src/routes/capability_tokens.rs`：`revoke_token()` 写入 `token_revoked`（含 `token_age_hours`：从 `granted_at` 到当前时刻的小时数）
- [x] `backend/src/workflow/mod.rs`：`check_dag_advance()` 解锁时写入 `workflow_node_advanced`（已在 Node 4 Checklist 中要求，此处确认）
- [x] `backend/src/workflow/mod.rs`：`check_dag_advance()` 阻断时写入 `workflow_blocked`（已在 Node 4 Checklist 中要求，此处确认）

---

## 测试清单

### 后端验收

- [x] **T1 沙盒文件访问拦截**：创建任务，`file_refs` 不含文件 X；调度器执行时请求读取文件 X → `SandboxGuard::check_file_access()` 返回 `AccessDenied`；Claude API 的 context 中不含文件 X 内容；`ui_events` 表出现一条 `sandbox_access_denied` 埋点记录（含正确 `requested_path`）

- [x] **T2 沙盒直接写入拦截**：Agent 绕过 Hook 调用 `PATCH /tasks/:id` → `intercept_direct_state_write()` 拦截；状态机 status 不变；`ui_events` 表出现 `sandbox_write_intercepted` 记录

- [x] **T3 pre-hook 令牌检查**：创建 `pending` 任务，不插入 `APPROVED` 令牌 → `PreHook::run()` 返回 `Blocked { missing_token_type: "APPROVED" }`；任务 status 保持 `pending`；`ui_events` 表出现 `pre_hook_blocked` 记录（含 `block_reason` 和 `missing_token_type`）；`/sse/notifications` SSE 流收到 `type: "task_blocked"` 事件（`SseNotification::TaskBlocked`），payload 中 `missing_token_type == "APPROVED"` 且 `block_reason` 非空

- [x] **T4 post-hook 令牌自动颁发**：决策收件箱执行 Approve → `resolve_decision()` 自动调用 `grant_capability_token()`；`capability_tokens` 表插入一条 `APPROVED` 令牌记录（`token_type="APPROVED"`, `task_id` 非空）；`ui_events` 表出现 `token_granted_auto`；SSE 流出现 `token_granted` 事件

- [x] **T5 error-hook 重试与人工介入**：模拟任务 API 调用超时三次 → `ErrorHook::run()` 前两次返回 `Retry`（间隔 30s/60s）；第三次返回 `EscalateToHuman`；`agent_tasks` 表新增一条 `awaiting-decision` 任务（`trigger_reason` 标注「人工介入请求」）；`ui_events` 出现 `error_hook_escalated` 记录（含 `decision_task_id`）

- [x] **T6 DAG 推进**：创建任务 B（`blocking_on: ["task-A-id"]`）+ 任务 A；任务 A 完成后 → `check_dag_advance("task-A-id")` 执行；任务 B 依赖全满足 → `mark_task_unblocked()` 调用；调度器下一轮轮询时接取任务 B；`ui_events` 出现 `workflow_node_advanced` 记录（`unlocked_task_id=task-B-id`）

- [x] **T7 令牌管理 API**：`GET /api/capability-tokens?project=工作台&version=v0.8&active_only=true` 返回有效令牌列表（HTTP 200，JSON 数组）；`POST /api/capability-tokens` 手动颁发一条 `DELIVERABLE` 令牌（HTTP 201，返回 `{ id }`）；`DELETE /api/capability-tokens/:id` 撤销该令牌（HTTP 204）；再次 `GET active_only=true` 列表中不含已撤销令牌；撤销后调用 `check_required_token("DELIVERABLE")` 返回 `Blocked`

### 前端验收

- [ ] **T8 令牌管理 UI**：打开 Agent 注册表 → 点击「令牌管理」标签页 → 列表正确显示当前项目令牌（类型 + 来源 + 时间 + 状态徽章）；手动颁发一条令牌（填写表单 → 确认 → 列表刷新显示新令牌）；撤销一条令牌（点击撤销 → 弹出二次确认 → 确认 → 列表刷新显示「已撤销」状态）

- [ ] **T9 决策收件箱令牌状态**：选择一条 `awaiting-decision` 任务 → 详情面板显示「令牌状态」区域（DELIVERABLE 令牌：✓ 已颁发 / ✗ 未颁发）；执行 Approve → 面板实时更新显示「APPROVED 令牌已颁发」（无需刷新，SSE 驱动，≤3 秒内）

- [ ] **T10 TopBar badge 端到端（req-020 验收）**：后端创建 `awaiting-decision` 任务 → `SseNotification::DecisionRequested` 通过 `notify_tx` 发送 → 前端 `useNotifications` 收到 `decision_requested` 事件 → TopBar badge 计数 +1（≤3 秒内，无需刷新）；进入决策收件箱点击「查看」→ badge 计数归零；后台任务 `running → completed` → 主对话消息列表不新增消息；TopBar 出现「✓ 完成」绿色 toast，3 秒后自动消失

- [ ] **T11 埋点确认**：执行 T1~T7 各操作后，查询 `ui_events` 表确认对应埋点均已写入（event_name + payload 字段正确）；`token_revoked` 埋点中 `token_age_hours` 为合理数值（≥0）；`workflow_node_advanced` 埋点中 `workflow_id` 非空

---

## 依赖声明

### 新增 Rust crate

| crate | 版本建议 | 用途 | Cargo.toml 位置 |
|-------|---------|------|----------------|
| `async-trait` | `0.1` | `HarnessHook` trait 的 `#[async_trait]` 宏 | `backend/Cargo.toml` |
| `thiserror` | `1` | `SandboxError` / `HookError` / `DagError` 派生 | `backend/Cargo.toml`（如未引入）|
| `uuid` | `1`，features=["v4"] | `insert_ui_event()` 生成 `event_id` | `backend/Cargo.toml`（如未引入）|
| `chrono` | `0.4` | 时间戳计算（`token_age_hours`、`expires_at` 比较） | `backend/Cargo.toml`（如未引入）|

> 注：`tokio`、`sqlx`、`serde_json`、`axum` 均已在 v0.7 `Cargo.toml` 中引入，无需重复添加。

### 新增后端路由

| 方法 | 路径 | handler | 说明 |
|------|------|---------|------|
| GET | `/api/capability-tokens` | `capability_tokens::list_tokens` | 令牌列表（支持过滤） |
| POST | `/api/capability-tokens` | `capability_tokens::create_token` | 手动颁发令牌 |
| DELETE | `/api/capability-tokens/:id` | `capability_tokens::revoke_token` | 撤销令牌 |

### 新增环境变量

v0.8 不新增环境变量，复用 v0.7 已有配置（`ANTHROPIC_API_KEY` / `WORKSPACE_ROOT` / `MAX_CONCURRENT_AGENTS` 等）。

### 新增前端依赖

无新增 npm 包。Zustand store 扩展、新增 Tauri 命令、新增 React 组件均使用已有依赖。

---

## 修订记录

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1 | 2026-05-20 | technical-planning-agent | 初稿，基于 v0.8 product.md（approved v2）和 v0.7 technical.md（approved v5）起草 Isolation & Control 技术规划；req-022 方案 C 实现 + 占位注释；req-023 三子系统完整节点；req-020 前端验收收尾 |
| v2 | 2026-05-20 | workbench-ceo（review 修订） | 修复 review-agent 六条 🟡：PostHook match arm 骨架补全；Node 1 AC-3 结构性满足说明；PreHook 并发配额归属声明；revoke_token 埋点代码两步查询修正；DownstreamTask.dag_depth 来源注释；新增 SseNotification::TaskBlocked variant + T3 测试断言明确化 |
| v3 | 2026-05-20 | workbench-ceo 执行助理 | 同步后端 + 前端已实现状态：Node 0-9 全部实现节点标记为 [x]；后端验收 T1-T7 标记为 [x]；前端验收 T8-T11 保持 [ ]（待 Tauri App 手动验收） |
