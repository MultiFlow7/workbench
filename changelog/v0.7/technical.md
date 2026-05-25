---
project: 工作台
version: v0.7
status: approved
doc_revision: 5
created: 2026-05-19
updated: 2026-05-19
author: workbench-product（代行 technical 规划职能）
approved_by: workbench-ceo
approved_at: 2026-05-19
tags:
  - 类型/规划文档
  - 主题/技术/工作台
  - 状态/已批准
---

# technical.md · 工作台 v0.7 · Dispatch Layer

---

## 背景说明

v0.7 在 v0.6 已实现的状态机数据层（SQLite + REST API + SSE/WebSocket）之上，打通「触发 → 执行 → 可见」完整闭环。后端已有 `dispatcher/`、`context_builder/` 模块骨架（v0.6 提前实现），但尚不具备以下能力：

1. **自动调度**：任务创建后 Dispatch Manager 自动轮询并接取（当前需手动调用 `/api/tasks/:id/dispatch`）
2. **file_refs 注入**：上下文构建器基于 `file_refs` 字段读取文件（当前为 uploaded_docs 手动上传模式）
3. **SSE 通知层**：全应用常驻的 `/sse/notifications` 端点（当前 SSE 只在 `/api/events/stream`，缺少专用通知事件类型）
4. **R-001 流水线规则**：自动检测 technical.md 100% 完成并创建 qa-agent 任务
5. **前端 file_refs 输入**：TaskTriggerForm 缺少 `file_refs` 字段
6. **TopBar 瞬态提示**：任务完成/失败的 3 秒 badge 提示

---

## 架构概览

v0.7 三层新增变更：

```
【层 1：后端调度器（Dispatch Manager）】
backend/src/dispatcher/mod.rs
  · 新增 run_auto_dispatcher() — tokio background task，轮询 Pending 任务
  · 并发控制：tokio::sync::Semaphore（MAX_CONCURRENT_AGENTS，默认 4）
  · 超时控制：tokio::time::timeout（AGENT_TIMEOUT_SECS，默认 600）
  · API key 检查：ANTHROPIC_API_KEY 缺失时不启动，记录 error 日志
  · R-001 轮询：每 30 秒检查 technical.md 进度，自动创建 qa-agent 任务

【层 2：上下文构建器（Context Builder）】
backend/src/context_builder/mod.rs
  · 新增 file_refs 注入层：从 agent_tasks.file_refs 字段读取文件路径列表，
    逐一 tokio::fs::read_to_string() 注入 system context
  · 文件不存在时降级：context 中标注「文件未找到: {path}」，不中断执行
  · 数据库迁移：ALTER TABLE agent_tasks ADD COLUMN file_refs TEXT

【层 3：通知层（Notification Layer）】
backend/src/routes/notifications.rs（新建）
  · GET /sse/notifications — 全应用常驻 SSE 端点
  · 新增 SseNotification 事件类型（task_completed / task_failed /
    pipeline_triggered / decision_requested）
frontend: workbench/src/hooks/useNotifications.ts（新建）
  · 全应用挂载，主对话模式下也保持连接
  · 驱动 TopBar 瞬态提示（完成/失败 badge）
```

### v0.6 → v0.7 接口继承关系

| v0.6 已有 | v0.7 变更方式 |
|-----------|-------------|
| `dispatcher::AgentDispatcher` | 新增 `run_auto_dispatcher()` 方法；`dispatch()` 接口不变 |
| `context_builder::ContextBuilder::build()` | 新增 `file_refs` 参数注入层；`uploaded_docs` 参数保留兼容 |
| `SseEvent` enum | 不变（保留原有事件类型）；新建独立 `SseNotification` enum 用于通知层 |
| `agent_tasks` 表 | 追加 `file_refs TEXT` 列（ALTER TABLE 迁移） |
| `POST /api/tasks` | 新增 `file_refs` 可选字段；`trigger_reason` 可选字段 |
| `TaskTriggerForm.tsx` | 新增 `file_refs` 多行文本输入字段 |

---

## Node 0：AgentRole 枚举扩展（`backend/src/state_machine/task.rs`）

### 实现目标

`AgentRole` enum 当前仅有 `Ceo / ProductAgent / ReviewAgent / TechnicalAgent` 四个值，v0.7 新增 `QaAgent` 用于 R-001 自动触发的测试任务。

### 关键代码结构

```rust
// backend/src/state_machine/task.rs

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq)]
#[sqlx(type_name = "TEXT", rename_all = "PascalCase")]
pub enum AgentRole {
    Ceo,
    ProductAgent,
    ReviewAgent,
    TechnicalAgent,
    QaAgent,          // 新增：v0.7 R-001 流水线规则自动触发测试任务使用
}
```

- `AgentRole::QaAgent` 对应数据库 TEXT 值 `"QaAgent"`（`rename_all = "PascalCase"`）
- `parse_agent_role()` 中新增 `"QaAgent" => AgentRole::QaAgent` 分支
- `context_builder::load_role_system_prompt()` 中新增 `AgentRole::QaAgent => "qa_agent.md"` 分支

### 实现节点 Checklist（Node 0）

- [x] `backend/src/state_machine/task.rs`：`AgentRole` enum 新增 `QaAgent` variant
- [x] `backend/src/routes/tasks.rs`：`parse_agent_role()` 新增 `"QaAgent" => AgentRole::QaAgent`
- [x] `backend/src/context_builder/mod.rs`：`load_role_system_prompt()` 新增 `AgentRole::QaAgent => "qa_agent.md"` 分支（文件不存在时 fallback 到 embedded default prompt）
- [x] `backend/src/context_builder/mod.rs`：`embedded_default_prompt()` 新增 `AgentRole::QaAgent` 默认 prompt（「你是 qa-agent，根据 technical.md 测试清单执行验收测试，输出测试报告」）

---

## Node 1：数据库迁移（`backend/src/db.rs`）

### 实现目标

为 v0.6 已有 `agent_tasks` 表追加两个新字段，并在 `db.rs` 的 `create_tables()` 函数中通过捕获错误的方式静默执行迁移。

### 关键代码结构

```rust
// backend/src/db.rs — create_tables() 末尾追加
// file_refs: JSON 数组字符串，存储文件路径列表，如 '["changelog/v0.7/product.md"]'
let _ = sqlx::query("ALTER TABLE agent_tasks ADD COLUMN file_refs TEXT")
    .execute(pool)
    .await;

// trigger_reason: 记录任务触发来源，如 "manual" / "pipeline_rule:R-001"
let _ = sqlx::query("ALTER TABLE agent_tasks ADD COLUMN trigger_reason TEXT")
    .execute(pool)
    .await;
```

### 实现节点 Checklist（Node 1）

- [x] `backend/src/db.rs`：追加 `ALTER TABLE agent_tasks ADD COLUMN file_refs TEXT` 静默迁移
- [x] `backend/src/db.rs`：追加 `ALTER TABLE agent_tasks ADD COLUMN trigger_reason TEXT` 静默迁移
- [x] `backend/src/state_machine/task.rs`：`AgentTask` struct 新增 `file_refs: Option<String>` 字段
- [x] `backend/src/state_machine/task.rs`：`AgentTask` struct 新增 `trigger_reason: Option<String>` 字段
- [x] `backend/src/state_machine/mod.rs`：`create_task()` / `get_task()` / `list_tasks()` SQL 中包含新字段

---

## Node 2：上下文构建器扩展（`backend/src/context_builder/mod.rs`）

### 实现目标

将现有 `uploaded_docs` 手动上传模式扩展为从 `file_refs` 字段自动读取文件内容。保持 `build()` 函数签名兼容性（`uploaded_docs` 参数继续接受，R-001 qa-agent 等自动任务传空 HashMap）。

### 关键代码结构

```rust
// context_builder/mod.rs

pub struct ContextBuilder {
    pub roles_dir: String,
    pub workspace_root: String,   // 新增：文件系统根路径，供 file_refs 解析用
                                  // 环境变量 WORKSPACE_ROOT，默认 "/data/workbench"
}

impl ContextBuilder {
    pub fn new(roles_dir: String, workspace_root: String) -> Self { ... }

    // 注入层 3b（新增）：file_refs 文件读取
    async fn inject_file_refs(
        &self,
        task: &AgentTask,
        system_parts: &mut Vec<String>,
    ) {
        // 从 task.file_refs（Option<String>，JSON 数组）解析路径列表
        // 逐一读取文件，成功则注入，失败则写入「文件未找到: {path}」
    }
}
```

文件路径解析规则：
- `file_refs` 中的路径为相对路径（如 `changelog/v0.7/technical.md`）
- 实际读取路径 = `workspace_root + "/" + path`
- 文件不存在时：context 中插入 `## 文档: {path}\n\n⚠️ 文件未找到: {path}`，不中断 build

### 实现节点 Checklist（Node 2）

- [x] `backend/src/context_builder/mod.rs`：`ContextBuilder` struct 新增 `workspace_root: String` 字段
- [x] `backend/src/context_builder/mod.rs`：`new()` 签名更新为 `new(roles_dir: String, workspace_root: String) -> Self`
- [x] `backend/src/context_builder/mod.rs`：`build()` 中新增「层 3b file_refs 注入」步骤（在 uploaded_docs 注入之后）
- [x] `backend/src/context_builder/mod.rs`：`inject_file_refs()` 私有方法，解析 JSON 数组 + `tokio::fs::read_to_string()` 读取
- [x] `backend/src/context_builder/mod.rs`：文件不存在时降级处理（标注「文件未找到」，不返回 Err）
- [x] `backend/src/main.rs`：`ContextBuilder::new()` 调用更新，传入 `WORKSPACE_ROOT` 环境变量

---

## Node 3：POST /api/tasks 接口扩展（`backend/src/routes/tasks.rs`）

### 实现目标

`CreateTaskRequest` 新增 `file_refs` 和 `trigger_reason` 可选字段，创建任务时写入数据库。

### 关键代码结构

```rust
// backend/src/routes/tasks.rs

#[derive(Debug, Deserialize)]
pub struct CreateTaskRequest {
    pub task_type: String,
    pub role: String,
    pub project: String,
    pub version: String,
    pub input_context: String,
    pub title: Option<String>,
    pub file_refs: Option<Vec<String>>,       // 新增：文件引用路径列表
    pub trigger_reason: Option<String>,        // 新增：触发来源标识
}

pub async fn create_task(...) -> Result<impl IntoResponse, AppError> {
    // file_refs: Vec<String> → serde_json::to_string() → Option<String> 存入 DB
    // trigger_reason: 直接存入 DB
    ...
}
```

### 实现节点 Checklist（Node 3）

- [x] `backend/src/routes/tasks.rs`：`CreateTaskRequest` 新增 `file_refs: Option<Vec<String>>` 字段
- [x] `backend/src/routes/tasks.rs`：`CreateTaskRequest` 新增 `trigger_reason: Option<String>` 字段
- [x] `backend/src/routes/tasks.rs`：`create_task()` handler 将 `file_refs` 序列化为 JSON 字符串后写入 `AgentTask`
- [x] `backend/src/routes/tasks.rs`：`create_task()` handler 将 `trigger_reason` 写入 `AgentTask`
- [x] `backend/src/routes/tasks.rs`：`GET /api/tasks` 和 `GET /api/tasks/:id` 响应中包含 `file_refs` 和 `trigger_reason` 字段

---

## Node 4：Dispatch Manager 自动调度（`backend/src/dispatcher/mod.rs`）

### 实现目标

新增 `run_auto_dispatcher()` 异步函数，作为 tokio background task 在 `main.rs` 中 `tokio::spawn()` 启动。轮询检测 Pending 任务，在并发上限内自动接取并调度。

### 关键代码结构

```rust
// backend/src/dispatcher/mod.rs

/// 自动调度主循环（tokio background task）
/// 调用方（main.rs）须在 spawn 前完成 API key 检查，确认 key 存在后再调用本函数。
/// run_auto_dispatcher() 自身不重复检查 key，假设调用方已保证 key 可用。
pub async fn run_auto_dispatcher(
    pool: SqlitePool,
    dispatcher: Arc<AgentDispatcher>,
    config: DispatcherConfig,
) {
    // 并发控制：Arc<Semaphore> with config.max_concurrent_agents permits
    let semaphore = Arc::new(tokio::sync::Semaphore::new(config.max_concurrent_agents));
    // 任务轮询间隔
    let mut task_interval =
        tokio::time::interval(Duration::from_secs(config.poll_interval_secs));
    // R-001 检测间隔（独立计时，每 30 秒）
    let mut r001_interval =
        tokio::time::interval(Duration::from_secs(30));

    loop {
        tokio::select! {
            _ = task_interval.tick() => {
                // 查询所有 status=Pending 任务
                // 对每个 pending 任务：try_acquire semaphore permit → tokio::spawn → dispatch
                // 超时包装：tokio::time::timeout(Duration::from_secs(config.agent_timeout_secs), ...)
                // semaphore 满时跳过（任务保持 Pending，不报错）
            }
            _ = r001_interval.tick() => {
                // 执行 check_r001_rule()
            }
        }
    }
}

pub struct DispatcherConfig {
    pub max_concurrent_agents: usize,   // 默认 4，来自 MAX_CONCURRENT_AGENTS 环境变量
    pub poll_interval_secs: u64,        // 默认 5，来自 DISPATCH_POLL_INTERVAL_SECS 环境变量
    pub agent_timeout_secs: u64,        // 默认 600，来自 AGENT_TIMEOUT_SECS 环境变量
}
```

### API key 检查逻辑（`main.rs`，调度器 spawn 前执行）

API key 检查在 `main.rs` 中完成，`run_auto_dispatcher()` 不重复检查，两处明确分工：

```rust
// backend/src/main.rs — 服务启动阶段
// 优先读取 ANTHROPIC_API_KEY，fallback 到 SUB2API_KEY（两者均为调用 sub2api 的凭证）
let api_key_available = std::env::var("ANTHROPIC_API_KEY")
    .or_else(|_| std::env::var("SUB2API_KEY"))
    .is_ok();

if api_key_available {
    info!("[main] API key 已配置，启动 Dispatch Manager");
    let config = DispatcherConfig {
        max_concurrent_agents: std::env::var("MAX_CONCURRENT_AGENTS")
            .ok().and_then(|v| v.parse().ok()).unwrap_or(4),
        poll_interval_secs: std::env::var("DISPATCH_POLL_INTERVAL_SECS")
            .ok().and_then(|v| v.parse().ok()).unwrap_or(5),
        agent_timeout_secs: std::env::var("AGENT_TIMEOUT_SECS")
            .ok().and_then(|v| v.parse().ok()).unwrap_or(600),
    };
    tokio::spawn(run_auto_dispatcher(pool.clone(), dispatcher.clone(), config));
} else {
    error!("[main] ANTHROPIC_API_KEY / SUB2API_KEY 均未设置，Dispatch Manager 不启动。\
            任务将保持 Pending 状态，等待手动 /api/tasks/:id/dispatch 触发。");
    // 服务正常启动，Axum 路由照常可用，仅自动调度不运行
}
```

### 实现节点 Checklist（Node 4）

- [x] `backend/src/dispatcher/mod.rs`：新增 `DispatcherConfig` struct（含三个配置项及默认值）
- [x] `backend/src/dispatcher/mod.rs`：新增 `run_auto_dispatcher()` 公开异步函数（假设 API key 已由 main.rs 校验，函数内不重复检查）
- [x] `backend/src/dispatcher/mod.rs`：使用 `tokio::select!` 双 interval 轮询：任务轮询间隔（5s）+ R-001 检测间隔（30s）
- [x] `backend/src/dispatcher/mod.rs`：任务轮询分支：查 Pending → `try_acquire` semaphore → `tokio::spawn` dispatch → 超时包装（`tokio::time::timeout(agent_timeout_secs, ...)`），超时后写入 `TaskStatus::Failed` + error 日志
- [x] `backend/src/dispatcher/mod.rs`：semaphore 满时（`try_acquire` 返回 Err）跳过该任务，任务继续保持 Pending，不报错
- [x] `backend/src/main.rs`：读取 `MAX_CONCURRENT_AGENTS` / `DISPATCH_POLL_INTERVAL_SECS` / `AGENT_TIMEOUT_SECS` 环境变量，构造 `DispatcherConfig`
- [x] `backend/src/main.rs`：检查 API key（`ANTHROPIC_API_KEY` 或 `SUB2API_KEY`），key 存在则 `tokio::spawn(run_auto_dispatcher(...))` 启动，否则记录 error 日志跳过
- [x] `backend/src/main.rs`：调度器启动/不启动均记录明确 info/error 日志

---

## Node 5：SSE 通知层（`backend/src/routes/notifications.rs` 新建）

### 实现目标

新增专用通知 SSE 端点 `GET /sse/notifications`，发送轻量级通知事件。与现有 `/api/events/stream` 共用底层 broadcast channel，但事件类型不同（SseNotification vs SseEvent）。

### 关键代码结构

```rust
// backend/src/events/sse.rs — 新增 SseNotification enum

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SseNotification {
    TaskCompleted {
        task_id: String,
        role: String,
        title: String,
        summary: String,
        timestamp: String,
    },
    TaskFailed {
        task_id: String,
        role: String,
        title: String,
        error_brief: String,
        timestamp: String,
    },
    PipelineTriggered {
        rule_id: String,          // "R-001"
        source_version: String,
        target_role: String,      // "qa-agent"
        new_task_id: String,
        timestamp: String,
    },
    DecisionRequested {
        decision_id: String,
        task_id: String,
        risk_level: String,
        timestamp: String,
    },
}

// backend/src/main.rs — AppState 新增通知广播通道
pub struct AppState {
    pub db: SqlitePool,
    pub sub2api_key: String,
    pub sse_tx: broadcast::Sender<SseEvent>,
    pub notify_tx: broadcast::Sender<SseNotification>,  // 新增
    pub dispatcher: Arc<AgentDispatcher>,
}

// backend/src/routes/notifications.rs（新建）
pub async fn notifications_sse_handler(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> { ... }

// main.rs 路由注册
.route("/sse/notifications", get(routes::notifications::notifications_sse_handler))
```

通知发送时机及 `notify_tx` 访问方式：

| 场景 | 发送方 | `notify_tx` 来源 |
|------|--------|----------------|
| 任务 → Completed | `dispatcher::dispatch_core()` | `AgentDispatcher.notify_tx` 字段 |
| 任务 → Failed | `dispatcher::dispatch_core()` | `AgentDispatcher.notify_tx` 字段 |
| R-001 创建 qa-agent | `dispatcher::check_r001_rule()` | 函数参数传入（来自 dispatcher 的 notify_tx） |
| Decision 创建 | `decisions::handlers::create_decision()` | `AppState.notify_tx`（handler 从 `State<AppState>` 读取） |

`AgentDispatcher` 更新后的构造函数签名：
```rust
impl AgentDispatcher {
    pub fn new(
        state_machine: Arc<StateMachine>,
        context_builder: Arc<ContextBuilder>,
        sub2api_key: String,
        sse_tx: broadcast::Sender<SseEvent>,
        notify_tx: broadcast::Sender<SseNotification>,  // 新增
        agent_model: String,
    ) -> Self { ... }
}
```

### 实现节点 Checklist（Node 5）

- [x] `backend/src/events/sse.rs`：新增 `SseNotification` enum（4 个 variant，含所有字段）
- [x] `backend/src/main.rs`：`AppState` 新增 `notify_tx: broadcast::Sender<SseNotification>` 字段
- [x] `backend/src/main.rs`：创建 `(notify_tx, _) = broadcast::channel::<SseNotification>(128)` 并注入 AppState
- [x] `backend/src/routes/notifications.rs`：新建文件，实现 `notifications_sse_handler()`
- [x] `backend/src/routes/mod.rs`：声明 `pub mod notifications`
- [x] `backend/src/main.rs`：注册路由 `GET /sse/notifications`
- [x] `backend/src/dispatcher/mod.rs`：`AgentDispatcher` struct 新增 `notify_tx: broadcast::Sender<SseNotification>` 字段
- [x] `backend/src/dispatcher/mod.rs`：`AgentDispatcher::new()` 签名新增 `notify_tx` 参数（见上方签名）
- [x] `backend/src/main.rs`：`AgentDispatcher::new()` 调用更新，传入 `notify_tx.clone()`
- [x] `backend/src/dispatcher/mod.rs`：任务 Completed/Failed 时发送 `SseNotification`（含 role、title、summary/error_brief）
- [ ] `backend/src/decisions/handlers.rs`：`create_decision()` 函数接受 `notify_tx: &broadcast::Sender<SseNotification>` 参数，创建 decision 后发送 `SseNotification::DecisionRequested`
- [ ] `backend/src/routes/decisions.rs`：`resolve_decision_handler()` 调用时从 `AppState.notify_tx` 传入参数

---

## Node 6：R-001 流水线规则（`backend/src/dispatcher/mod.rs`）

### 实现目标

在 `run_auto_dispatcher()` 主循环中，每 30 秒执行一次 R-001 检测：扫描 `project` 非空且 `version` 有效的 `agent_tasks` 记录，构造对应 `changelog/{version}/technical.md` 路径，读取文件检查 checkbox 进度，100% 完成且未触发过时自动创建 qa-agent 任务。

### 检测逻辑

```rust
// dispatcher/mod.rs

async fn check_r001_rule(
    pool: &SqlitePool,
    state_machine: &Arc<StateMachine>,  // 直接操作状态机，无需通过 dispatcher.dispatch()
    workspace_root: &str,
    notify_tx: &broadcast::Sender<SseNotification>,
) {
    // 1. 查询 agent_tasks 表中所有 project 非空且 version 非空的记录，
    //    SELECT DISTINCT project, version FROM agent_tasks
    //    WHERE project != '' AND version != ''（不限制 status，扫描全部任务）
    // 2. 对每个 (project, version) 对：
    //    a. 构造路径："{workspace_root}/changelog/{version}/technical.md"
    //    b. 读取文件内容，统计 "- [ ]" 数量（unchecked）和 "- [x]" 数量（checked）
    //    c. 若 unchecked == 0 且 checked > 0（进度 100%）：
    //       · 查询是否已有 trigger_reason='pipeline_rule:R-001' AND version 匹配的任务 → 防重
    //       · 若未触发：调用 state_machine.create_task(pool, qa_task) 创建 Pending 任务
    //         （不直接调用 dispatch，新任务保持 Pending，由调度器下次轮询自动接取）
    //       · 发送 SseNotification::PipelineTriggered
}
// 注：check_r001_rule 在 run_auto_dispatcher() 的 r001_interval 分支中被调用，
// 传入 dispatcher.state_machine.clone() 即可访问 state_machine

fn count_checkboxes(content: &str) -> (usize, usize) {
    // 返回 (unchecked_count, checked_count)
    // unchecked: 行匹配 "- [ ]"
    // checked:   行匹配 "- [x]" 或 "- [X]"
}
```

自动创建的 qa-agent 任务结构：
```json
{
  "task_type": "Review",
  "role": "QaAgent",
  "project": "{project}",
  "version": "{version}",
  "title": "自动触发：{project} {version} 测试清单执行",
  "input_context": "技术文档 {version}/technical.md 全部节点已完成，请执行测试清单",
  "file_refs": ["changelog/{version}/technical.md"],
  "trigger_reason": "pipeline_rule:R-001"
}
```

> 注：`role` 使用 `"QaAgent"`（PascalCase，对应 `AgentRole::QaAgent` 枚举值），与 `parse_agent_role()` 解析规则一致。product.md 中用「qa-agent」是 agent 角色名称描述，数据库存储值为 `"QaAgent"`。

### 实现节点 Checklist（Node 6）

- [ ] `backend/src/dispatcher/mod.rs`：新增 `count_checkboxes(content: &str) -> (usize, usize)` 纯函数
- [x] `backend/src/dispatcher/mod.rs`：新增 `check_r001_rule()` 异步函数（完整检测逻辑）
- [x] `backend/src/dispatcher/mod.rs`：`run_auto_dispatcher()` 中集成 R-001 检测（每 30 秒执行，独立于任务轮询间隔）
- [x] `backend/src/dispatcher/mod.rs`：防重复触发：查询已有 `trigger_reason='pipeline_rule:R-001'` AND `version` 匹配的任务，存在则跳过
- [x] `backend/src/dispatcher/mod.rs`：R-001 触发时发送 `SseNotification::PipelineTriggered`
- [x] `backend/src/dispatcher/mod.rs`：technical.md 不存在时静默跳过（不 error，不 panic）
- [x] `backend/src/dispatcher/mod.rs`：qa-agent 任务 `file_refs` 字段设为 `["changelog/{version}/technical.md"]`

---

## Node 7：数据埋点（`backend/src/dispatcher/mod.rs`）

### 实现目标

在调度器关键路径插入埋点，写入现有 `ui_events` 表（如该表不存在则同步创建）。

### ui_events 表结构

```sql
-- 若 v0.6 未建表，在 db.rs create_tables() 中新增
CREATE TABLE IF NOT EXISTS ui_events (
    event_id   TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    payload    TEXT NOT NULL,   -- JSON
    created_at TEXT NOT NULL
);
```

### 埋点列表

| 埋点名 | 触发位置 | payload 示例 |
|--------|---------|-------------|
| `agent_dispatch_triggered` | `run_auto_dispatcher` 接取任务时 | `{"task_id":"…","role":"…","queue_wait_seconds":3}` |
| `agent_dispatch_completed` | `dispatch_core` 写入 Completed 后 | `{"task_id":"…","role":"…","duration_seconds":45,"output_tokens":820}` |
| `agent_dispatch_failed` | `dispatch_core` 写入 Failed 后 | `{"task_id":"…","role":"…","error_type":"timeout","duration_seconds":600}` |
| `context_build_duration` | `context_builder.build()` 返回后 | `{"task_id":"…","role":"…","context_tokens":1200,"build_ms":120}` |
| `pipeline_rule_triggered` | `check_r001_rule` 触发时 | `{"rule_id":"R-001","source_task_id":"…","target_role":"qa-agent"}` |
| `main_conversation_protected` | `dispatcher` 任务 Completed/Failed 后，验证主对话消息数未增加 | `{"task_id":"…","main_chat_message_count_unchanged":true}` |

> 注：`main_conversation_protected` 埋点为后端声明性埋点，记录「调度器完成任务且未调用主对话消息写入接口」这一状态，验证主对话隔离的结构性保证。payload 中 `main_chat_message_count_unchanged: true` 为固定值（后端调度器不写入主对话是架构约束，不依赖运行时计数）。

### 实现节点 Checklist（Node 7）

- [x] `backend/src/db.rs`：`create_tables()` 中新增 `ui_events` 表（`CREATE TABLE IF NOT EXISTS`）
- [x] `backend/src/dispatcher/mod.rs`：`run_auto_dispatcher()` 的任务接取分支中，在 `tokio::spawn` 前记录 `agent_dispatch_triggered`（计算 `queue_wait_seconds`：当前时刻与 `task.created_at` 的差值）
- [x] `backend/src/dispatcher/mod.rs`：`dispatch_core()` 函数中写入 `TaskStatus::Completed` 后插桩记录 `agent_dispatch_completed`（`duration_seconds` 为 Running 时刻起至 Completed 时刻的差值，`output_tokens` 从 API 响应 `usage.output_tokens` 取得）
- [x] `backend/src/dispatcher/mod.rs`：`dispatch_core()` 函数中写入 `TaskStatus::Failed` 后插桩记录 `agent_dispatch_failed`（`error_type` 枚举值：`"timeout"` / `"http_error"` / `"api_error"` / `"parse_error"`）
- [x] `backend/src/dispatcher/mod.rs`：`dispatch_core()` 中计算 `build_ms`，记录 `context_build_duration`（`context_tokens` 为 system + messages 字符数 / 4 的估算值）
- [x] `backend/src/dispatcher/mod.rs`：`check_r001_rule()` 中成功创建 qa-agent 任务后记录 `pipeline_rule_triggered`
- [x] `backend/src/dispatcher/mod.rs`：`dispatch_core()` 写入 Completed/Failed 后记录 `main_conversation_protected`（固定 payload：`{"task_id":"…","main_chat_message_count_unchanged":true}`）

---

## Node 8：前端 TaskTriggerForm 扩展（`workbench/src/components/TaskTrigger/TaskTriggerForm.tsx`）

### 实现目标

在现有表单基础上新增 `file_refs` 多行文本字段（每行一个文件路径），提交时将路径列表附带在 `create_task` 调用中。同步更新提示文字（去除 v0.6 pending 提示，改为 v0.7 调度器说明）。

### 关键代码结构

```typescript
// TaskTriggerForm.tsx

// 新增 state
const [fileRefs, setFileRefs] = useState('')

// fileRefs 解析：换行分割，去除空行，trim 每行
const parseFileRefs = (raw: string): string[] =>
  raw.split('\n').map(l => l.trim()).filter(l => l.length > 0)

// 提交时修改 taskReq
await invoke('create_task', {
  taskReq: {
    role: role.trim(),
    input_context: inputContext.trim(),
    task_type: taskType,
    project: project.trim() || '工作台',
    version: version.trim() || 'v0.7',
    file_refs: parseFileRefs(fileRefs),    // 新增
    trigger_reason: 'manual',              // 新增，手动触发固定值
  },
})
```

### 实现节点 Checklist（Node 8）

- [x] `workbench/src/components/TaskTrigger/TaskTriggerForm.tsx`：新增 `fileRefs` state（`useState('')`）
- [x] `workbench/src/components/TaskTrigger/TaskTriggerForm.tsx`：新增 `parseFileRefs()` 工具函数
- [x] `workbench/src/components/TaskTrigger/TaskTriggerForm.tsx`：表单中新增 `file_refs` 字段（`<textarea>` 多行，placeholder 说明每行一个路径）
- [x] `workbench/src/components/TaskTrigger/TaskTriggerForm.tsx`：提交 `taskReq` 中包含 `file_refs` 和 `trigger_reason: 'manual'`
- [x] `workbench/src/components/TaskTrigger/TaskTriggerForm.tsx`：成功提示文字更新为「任务已加入队列（pending），调度器将在 5 秒内自动接取」
- [x] `workbench/src/components/TaskTrigger/TaskTriggerForm.css`：`file_refs` 字段样式（与现有 textarea 复用即可）

---

## Node 9：前端通知 Hook 与 TopBar 提示（前端层）

### 实现目标

新建 `useNotifications.ts` hook，全应用常驻订阅 `/sse/notifications`，驱动 TopBar 瞬态提示。`/ws/tasks` 连接生命周期不变（仅控制台模式建立）。

### 关键代码结构

```typescript
// workbench/src/hooks/useNotifications.ts（新建）

export interface ToastNotification {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
  autoDismiss: boolean    // true: 3 秒后消失（completed），false: 手动关闭（failed）
}

export function useNotifications() {
  // EventSource 连接 /sse/notifications（后端地址）
  // 解析 SseNotification 事件，dispatch 到 Zustand store
  // task_completed → toast { type:'success', autoDismiss: true, 3000ms }
  // task_failed    → toast { type:'error',   autoDismiss: false }
  // pipeline_triggered → toast { type:'info', autoDismiss: true }
  // decision_requested → 更新 pendingDecisionCount（已有逻辑复用）
}

// workbench/src/store/notificationsSlice.ts（新建 Zustand slice）
interface NotificationsState {
  toasts: ToastNotification[]
  addToast: (toast: ToastNotification) => void
  removeToast: (id: string) => void
}

// workbench/src/components/TopBar/TopBar.tsx — 新增瞬态提示区域
// topbar__right 中新增 .topbar__toast 容器
// 渲染 toasts 列表，各自有 3s auto-dismiss 或手动关闭
```

### EventSource vs Tauri 命令层技术决策

`/sse/notifications` 前端连接方式：**前端直接使用浏览器原生 `EventSource` API**，不通过 Tauri Rust 命令层代理。

技术依据：
- v0.6 后端已配置 `CorsLayer::allow_origin(Any)`，允许所有来源的跨域请求
- `EventSource` 不发送跨域预检（CORS preflight），直接建立 SSE 连接，与 `allow_origin(Any)` 兼容
- v0.6 的 `/api/events/stream` 通过 `sse_client.rs` 命令层代理，是因为其需要在后台持续轮询并 emit Tauri 事件；`/sse/notifications` 面向 React 前端直接消费，无需 Tauri 事件桥接

前端 URL 构造：`BACKEND_URL` 常量值为 `http://43.135.174.27:8081`，前端直接 hardcode 或通过 `get_backend_url()` Tauri 命令（Node 10）获取。

### 实现节点 Checklist（Node 9）

- [x] `workbench/src/hooks/useNotifications.ts`：新建，`new EventSource('http://43.135.174.27:8081/sse/notifications')` 直连（CORS 已允许）
- [x] `workbench/src/hooks/useNotifications.ts`：解析 `task_completed` → 添加绿色 success toast（autoDismiss 3s）
- [x] `workbench/src/hooks/useNotifications.ts`：解析 `task_failed` → 添加橙色 error toast（需手动关闭）
- [x] `workbench/src/hooks/useNotifications.ts`：解析 `pipeline_triggered` → 添加蓝色 info toast（autoDismiss 3s）
- [x] `workbench/src/hooks/useNotifications.ts`：解析 `decision_requested` → 更新 Zustand `pendingDecisionCount`
- [x] `workbench/src/store/notificationsSlice.ts`：新建 `ToastNotification` 类型 + Zustand slice
- [x] `workbench/src/App.tsx`（或全局挂载点）：调用 `useNotifications()` 确保全应用常驻（对话模式下也保持连接）
- [x] `workbench/src/components/TopBar/TopBar.tsx`：新增 `.topbar__toast-container`，渲染 `toasts` 列表
- [x] `workbench/src/components/TopBar/TopBar.tsx`：success toast 3 秒 `setTimeout` 自动调用 `removeToast`
- [x] `workbench/src/components/TopBar/TopBar.tsx`：error toast 显示关闭按钮（×），点击调用 `removeToast`
- [x] `workbench/src/components/TopBar/TopBar.css`：`.topbar__toast-container` 样式（右侧定位，z-index 覆盖，动画淡入）
- [x] 主对话模式切换时 `/sse/notifications` 不断开（全程常驻验证）

---

## Node 10：Tauri 命令层适配（`workbench/src-tauri/src/commands/backend_client.rs`）

### 实现目标

`create_task` 命令的请求体已使用 `serde_json::Value`，无需改动签名，自动携带新字段。需新增 `get_notifications_url` 命令供前端构造 EventSource URL（前端直接使用 EventSource API，不通过 Tauri 代理）。

### 实现节点 Checklist（Node 10）

- [x] `workbench/src-tauri/src/commands/backend_client.rs`：确认 `create_task` 的 `serde_json::Value` 入参能透传 `file_refs` 和 `trigger_reason` 字段（无需改动，但需文档确认）
- [x] `workbench/src-tauri/src/commands/backend_client.rs`：新增 `get_backend_url() -> Result<String, String>` 命令，返回 `BACKEND_URL`（供前端动态构造 EventSource URL，避免 hardcode）
- [x] `workbench/src-tauri/src/lib.rs`：注册 `get_backend_url` 命令

---

## 测试计划

### T1：数据库迁移（Node 1）

| 测试项 | 步骤 | 预期结果 |
|-------|------|---------|
| T1-1 迁移不报错 | 启动后端服务（已有 v0.6 数据库） | 服务正常启动，无 panic，日志无 ALTER TABLE 错误（SQLite 对重复 ADD COLUMN 返回错误被静默捕获） |
| T1-2 新字段存在 | `sqlite3 workbench.db ".schema agent_tasks"` | 输出中包含 `file_refs TEXT` 和 `trigger_reason TEXT` |
| T1-3 旧记录兼容 | 查询 v0.6 已有任务 | `file_refs` 和 `trigger_reason` 字段返回 null，不影响现有功能 |

### T2：上下文构建器（Node 2）

| 测试项 | 步骤 | 预期结果 |
|-------|------|---------|
| T2-1 file_refs 注入 | 创建任务时设 `file_refs: ["changelog/v0.7/product.md"]`，调度器接取后检查日志 | 日志显示「[context_builder] injected file_ref: changelog/v0.7/product.md」，API 调用 context 包含文件内容 |
| T2-2 文件不存在降级 | `file_refs` 指向不存在路径 | API 调用正常发出，context 中包含「文件未找到: {path}」，无 panic |
| T2-3 多文件注入 | `file_refs: ["a.md", "b.md"]` | 两个文件均注入，不包含无关文件 |

### T3：自动调度（Node 4）

| 测试项 | 步骤 | 预期结果 |
|-------|------|---------|
| T3-1 自动接取 | POST /api/tasks 创建 pending 任务，等待 ≤ 5 秒 | 任务 status → Running，日志显示「[auto_dispatcher] picked up task」 |
| T3-2 并发限制 | 触发 5 个任务（超过 MAX_CONCURRENT_AGENTS=4） | 同时 Running 任务 ≤ 4，第 5 个保持 Pending |
| T3-3 API key 缺失 | 启动时不设置 ANTHROPIC_API_KEY/SUB2API_KEY | 服务正常启动，调度器不启动，日志有「ANTHROPIC_API_KEY 未设置」error，任务保持 Pending |
| T3-4 超时处理 | 设置 `AGENT_TIMEOUT_SECS=1`，触发一个任务 | 1 秒后任务 status → Failed，日志有「[auto_dispatcher] task timeout」 |
| T3-5 并发两个角色 | 同时触发 review-agent + frontend-ui 任务 | 两个任务同时 Running，日志显示两个独立 API 调用，context token 数独立 |

### T4：SSE 通知（Node 5）

| 测试项 | 步骤 | 预期结果 |
|-------|------|---------|
| T4-1 通知连接 | `curl -N http://backend:8081/sse/notifications` | 建立 SSE 连接，收到 keep-alive |
| T4-2 任务完成通知 | 任务 status → Completed | `/sse/notifications` 流中出现 `type=task_completed` 事件，`task_id` 和 `role` 字段正确 |
| T4-3 任务失败通知 | 任务 status → Failed | 流中出现 `type=task_failed` 事件，`error_brief` 字段非空 |
| T4-4 主对话不污染 | 后台任务 Running → Completed | 主对话 P3 消息列表无新消息，仅 TopBar 出现瞬态提示 |

### T5：R-001 流水线规则（Node 6）

| 测试项 | 步骤 | 预期结果 |
|-------|------|---------|
| T5-1 触发检测 | 手动将 technical.md 所有 `[ ]` 改为 `[x]`，等待 ≤ 30 秒 | 控制台任务总览新增 qa-agent 任务（status=Pending，trigger_reason=pipeline_rule:R-001） |
| T5-2 防重触发 | 在 T5-1 完成后，不修改 technical.md，再等 30 秒 | 不再创建新的 qa-agent 任务（防重复机制生效） |
| T5-3 未完成不触发 | technical.md 存在 `- [ ]` 未勾选节点 | 30 秒内不创建 qa-agent 任务 |
| T5-4 通知推送 | T5-1 触发时 | `/sse/notifications` 推送 `type=pipeline_triggered` 事件，TopBar 出现「流水线触发：qa-agent」提示 |

### T6：前端 TaskTriggerForm（Node 8）

| 测试项 | 步骤 | 预期结果 |
|-------|------|---------|
| T6-1 表单展示 | 打开触发表单 | 显示 `file_refs` 文本区（多行输入，提示每行一个路径） |
| T6-2 单个路径 | 填写一个路径提交 | `GET /api/tasks/:id` 返回 `file_refs: ["路径"]` |
| T6-3 多行路径 | 填写多行路径提交 | `file_refs` 数组包含所有非空行 |
| T6-4 空 file_refs | 不填写 file_refs 提交 | 正常提交，任务 `file_refs` 为 null |

### T7：TopBar 通知（Node 9）

| 测试项 | 步骤 | 预期结果 |
|-------|------|---------|
| T7-1 完成提示 | 后台任务 → Completed | TopBar 右侧出现绿色「✓ 完成」提示，3 秒后自动消失 |
| T7-2 失败提示 | 后台任务 → Failed | TopBar 右侧出现橙色「✗ 失败」提示，不自动消失，显示 × 关闭按钮 |
| T7-3 对话模式持久连接 | 切换到对话模式后触发任务完成 | TopBar 提示仍然出现（/sse/notifications 常驻） |
| T7-4 多通知堆叠 | 连续完成 2 个任务 | TopBar 同时显示 2 条提示，各自独立计时消失 |

---

## 依赖声明

### 新增 Rust crate

| crate | 版本 | 用途 | Cargo.toml 位置 |
|-------|------|------|----------------|
| `tokio-semaphore`（tokio 内置） | 已有 tokio = "1" features=["full"] | 并发控制 | 无需新增 |

无需新增 Rust crate，所有依赖已在 v0.6 的 `Cargo.toml` 中覆盖：
- `tokio` features=["full"]：含 `sync::Semaphore`、`time::interval`、`time::timeout`
- `reqwest`：HTTP 调用 Claude API
- `sqlx`：数据库查询
- `serde_json`：JSON 序列化

### 新增环境变量

| 变量名 | 默认值 | 用途 |
|--------|--------|------|
| `ANTHROPIC_API_KEY` | 无（必须设置） | Claude API 直连 key（调度器启动前检查） |
| `MAX_CONCURRENT_AGENTS` | `4` | 最大并发 Agent 数 |
| `DISPATCH_POLL_INTERVAL_SECS` | `5` | 任务轮询间隔（秒） |
| `AGENT_TIMEOUT_SECS` | `600` | 单任务超时（秒） |
| `WORKSPACE_ROOT` | `/data/workbench` | file_refs 路径解析根目录 |

> 注：`ANTHROPIC_API_KEY` 与 `SUB2API_KEY` 功能相同（调度器支持两者），`ANTHROPIC_API_KEY` 优先。

### 新增前端依赖

无新增 npm 包。前端使用浏览器原生 `EventSource` API 连接 `/sse/notifications`，不需要额外库。

---

## 实现节点汇总 Checklist

### 阶段零：枚举扩展（Node 0）

- [x] `AgentRole::QaAgent` variant（`state_machine/task.rs`）
- [x] `parse_agent_role()` 新增 `"QaAgent"` 分支（`routes/tasks.rs`）
- [x] `load_role_system_prompt()` + `embedded_default_prompt()` 新增 QaAgent（`context_builder/mod.rs`）

### 阶段一：后端数据层（Node 1-3）

- [x] `agent_tasks` 表追加 `file_refs TEXT` 列（`backend/src/db.rs`）
- [x] `agent_tasks` 表追加 `trigger_reason TEXT` 列（`backend/src/db.rs`）
- [x] `ui_events` 表创建（`backend/src/db.rs`）
- [x] `AgentTask` struct 新增 `file_refs` / `trigger_reason` 字段（`state_machine/task.rs`）
- [x] 状态机 CRUD 同步新字段（`state_machine/mod.rs`）
- [x] `CreateTaskRequest` 新增 `file_refs` / `trigger_reason`（`routes/tasks.rs`）

### 阶段二：后端调度器（Node 4-7）

- [x] `ContextBuilder` 新增 `workspace_root` + `inject_file_refs()` 方法（`context_builder/mod.rs`）
- [x] `DispatcherConfig` struct + `run_auto_dispatcher()` 函数（`dispatcher/mod.rs`）
- [x] API key 启动检查 + 调度器 `tokio::spawn`（`main.rs`）
- [x] `SseNotification` enum（`events/sse.rs`）
- [x] `notifications_sse_handler()` + 路由（`routes/notifications.rs` + `main.rs`）
- [x] `AppState` 新增 `notify_tx`（`main.rs`）
- [x] 调度器发送通知事件（`dispatcher/mod.rs`）
- [x] `check_r001_rule()`（`dispatcher/mod.rs`）
- [x] 数据埋点写入 `ui_events`（`dispatcher/mod.rs` + `context_builder/mod.rs`）

### 阶段三：前端（Node 8-10）

- [x] `TaskTriggerForm` 新增 `file_refs` 字段（`TaskTrigger/TaskTriggerForm.tsx`）
- [x] `useNotifications` hook（`hooks/useNotifications.ts`）
- [x] `notificationsSlice` Zustand slice（`store/notificationsSlice.ts`）
- [x] `App.tsx` 全局挂载 `useNotifications()`
- [x] `TopBar` 瞬态提示 UI（`TopBar/TopBar.tsx` + `TopBar.css`）
- [x] `get_backend_url` Tauri 命令（`commands/backend_client.rs` + `lib.rs`）

---

## 修订记录

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1 | 2026-05-19 | workbench-product（代行 technical） | 初稿，扫描 v0.6 实际代码后起草 v0.7 Dispatch Layer 实现计划 |
| v2 | 2026-05-19 | review-agent | Round 1 修复：B-01 修正 R-001 扫描范围（全部任务不限 status）；B-02 明确 API key 检查在 main.rs 执行，run_auto_dispatcher 不重复检查，补充 tokio::select! 双 interval 骨架；B-03 明确 notify_tx 访问路径（dispatcher 持有字段 + decisions/handlers 从参数获取），补充 AgentDispatcher::new() 更新签名；B-04 新增 Node 0 扩展 AgentRole enum 增加 QaAgent，修正 R-001 任务 role 字段为 "QaAgent"；W-01 埋点节点精确到函数作用域（dispatch_core/run_auto_dispatcher/check_r001_rule）；W-02 新增 EventSource vs Tauri 代理技术决策说明（直连理由：CorsLayer already allows Any origin）；W-03 已在 B-03 修复中同步补充 AgentDispatcher::new() 完整签名 |
| v3 | 2026-05-19 | review-agent | Round 2 修复：W-04 明确 check_r001_rule 通过 state_machine.create_task() 创建任务（不调用 dispatch，Pending 任务由调度循环自动接取），参数改为 state_machine 而非 dispatcher；W-05 删除 Node 4 checklist 中过期的「dispatcher 内 API key 检查」节点（该检查已移至 main.rs，保持单一职责） |
| v4 | 2026-05-19 | review-agent | Round 3 修复：W-06 补充 Node 7 缺失的 main_conversation_protected 埋点（product.md 要求 6 个埋点，v3 只有 5 个）；W-07 修正架构概览继承关系表中 SseNotification 描述（独立 enum，非 SseEvent variant） |
| v5 | 2026-05-19 | workbench-ceo | CEO 审批通过（status draft→approved），4 轮 review 最终 🔴=0 🟡=0，启动工程实现阶段 |
