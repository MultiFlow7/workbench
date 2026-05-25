---
project: 工作台
version: v0.2
status: draft
doc_revision: 1
created: 2026-05-18
updated: 2026-05-18
---

# technical.md · 工作台 v0.2

---

## 实现概览

v0.2 最重要的技术决策是：**将状态机、调度器、上下文构建器、Harness 从 Tauri 进程中剥离，建立独立的 Rust + Axum 后端服务（:8081），Tauri 降级为薄客户端，通过 REST API + SSE 长连接与服务端协作**；前端同步新增 decisions 模式、P1 专注折叠和主对话保护三个人机协作基础模块。

---

## 目录结构变更

基于 v0.1 的 diff，v0.2 新增以下文件和目录：

```
# 全新独立后端服务（与 workbench/ 并列）
backend/
├── Cargo.toml                          # 独立 crate（非 workspace）
├── Cargo.lock
├── .env                                # SUB2API_KEY（服务器侧，不提交 git）
└── src/
    ├── main.rs                         # Axum 路由注册、AppState 初始化
    ├── db.rs                           # SQLite 连接池（sqlx + sqlite）
    ├── error.rs                        # 统一错误类型 AppError
    ├── state_machine/
    │   ├── mod.rs                      # StateMachine 结构体、公开方法
    │   ├── task.rs                     # AgentTask / TaskType / TaskStatus / DecisionRequest
    │   └── token.rs                    # CapabilityToken / TokenType
    ├── dispatcher/
    │   └── mod.rs                      # AgentDispatcher::dispatch()
    ├── context_builder/
    │   └── mod.rs                      # ContextBuilder::build()
    ├── sandbox/
    │   └── mod.rs                      # allowed_documents() 白名单逻辑
    ├── harness/
    │   └── hooks.rs                    # pre_hook_technical_intake / pre_hook_engineering_start
    ├── decisions/
    │   ├── mod.rs                      # DecisionRecord / DecisionOption / RiskLevel
    │   └── handlers.rs                 # list / get / resolve REST 处理函数
    ├── events/
    │   └── sse.rs                      # SSE 广播通道 + GET /api/events/stream 处理函数
    └── routes/
        ├── tasks.rs                    # POST/GET/PATCH /api/tasks/*
        ├── tokens.rs                   # POST/GET/DELETE /api/tokens/*
        ├── decisions.rs                # GET/POST /api/decisions/*
        └── events.rs                   # GET /api/events/stream

# Tauri 前端扩展（在 v0.1 基础上新增，不修改已有文件）
workbench/
├── src-tauri/
│   └── src/
│       └── commands/
│           ├── backend_client.rs       # 新增：REST HTTP 调用服务端（create_task / dispatch_task / resolve_decision / list_decisions / get_decision）
│           └── sse_client.rs           # 新增：SSE 订阅服务端 GET /api/events/stream，转发事件到前端
├── src/
│   ├── store/
│   │   ├── layoutSlice.ts              # 扩展：新增 pendingDecisionCount / backendOnline / selectedDecisionId / p1IconsVisible / decisions 模式
│   │   └── decisionsSlice.ts          # 新增：decisions 列表、selectedDecision、SSE 事件处理
│   ├── components/
│   │   ├── TopBar/
│   │   │   └── TopBar.tsx              # 扩展：新增 backendOnline 红点指示 + Banner 逻辑
│   │   ├── NavIcons/
│   │   │   └── NavIcons.tsx            # 扩展：新增 decisions 模式图标 + P1 专注折叠按钮 + 红色数字角标
│   │   ├── DecisionInbox/
│   │   │   ├── DecisionInbox.tsx       # 新增：P3 decisions 模式容器
│   │   │   ├── DecisionCard.tsx        # 新增：B1 卡片风格，显示来源/风险/等待时长/问题/操作按钮
│   │   │   └── DecisionCard.css
│   │   └── DecisionPanel/
│   │       ├── DecisionPanel.tsx       # 新增：P4 决策详情 + 对话区
│   │       └── DecisionPanel.css
│   └── hooks/
│       ├── useBackendSSE.ts            # 新增：封装 SSE 事件监听，派发到 store
│       └── useBackendHealth.ts         # 新增：轮询后端健康检查，更新 backendOnline
```

---

## 实现节点

---

### Node 1 · 后端服务骨架（Group A）

**范围**：`backend/Cargo.toml`、`backend/src/main.rs`、`backend/src/db.rs`、`backend/src/error.rs`

**目标**：Axum 服务启动在 :8081，SQLite 连接池就绪，所有路由占位（返回 501），可用 `curl` 验证服务可达

- [ ] 在工作台项目根目录（`01-Vibe项目区/工作台/`）创建 `backend/` 目录，`cargo init --name workbench-backend`
- [ ] `Cargo.toml` 添加依赖：`axum = "0.7"`、`tokio = { features = ["full"] }`、`sqlx = { features = ["sqlite", "runtime-tokio", "macros"] }`、`serde / serde_json`、`chrono`、`uuid = { features = ["v4"] }`、`reqwest = { features = ["json"] }`、`tokio-stream`、`tracing / tracing-subscriber`
- [ ] `db.rs`：`pub async fn init_db(db_path: &str) -> SqlitePool`，执行 `PRAGMA journal_mode=WAL;`，返回连接池
- [ ] `error.rs`：定义 `AppError` 枚举（`DbError / DispatchError / HarnessError / NotFound`），实现 `IntoResponse`
- [ ] `main.rs`：读取环境变量 `SUB2API_KEY`（缺失时 panic 提示明确），初始化连接池，注册所有路由（占位返回 `StatusCode::NOT_IMPLEMENTED`），监听 `0.0.0.0:8081`
- [ ] 服务器上创建 `/data/workbench/` 目录和 `/data/workbench/logs/`，启动后日志写入 `/data/workbench/logs/backend.log`
- [ ] `src/routes/health.rs` 实现 `GET /health` → `{"status":"ok"}`，注册到路由表（供 Node 10 `check_backend_health` 调用）
- [ ] 本地 `cargo build --release` 通过；`curl http://43.135.174.27:8081/health` 返回 `{"status":"ok"}`；`curl http://43.135.174.27:8081/api/tasks` 返回 HTTP 501

**关键类型**（`src/main.rs`）：
```rust
#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub sub2api_key: String,
    pub sse_tx: broadcast::Sender<SseEvent>,
}
```

---

### Node 2 · SQLite Schema 初始化（Group A）

**范围**：`backend/src/db.rs`，服务器 `/data/workbench/workbench.db`

**目标**：三张表（`agent_tasks` / `capability_tokens` / `decisions`）在服务启动时自动创建，`sqlite3` 命令可验证表结构

- [ ] `db.rs` 中 `init_db` 函数在连接后执行 `sqlx::migrate!` 或内嵌 SQL 建表语句
- [ ] 建表 `agent_tasks`（字段：task_id / task_type / role / status / project / version / input_context / output / blocking_on / decision_request / created_at / updated_at）
- [ ] 建表 `capability_tokens`（字段：token_id / token_type / target_id / issued_at / issued_by）
- [ ] 建表 `decisions`（字段：decision_id / task_id / agent_role / question / options / risk_level / created_at / resolved_at / resolution）；`options` 字段存 JSON TEXT（`serde_json::to_string(&vec)`），读取时用 `serde_json::from_str`（sqlx 不原生支持 Vec→JSON TEXT，需手动序列化/反序列化）
- [ ] 所有 TEXT 时间戳字段存 ISO-8601 UTC 字符串（`chrono::Utc::now().to_rfc3339()`）
- [ ] 服务重启后表已存在时不报错（`CREATE TABLE IF NOT EXISTS`）
- [ ] 验证：服务启动后 `sqlite3 /data/workbench/workbench.db ".tables"` 输出三张表名

---

### Node 3 · 状态机核心（req-013，Group A）

**范围**：`backend/src/state_machine/task.rs`、`backend/src/state_machine/token.rs`、`backend/src/state_machine/mod.rs`、`backend/src/routes/tasks.rs`、`backend/src/routes/tokens.rs`

**目标**：任务 CRUD + 状态转换 + 令牌颁发查询通过 curl 可验证

Rust 核心类型：
```rust
// state_machine/task.rs
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "PascalCase")]
pub enum TaskType { ProductPlanning, Review, Engineering, Memory }

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "PascalCase")]
pub enum AgentRole { Ceo, ProductAgent, ReviewAgent, TechnicalAgent }

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq)]
#[sqlx(type_name = "TEXT", rename_all = "PascalCase")]
pub enum TaskStatus {
    Pending, Running, Blocked, AwaitingDecision, Completed, Failed
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTask {
    pub task_id: String,
    pub task_type: TaskType,
    pub role: AgentRole,
    pub status: TaskStatus,
    pub project: String,
    pub version: String,
    pub input_context: String,
    pub output: Option<String>,          // JSON 序列化的 TaskOutput
    pub blocking_on: Option<String>,
    pub decision_request: Option<String>, // JSON 序列化的 DecisionRequest
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionRequest {
    pub question: String,
    pub options: Vec<String>,
    pub risk_level: RiskLevel,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

// state_machine/token.rs
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "PascalCase")]
pub enum TokenType { Deliverable, Approved, Mergeable }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityToken {
    pub token_id: String,
    pub token_type: TokenType,
    pub target_id: String,
    pub issued_at: String,
    pub issued_by: String,
}
```

- [ ] `StateMachine::create_task(pool, task)` → INSERT，返回 `task_id`
- [ ] `StateMachine::get_task(pool, task_id)` → SELECT，返回 `AgentTask`（不存在返回 `AppError::NotFound`）
- [ ] `StateMachine::list_tasks(pool, filter)` → SELECT WHERE 支持按 status / role / project 过滤
- [ ] `StateMachine::update_status(pool, task_id, new_status)` → UPDATE + 更新 `updated_at`，内部以 SQLite 事务执行
- [ ] `StateMachine::issue_token(pool, token_type, target_id, issued_by)` → INSERT `capability_tokens`，返回 token_id
- [ ] `StateMachine::check_token(pool, token_type, target_id)` → SELECT COUNT，返回 bool
- [ ] `StateMachine::revoke_token(pool, token_id)` → DELETE（接口实现，v0.2 无实际调用路径）
- [ ] 路由实现：`POST /api/tasks`、`GET /api/tasks`、`GET /api/tasks/{task_id}`、`PATCH /api/tasks/{task_id}/status`
- [ ] 路由实现：`POST /api/tokens`（内部调用用）、`GET /api/tokens/check`、`DELETE /api/tokens/{token_id}`（返回 200 但无副作用，v0.3 实现）
- [ ] 验证：`curl -X POST http://localhost:8081/api/tasks -d '{...}'` 返回 200 含 task_id；`GET /api/tasks/{id}` 返回完整任务；`PATCH status` 后状态更新；`GET /api/tokens/check` 令牌存在返回 `{"exists": true}`

---

### Node 4 · SSE 事件广播（Group A）

**范围**：`backend/src/events/sse.rs`、`backend/src/routes/events.rs`、`backend/src/main.rs`（AppState 注入 sse_tx）

**目标**：Tauri SSE 客户端订阅后，服务端广播事件可在客户端收到

```rust
// events/sse.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SseEvent {
    TaskStatusChanged {
        task_id: String,
        new_status: TaskStatus,
        decision_request: Option<DecisionRequest>,
    },
    DecisionCreated {
        decision_id: String,
        count: i64,
    },
    DecisionResolved {
        decision_id: String,
        count: i64,
    },
}
```

- [ ] `AppState` 中添加 `sse_tx: broadcast::Sender<SseEvent>`（`tokio::sync::broadcast`，capacity = 128）
- [ ] `GET /api/events/stream`：创建 `broadcast::Receiver`，以 `axum::response::Sse` 返回流，每个事件序列化为 `data: <JSON>\n\n` 格式
- [ ] `StateMachine::update_status` 调用后广播 `TaskStatusChanged` 事件（通过 `AppState.sse_tx.send()`）
- [ ] 心跳：每 30 秒发送 SSE comment（`: keep-alive\n\n`）防止连接超时
- [ ] 验证：`curl -N http://localhost:8081/api/events/stream`，另开终端调用 `PATCH /api/tasks/{id}/status`，SSE 流中出现 `task_status_changed` 事件

---

### Node 5 · 沙盒边界定义（req-022，Group A）

**范围**：`backend/src/sandbox/mod.rs`、`backend/src/state_machine/task.rs`（`allowed_documents` 方法）

**目标**：`AgentTask.allowed_documents()` 按任务类型返回正确白名单，context builder 拒绝白名单外路径

```rust
// sandbox/mod.rs
pub fn product_direction_path(project: &str) -> String {
    format!("01-Vibe项目区/{}/产品方向.md", project)
}
pub fn requirements_readme_path(project: &str) -> String {
    format!("01-Vibe项目区/{}/requirements/README.md", project)
}
pub fn technical_md_path(project: &str, version: &str) -> String {
    format!("01-Vibe项目区/{}/changelog/{}/technical.md", project, version)
}
```

- [ ] `AgentTask::allowed_documents()` 实现：
  - `Review` → `[self.output_path_of_product_doc()]`（product.md 路径，从 `input_context` 字段解析）
  - `ProductPlanning` → `[product_direction_path, requirements_readme_path]`
  - `Engineering` → `[technical_md_path]`
  - 其余 → `[]`
- [ ] `output_path_of_product_doc()` 辅助方法：从 `input_context` JSON 中解析 `product_doc_path` 字段
- [ ] `validate_uploaded_docs(uploaded: &HashMap<String, String>, allowed: &[String]) -> Result<(), AppError>`：检查 uploaded 中是否存在白名单外的键，存在则返回 `AppError::SandboxViolation`
- [ ] 验证：单元测试 `allowed_documents()` 三种 TaskType 返回值；白名单为空时调用 validate 不报错；白名单外路径调用报 `SandboxViolation`

---

### Node 6 · 上下文构建器（req-015，Group B）

**范围**：`backend/src/context_builder/mod.rs`，服务器 `/data/workbench/roles/` 目录（预置 4 个 role 文件）

**目标**：给定任务和 uploaded_docs，context builder 输出结构化 `ClaudePrompt`，服务端日志可见每层注入内容

```rust
// context_builder/mod.rs
#[derive(Debug, Serialize, Deserialize)]
pub struct ClaudePrompt {
    pub system: String,
    pub messages: Vec<ApiMessage>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiMessage {
    pub role: String,   // "user" | "assistant"
    pub content: String,
}

pub struct ContextBuilder {
    roles_dir: String,  // "/data/workbench/roles/"
}

impl ContextBuilder {
    pub async fn build(
        &self,
        task: &AgentTask,
        uploaded_docs: &HashMap<String, String>,
    ) -> Result<ClaudePrompt, AppError>
}
```

- [ ] 层 1 Role system prompt：从 `{roles_dir}/{role_name}.md` 读取文件（`role_name` = snake_case，如 `review_agent.md`）；`ceo-main` 不走此路径
- [ ] 层 2 Task state：序列化 `AgentTask` 的结构化摘要（task_id / type / status / version），作为 system prompt 一节
- [ ] 层 3 Relevant documents：遍历 `task.allowed_documents()`，从 `uploaded_docs` 中取值，不在 uploaded 中的路径记 `warn` 日志跳过；调用 `validate_uploaded_docs` 确保 uploaded 无白名单外文件
- [ ] 层 4 Trigger context：从 `task.input_context` JSON 解析 `trigger_reason` 字段，追加到 system
- [ ] 层 5 Memory injection：`task.input_context` 中若有 `memory_hint` 路径，从 uploaded_docs 取值注入
- [ ] 预置 4 个 role 文件：`/data/workbench/roles/review_agent.md`、`/data/workbench/roles/ceo_event.md`、`/data/workbench/roles/product_agent.md`、`/data/workbench/roles/technical_agent.md`（内容占位，v0.2 收敛阶段完善）
- [ ] 验证：单元测试模拟 Review 任务 + uploaded_docs，输出的 system prompt 仅含 review 角色和指定文档；白名单外路径不出现在 system prompt 中

---

### Node 7 · 调度器（req-014，Group B）

**范围**：`backend/src/dispatcher/mod.rs`、`backend/src/routes/tasks.rs`（`POST /api/tasks/{task_id}/dispatch`）

**目标**：调用 dispatch 后服务端日志可见独立 Claude API call，任务状态流转到 Completed，SQLite output 字段写入

```rust
// dispatcher/mod.rs
pub struct AgentDispatcher {
    pub state_machine: Arc<StateMachine>,
    pub context_builder: Arc<ContextBuilder>,
    pub http_client: reqwest::Client,
    pub sub2api_key: String,
    pub sub2api_url: String,   // "http://43.135.174.27:8080/v1/messages"
    pub sse_tx: broadcast::Sender<SseEvent>,
}

impl AgentDispatcher {
    pub async fn dispatch(
        &self,
        pool: &SqlitePool,
        task_id: &str,
        uploaded_docs: HashMap<String, String>,
    ) -> Result<String, AppError>   // 返回原始 Claude API 响应文本
}
```

- [ ] `dispatch()` 流程：
  1. `state_machine.get_task(pool, task_id)` 读取任务（NotFound 返回错误）
  2. 调用 `ContextBuilder.build(task, uploaded_docs)` 构建 prompt
  3. `state_machine.update_status(pool, task_id, Running)` + SSE 广播
  4. 调用 sub2api `POST /v1/messages`（非流式，`stream: false`，`model: claude-opus-4-5`），超时 120s
  5. 解析响应 content[0].text 为 output；若 HTTP 错误记日志并更新状态为 Failed + SSE 广播
  6. `state_machine.update_status(pool, task_id, Completed)` + 写 output 字段 + SSE 广播
  7. 触发 post-hook（根据任务 role 执行对应逻辑）：
     - **ReviewAgent 完成**：解析 output JSON 中 `passed: bool`；`passed=true` → `issue_token(Deliverable, product_md_path)` + 扫描 Blocked 任务解除（见 Node 8）；`passed=false` → 仅更新状态为 Completed
     - **任意 Agent Completed / Failed / AwaitingDecision**：调用 `trigger_ceo_event(pool, sse_tx, task)`（见下方 ceo-event 触发逻辑）

**ceo-event 自动触发逻辑**（在 `backend/src/dispatcher/mod.rs` 中实现）：

```rust
// trigger_ceo_event 是 AgentDispatcher 的方法（&self 提供 context_builder、http_client、sub2api_key）
impl AgentDispatcher {
    async fn trigger_ceo_event(&self, pool: &SqlitePool, sse_tx: &Sender<SseEvent>, finished_task: &AgentTask) {
        // 1. 创建 ceo-event 任务，input_context 注入触发事件的任务完整 output
        // 2. 调用 self.dispatch(pool, sse_tx, ceo_event_task_id, HashMap::new())
        // 3. 解析 ceo-event 输出：若包含 "decision_required: true"，
        //    调用 create_decision(pool, sse_tx, decision_record)
        //    → 写 decisions 表 + 广播 decision_created + 任务更新为 AwaitingDecision
    }
}
```

- `ceo-event` system prompt 存于服务端 `/data/workbench/roles/ceo-event.md`，由 ContextBuilder 注入
- `trigger_ceo_event` 是 `AgentDispatcher` 的方法，通过 `self.dispatch(...)` 复用现有调度逻辑，`uploaded_docs` 传空 HashMap（ceo-event 的 `allowed_documents()` 返回 `[]`，context builder 不注入文档）
- 防死循环：post-hook（step 7）触发 `trigger_ceo_event` 时检查 `finished_task.role != AgentRole::Ceo`；ceo-event 任务 role 为 `AgentRole::Ceo`，其完成时不再触发下一轮
- [ ] `POST /api/tasks/{task_id}/dispatch` 路由：从请求 body 解析 `documents: HashMap<String, String>`，以 `tokio::spawn` 异步执行 dispatch（立即返回 202 Accepted，不阻塞 HTTP 响应）
- [ ] 并发安全：`sqlx` 连接池 + SQLite WAL 模式已在 Node 1 开启，dispatch 直接并发调用
- [ ] 验证：`curl POST /api/tasks/{id}/dispatch` 返回 202；服务端日志出现 `POST http://43.135.174.27:8080/v1/messages`；`GET /api/tasks/{id}` status 流转 Pending→Running→Completed，output 字段非空

---

### Node 8 · Harness 管控层（req-023，Group B）

**范围**：`backend/src/harness/hooks.rs`、`backend/src/dispatcher/mod.rs`（post-hook 调用）

**目标**：两个 hook 在正确时机执行，令牌缺失时任务变 Blocked，令牌存在时放行

```rust
// harness/hooks.rs
#[derive(Debug, thiserror::Error)]
pub enum HarnessError {
    #[error("产品文档尚未通过 review-agent 审查，technical agent 拒绝拉取")]
    DocumentNotDelivered { path: String },
    #[error("technical.md 尚未经 CEO 审批，工程 Agent 拒绝启动")]
    NotApproved { path: String },
}

pub async fn pre_hook_technical_intake(
    pool: &SqlitePool,
    task_id: &str,          // 用于 hook 失败时更新该任务状态为 Blocked
    product_md_path: &str,
) -> Result<(), HarnessError>

pub async fn pre_hook_engineering_start(
    pool: &SqlitePool,
    task_id: &str,          // 用于 hook 失败时更新该任务状态为 Blocked
    technical_md_path: &str,
) -> Result<(), HarnessError>
```

- [ ] `pre_hook_technical_intake`：调用 `StateMachine::check_token(Deliverable, product_md_path)`；false 时调用 `StateMachine::update_status(pool, task_id, Blocked)` + `set_blocking_on(pool, task_id, "product_doc_not_delivered")`，再返回 `DocumentNotDelivered`
- [ ] `pre_hook_engineering_start`：调用 `StateMachine::check_token(Approved, technical_md_path)`；false 时调用 `StateMachine::update_status(pool, task_id, Blocked)` + `set_blocking_on(pool, task_id, "technical_not_approved")`，再返回 `NotApproved`
- [ ] Dispatcher post-hook（review 完成后）：在 `dispatch()` step 7 中，若任务 role 为 `ReviewAgent`，从 output JSON 中解析 `passed: bool`；`passed = true` 时调用 `issue_token(Deliverable, product_md_path)`，然后扫描所有 `Blocked` 任务中 `blocking_on = "product_doc_not_delivered"` 的任务，将其状态更新为 `Pending` + SSE 广播
- [ ] Dispatcher pre-hook（engineering 启动前）：在 dispatch() step 1 之后、step 3 之前，若任务 type 为 `Engineering`，调用 `pre_hook_engineering_start`；失败时直接返回错误（不继续 dispatch）
- [ ] 验证：
  - 无 DELIVERABLE 令牌时 POST /api/tasks/{review_task_id}/dispatch 完成后，技术 Agent 任务 status = Blocked
  - review-agent passed=true 后 DELIVERABLE 令牌写入 SQLite，技术 Agent 任务变 Pending，SSE 推 task_status_changed
  - 无 APPROVED 令牌时 Engineering 任务 dispatch 被拒绝，状态变 Blocked

---

### Node 9 · 决策层（req-018 后端，Group B）

**范围**：`backend/src/decisions/mod.rs`、`backend/src/decisions/handlers.rs`、`backend/src/routes/decisions.rs`

**目标**：决策 CRUD + resolve 触发令牌颁发 + SSE 推送 decision_created / decision_resolved

```rust
// decisions/mod.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RiskLevel { Low, Medium, High }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionOption {
    pub key: String,        // "approve" | "reject" | "defer"
    pub label: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionRecord {
    pub decision_id: String,
    pub task_id: String,
    pub agent_role: AgentRole,
    pub question: String,
    pub options: Vec<DecisionOption>,  // 存为 JSON TEXT
    pub risk_level: RiskLevel,
    pub created_at: String,
    pub resolved_at: Option<String>,
    pub resolution: Option<String>,
}
```

- [ ] `create_decision(pool, sse_tx, record)` → INSERT decisions，广播 `DecisionCreated { decision_id, count }`（count = 当前未解决数量）；任务同步更新为 `AwaitingDecision` 状态
- [ ] `list_decisions(pool, filter: Option<&str>)` → SELECT，filter 支持 "pending"（resolved_at IS NULL）/ "resolved" / "all"
- [ ] `get_decision(pool, decision_id)` → SELECT，不存在返回 AppError::NotFound
- [ ] `resolve_decision(pool, sse_tx, decision_id, resolution)` → 流程：
  1. UPDATE decisions SET resolved_at, resolution
  2. 读取 decision 的 task_id；查询该任务的 `input_context` 字段，从中解析 `technical_md_path`（dispatch 时以 `"technical_md_path": "..."` 注入 input_context JSON）；若 resolution = "approved"：调用 `issue_token(Approved, technical_md_path)` 并将对应 Engineering 任务从 Blocked → Pending + SSE 广播 `task_status_changed`
  3. 广播 `DecisionResolved { decision_id, count }`（count = 更新后未解决数量）
  - **`technical_md_path` 来源说明**：创建 Engineering 任务时（`POST /api/tasks`），`input_context` 字段必须包含 `{"technical_md_path": "changelog/v0.2/technical.md", ...}`；`resolve_decision` 通过 `serde_json::from_str` 从 `input_context` 中提取此路径
- [ ] 路由：`GET /api/decisions`、`GET /api/decisions/{id}`、`POST /api/decisions/{id}/resolve`
- [ ] 验证：创建决策后 SSE 收到 decision_created；resolve 后 SSE 收到 decision_resolved；decisions 表数据正确；resolution="approved" 时 APPROVED 令牌写入 capability_tokens

---

### Node 10 · Tauri HTTP Client + 后端连通（前端联调准备，Group C）

**范围**：`workbench/src-tauri/src/commands/backend_client.rs`、`workbench/src-tauri/src/main.rs`（注册新 Commands）

**目标**：Tauri Commands 成功调用服务端 REST API，可在 DevTools console 验证

```rust
// commands/backend_client.rs
const BACKEND_URL: &str = "http://43.135.174.27:8081";

#[tauri::command]
pub async fn create_task(task_req: serde_json::Value) -> Result<String, String>

#[tauri::command]
pub async fn dispatch_task(task_id: String, documents: HashMap<String, String>) -> Result<(), String>

#[tauri::command]
pub async fn list_decisions(filter: Option<String>) -> Result<Vec<serde_json::Value>, String>

#[tauri::command]
pub async fn get_decision(decision_id: String) -> Result<serde_json::Value, String>

#[tauri::command]
pub async fn resolve_decision(decision_id: String, resolution: String) -> Result<(), String>

#[tauri::command]
pub async fn check_backend_health() -> Result<bool, String>
  // GET /api/events/stream 的 HEAD 或专用 /health 端点
```

- [ ] `backend_client.rs` 中所有函数使用 `reqwest::Client`（无 tauri-plugin-http，后端调用直接用 reqwest）
- [ ] `dispatch_task` 构造请求 body `{ "documents": {...} }`，将本地文件内容以 HashMap 传入；文件读取在 Tauri Command 中使用 `std::fs::read_to_string` 完成
- [ ] `check_backend_health` 返回 bool，超时 3s，网络错误返回 false（不返回 Err）
- [ ] 注册到 `main.rs` tauri builder
- [ ] 验证：`invoke('check_backend_health')` 在 DevTools 返回 true；`invoke('list_decisions', { filter: 'pending' })` 返回数组

---

### Node 11 · Tauri SSE 客户端（Group C）

**范围**：`workbench/src-tauri/src/commands/sse_client.rs`、`workbench/src/hooks/useBackendSSE.ts`

**目标**：Tauri 订阅服务端 SSE，事件转发至前端 Tauri Event，React 通过 `useBackendSSE` hook 消费

```rust
// commands/sse_client.rs
#[tauri::command]
pub async fn start_backend_sse(app: AppHandle) -> Result<(), String>
  // 订阅 GET http://43.135.174.27:8081/api/events/stream
  // 解析每行 data: <JSON>，调用 app.emit("backend-sse", payload)
  // 连接断开时自动重连（指数退避，最大 30s）

#[tauri::command]
pub async fn stop_backend_sse(app: AppHandle) -> Result<(), String>
```

```typescript
// hooks/useBackendSSE.ts
export function useBackendSSE() {
  // 在 App.tsx 挂载时调用 invoke('start_backend_sse')
  // listen('backend-sse', handler) 根据 type 字段派发：
  //   task_status_changed → 更新 decisionsSlice
  //   decision_created    → pendingDecisionCount++
  //   decision_resolved   → pendingDecisionCount--
}
```

- [ ] Rust 侧使用 `reqwest` 的 `bytes_stream()` 逐行读取 SSE，解析 `data:` 行，emit `backend-sse` Tauri 事件（**不使用 tauri-plugin-http**；v0.1 的 stream_ai SSE 走 tauri-plugin-http 面向前端，此处是 Tauri Rust 后端主动订阅服务端，使用 `reqwest::Client` 的 `bytes_stream` 实现，与 v0.1 解析逻辑相似但完全独立）
- [ ] 断线重连：指数退避（1s → 2s → 4s → … → 30s），重连成功后发送 `{ type: "reconnected" }` 事件，useBackendSSE 收到后触发 `list_decisions` 重新拉取，校正角标数
- [ ] `useBackendSSE` hook 在 `App.tsx` 挂载时调用一次，无需在组件内重复调用
- [ ] 验证：服务端广播 `decision_created`，Tauri DevTools 可见 `backend-sse` 事件，Zustand `pendingDecisionCount` +1

---

### Node 12 · Zustand Store 扩展（Group C）

**范围**：`workbench/src/store/layoutSlice.ts`（扩展）、`workbench/src/store/decisionsSlice.ts`（新增）

**目标**：新增字段完整定义，类型检查通过，不破坏 v0.1 已有状态

```typescript
// layoutSlice.ts 扩展（在已有字段基础上新增）
interface LayoutSlice {
  // v0.1 已有
  p2Visible: boolean
  p4Visible: boolean
  currentMode: 'chat' | 'tools' | 'console' | 'decisions'  // 新增 'decisions'
  p1ListVisible: boolean
  // v0.2 新增
  pendingDecisionCount: number
  backendOnline: boolean
  selectedDecisionId: string | null
  p1IconsVisible: boolean   // true = 展开，false = 专注折叠
  // 新增 actions
  setMode: (mode: 'chat' | 'tools' | 'console' | 'decisions') => void
  setPendingDecisionCount: (n: number) => void
  incrementPendingCount: () => void
  decrementPendingCount: () => void
  setBackendOnline: (online: boolean) => void
  setSelectedDecisionId: (id: string | null) => void
  toggleP1Icons: () => void
}

// decisionsSlice.ts（新增）
interface DecisionRecord {
  decision_id: string
  task_id: string
  agent_role: string
  question: string
  options: DecisionOption[]
  risk_level: 'Low' | 'Medium' | 'High'
  created_at: string
  resolved_at: string | null
  resolution: string | null
}

interface DecisionsSlice {
  decisions: DecisionRecord[]
  loadDecisions: () => Promise<void>       // invoke('list_decisions', { filter: 'pending' })
  updateDecision: (record: DecisionRecord) => void
}
```

- [ ] `layoutSlice.ts` 新增 4 个字段初始值（`pendingDecisionCount: 0`、`backendOnline: false`、`selectedDecisionId: null`、`p1IconsVisible: true`）及对应 actions
- [ ] `currentMode` 联合类型扩展为 `'chat' | 'tools' | 'console' | 'decisions'`，`setMode` 函数签名同步更新
- [ ] `decisionsSlice.ts` 实现 `loadDecisions`（调用 `invoke('list_decisions')`，写入 decisions 数组）
- [ ] `decisionsSlice` 合并到 v0.1 已有的 `useStore`（同一个 `create<LayoutSlice & ConversationSlice & DecisionsSlice>(...)` 调用，追加 `decisionsSlice` 参数）；**不新建** 独立 `useDecisionsStore`，保持 v0.1 所有消费 `useStore` 的组件（NavIcons、ChatView、P2 等）无需改动
- [ ] `tsc --noEmit` 无报错
- [ ] 验证：DevTools 中 store 可见新字段；手动调用 `setMode('decisions')` 后 `currentMode` 正确更新

---

### Node 13 · TopBar 降级指示 + 后端健康检查（Group C）

**范围**：`workbench/src/components/TopBar/TopBar.tsx`（扩展）、`workbench/src/hooks/useBackendHealth.ts`（新增）

**目标**：服务器不可达时 TopBar 出现红点 + Banner，恢复后红点消失

```typescript
// hooks/useBackendHealth.ts
export function useBackendHealth() {
  // 每 30s 调用 invoke('check_backend_health')
  // 结果写入 layoutSlice.backendOnline
  // backendOnline false 时 setBackendOnline(false)
  // 首次变为 false 时触发 showBanner=true（通过 local state 或 layoutSlice）
}
```

- [ ] `useBackendHealth` hook 在 `App.tsx` 挂载，轮询间隔 30s（使用 `setInterval`，卸载时清理）
- [ ] `TopBar.tsx` 订阅 `backendOnline`：
  - false → 右侧服务状态区显示红色实心圆点（`background: #dc2626`，直径 8px）
  - true → 恢复 v0.1 原有三灯状态
- [ ] Banner 组件（内联在 TopBar 下方或 workspace 顶部）：首次检测到 offline 时显示，内容「工作台服务暂时不可达，请检查网络或稍后重试」，右上角 × 可关闭，关闭后不再弹出（用 `useRef` 记录已关闭，直到下次切换 online → offline 才再弹）
- [ ] `backendOnline` 从 false 恢复到 true 时，Banner 自动隐藏（无需用户操作），重置已关闭标记
- [ ] 验证：手动调用 `setBackendOnline(false)` 后 TopBar 红点出现，Banner 弹出；调用 `setBackendOnline(true)` 后恢复

---

### Node 14 · P1 角标 + decisions 模式入口（req-018 前端，Group C）

**范围**：`workbench/src/components/NavIcons/NavIcons.tsx`（扩展）、`workbench/src/components/NavIcons/NavIcons.css`（扩展）

**目标**：P1 角标响应 SSE 实时更新，点击进入 decisions 模式，P1 专注折叠可用

```css
/* 角标样式（直接追加到 NavIcons.css） */
.nav-icon-wrapper {
  position: relative;
}
.decision-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: #dc2626;
  color: #fff;
  font-size: 9px;
  font-weight: 600;
  line-height: 14px;
  text-align: center;
  pointer-events: none;
}
```

- [ ] `NavIcons.tsx` 新增 decisions 图标（可用 lucide-react `InboxIcon`），放在现有三个图标下方
- [ ] 订阅 `pendingDecisionCount`，当 > 0 时在 decisions 图标右上角渲染 `.decision-badge`
- [ ] 点击 decisions 图标 → `setMode('decisions')`，decisions 模式下图标高亮
- [ ] P1 专注折叠按钮（双击 P1 左边缘 或 单击 P1 底部专注按钮）：切换 `p1IconsVisible`；`p1IconsVisible = false` 时**仅收起 NavIcons 52px 条**（`#p1-icons` width → 0），P1-List（200px）的展开/收起状态由 `p1ListVisible` 独立控制，两者互不干扰；P3 在 NavIcons 收起后额外获得 52px 宽度；角标在折叠时隐藏（不影响 count 值，恢复展开后重新渲染）
- [ ] 验证：`incrementPendingCount()` 后角标出现数字；点击 decisions 图标 `currentMode` 变 decisions；专注折叠后 NavIcons 不可见，P3 宽度扩展

---

### Node 15 · 决策收件箱 UI（req-018 前端，Group C）

**范围**：`workbench/src/components/DecisionInbox/DecisionInbox.tsx`、`DecisionCard.tsx`、`workbench/src/components/DecisionPanel/DecisionPanel.tsx`、`workbench/src/store/layoutSlice.ts`（`setSelectedDecisionId` 调用）

**目标**：decisions 模式 P3 卡片列表可用，点击卡片 P4 展开决策详情

**DecisionCard 结构（B1 卡片风格）**：
```typescript
// components/DecisionInbox/DecisionCard.tsx
interface DecisionCardProps {
  decision: DecisionRecord
  selected: boolean
  onSelect: (id: string) => void
  onResolve: (id: string, resolution: string) => void
}
// 卡片布局（上→下）：
// [来源 Agent tag（蓝色 pill）] [风险等级 badge（HIGH=red/MEDIUM=orange/LOW=gray）] [等待时长]
// 问题描述（2行 line-clamp）
// [操作按钮行：批准 / 拒绝 / 延迟]（仅 options 中存在的选项）
```

- [ ] `DecisionInbox.tsx`：`currentMode === 'decisions'` 时渲染；调用 `loadDecisions()` 拉取待处理决策；按风险排序（HIGH → MEDIUM → LOW，同等级按 created_at 升序）；空状态显示「暂无待处理决策」
- [ ] `DecisionCard.tsx`：来源 Agent tag 蓝色 pill（`background: #dbeafe; color: #1d4ed8`）；风险 badge 按 level 色；等待时长用 `formatDistanceToNow`（date-fns）；直接决策按钮点击调用 `resolve_decision`
- [ ] 点击卡片（非按钮区域）→ `setSelectedDecisionId(decision_id)` + `setP4Visible(true)` → P4 渲染 DecisionPanel
- [ ] `DecisionPanel.tsx`（P4 内容）：
  - 上方：来源 Agent / 问题全文 / risk_level / created_at
  - 中间：对话区（`DecisionChat`）— 独立消息列表 + 输入框
  - 下方：操作按钮区（与 DecisionCard 按钮相同，冗余但独立）
- [ ] `DecisionChat`：消息列表使用 local state（不写 Zustand，决策处理完成后丢弃）；发送时调用 `invoke('stream_ai', { messages, system: decisionSystemPrompt })`（复用 v0.1 stream_ai）；`decisionSystemPrompt` 为**独立最小化 system prompt**，仅包含：① CEO 角色简要定义（3-5 行，硬编码字符串常量 `CEO_DECISION_ROLE_PROMPT`）② 当前 DecisionRecord JSON 全文；**严禁**注入任务状态摘要（`list_tasks` 返回值）或 ceo-main 的任何其他上下文——`buildSystemPrompt()` 主对话构建函数不参与此处，两者完全隔离
- [ ] **对话辅助决策流**（在 `DecisionChat` 中实现）：
  - **映射到已有选项**：AI 回复指向某个 option.key 时，对话区底部高亮对应操作按钮，用户点击 → `resolve_decision(decision_id, option.key)`
  - **自由输入自定义 resolution**：对话区底部提供「自定义决策…」展开输入框（`customResolutionInput`，初始隐藏）；用户在输入框填写自定义结论描述后点击「提交给 CEO 确认」→ 将用户输入内容追加到对话，以 `"请确认我的决策：[用户输入]"` 格式发送给 CEO → CEO 回复摘要「我理解你的决策是：[X]，是否确认？」 → 回复末尾出现「确认」按钮（前端检测回复文本中含「是否确认？」时渲染）→ 用户点击「确认」→ `resolve_decision(decision_id, customResolutionText)`（`customResolutionText` = 用户输入的原始文本）
  - **不确认**：用户继续输入修改意图 → 重新发送对话，循环直至确认
- [ ] 决策处理完成后 SSE decision_resolved 到来：从 `decisions` 列表移除该条，`selectedDecisionId` 清空，P4 收回
- [ ] 验证：P3 切 decisions 模式后渲染卡片；点击卡片 P4 展开详情；对话区可发送消息；点击操作按钮后 `resolve_decision` 调用成功，角标 -1

---

### Node 16 · 主对话保护（req-020，Group C）

**范围**：`workbench/src/components/ChatView/ChatView.tsx`（扩展）、`workbench/src/store/conversationSlice.ts`（扩展）

**目标**：后台任务完成不打断主对话，CEO 主对话 context 包含任务状态摘要但不含执行日志

- [ ] `conversationSlice.ts` 新增 `pendingBackendEvents: SseEvent[]`（暂存队列）+ `isUserInputting: boolean`（用户正在输入标记）
- [ ] `ChatView.tsx`：input onChange 时设 `isUserInputting = true`；消息发送后（invoke stream_ai 调用前）清空 `pendingBackendEvents`（丢弃暂存），设 `isUserInputting = false`
- [ ] `useBackendSSE.ts` 中 `task_status_changed` 事件处理：若 `isUserInputting = true`，push 到 `pendingBackendEvents` 暂存；否则正常更新 decisionsSlice
- [ ] CEO 主对话 system prompt 扩展（在 `ChatView.tsx` 的 `buildSystemPrompt()` 中）：发送前分别调用 `invoke('list_tasks', { filter: 'Pending' })`、`invoke('list_tasks', { filter: 'Running' })`、`invoke('list_tasks', { filter: 'Blocked' })`、`invoke('list_tasks', { filter: 'AwaitingDecision' })` 并合并结果，获取所有活跃任务摘要（Node 3 `GET /api/tasks` 的 filter 参数支持单个 status 值）；拼接「当前任务状态：[task_id role status version 数组]，待决策 N 项」到 system prompt 末尾；**不包含** task.output 详细内容
- [ ] 验证：
  - 主对话进行中（streaming）后台 task_status_changed SSE 到来，P3 对话流无新消息插入
  - 用户发送消息时 system prompt 含任务摘要（Tauri 日志验证），不含 output 字段内容
  - 用户询问「有什么在跑」时，CEO 回复包含任务状态摘要

---

## 测试清单

### 后端单元测试

- [ ] `StateMachine::create_task` → `get_task` 往返序列化一致（所有枚举值）
- [ ] `StateMachine::update_status(Running)` 后再 `update_status(Completed)` 成功；`update_status(Running)` 后 `update_status(Pending)` 也成功（v0.2 不限制状态回退，留 v0.3 校验）
- [ ] `StateMachine::issue_token` → `check_token` 返回 true；`check_token` 对不存在的令牌返回 false
- [ ] `AgentTask::allowed_documents()` 三种 TaskType 返回值测试（Review / ProductPlanning / Engineering）
- [ ] `validate_uploaded_docs` 白名单内通过，白名单外返回 `SandboxViolation`
- [ ] `ContextBuilder::build()` 输出的 system 包含 role system prompt 文本，不包含白名单外文档内容
- [ ] `pre_hook_technical_intake` 在 `check_token(Deliverable)` 为 false 时返回 `HarnessError::DocumentNotDelivered`
- [ ] `pre_hook_engineering_start` 在 `check_token(Approved)` 为 false 时返回 `HarnessError::NotApproved`
- [ ] `resolve_decision(resolution="approved")` 后 `capability_tokens` 表写入 APPROVED 令牌，对应 Engineering 任务 status 从 Blocked 变 Pending
- [ ] 两个并发 dispatch 请求写入时，SQLite 无事务冲突（并发写入测试，`tokio::join!` 两个 dispatch）

### 前端集成测试

- [ ] `invoke('check_backend_health')` 服务在线时返回 true，服务不可达时返回 false（不抛异常）
- [ ] `useBackendSSE` 收到 `decision_created` 后 `pendingDecisionCount` +1
- [ ] `useBackendSSE` 收到 `decision_resolved` 后 `pendingDecisionCount` -1
- [ ] `loadDecisions()` 后 `decisions` 数组按 HIGH→MEDIUM→LOW 排序
- [ ] `DecisionChat` 发送消息后 `stream_ai` 被调用，system prompt 包含 DecisionRecord JSON 全文、不包含任务状态摘要（验证方式：在 `DecisionChat` 发送函数处打断点或添加 `console.log(decisionSystemPrompt)`，确认字符串中无 `task_id` 字段，含 `decision_id` 字段；或在 Tauri 后端 `stream_ai` command 入口处打印 system 参数前 200 字符）
- [ ] 决策对话内容不出现在主对话 `currentPath` 历史中（QA 目录无新文件生成）
- [ ] `setMode('decisions')` 后 P3 渲染 DecisionInbox，P4 收起（`selectedDecisionId` 重置为 null）

### 端到端集成测试

- [ ] 完整两跳流：`invoke('create_task')` 创建 ProductPlanning 任务 → `invoke('dispatch_task')` → SSE task_status_changed Running → Completed → review-agent 任务自动创建并 dispatch → review passed → DELIVERABLE 令牌写入 → technical-agent Blocked 解除为 Pending → SSE 全程推送，P3 主对话无新消息
- [ ] 决策路径：technical-agent 完成 → ceo-event dispatch → decisions 表写入 → SSE decision_created → P1 角标 +1 → 用户点击批准 → APPROVED 令牌写入 → Engineering 任务 Pending → SSE task_status_changed
- [ ] 隔离验证：review-agent `passed=false` 时 DELIVERABLE 令牌不写入，technical-agent 保持 Blocked
- [ ] 降级验证：停止后端服务 → `check_backend_health` 返回 false → `backendOnline=false` → TopBar 红点出现 + Banner 弹出；本地 `invoke('list_qa_atoms')` / `invoke('read_qa_atom')` / `invoke('write_qa_atom')` 调用成功，无异常

---

## 验收检查

对照 product.md 验收标准的技术侧验证方法：

### req-013 状态机

| product.md 验收条目 | 技术验证方法 |
|-------------------|------------|
| POST /api/tasks 后 SQLite 表存在记录 | `sqlite3 workbench.db "SELECT * FROM agent_tasks WHERE task_id='...'"`|
| 状态 Pending→Running→Completed 流转可验证 | `GET /api/tasks/{task_id}` 三次轮询 status 字段 |
| 并发写入无数据错误 | `tokio::join!` 两个 dispatch 调用后服务端日志无 `SQLITE_BUSY` |
| DELIVERABLE 令牌后 check 返回 true | `GET /api/tokens/check?token_type=Deliverable&target_id=...` 返回 `{"exists":true}` |
| 状态变更后 SSE 推送 | `curl -N /api/events/stream` 订阅后触发 PATCH status，终端收到事件 |

### req-014 多 Agent 调度

| product.md 验收条目 | 技术验证方法 |
|-------------------|------------|
| 两次独立 Claude API 请求 | 服务端日志 grep `POST.*v1/messages` 出现两条不同 task_id |
| review-agent system prompt 不含 product-agent 执行过程 | 服务端日志中 context_builder 输出 JSON，review 层无 product output 字段 |
| 并发运行各自状态正确 | `GET /api/tasks` 过滤 status=Running 返回两条记录 |
| Tauri 进程无 Agent dispatch KEY | Tauri 日志 grep `SUB2API_KEY` 确认只出现在 stream_ai 的 main SSE，不出现在 backend_client |

### req-015 上下文构建器

| product.md 验收条目 | 技术验证方法 |
|-------------------|------------|
| review-agent context 仅含白名单文档 | 服务端日志 context_builder 输出 debug，system 字段只包含 review system prompt + product.md 内容 |
| allowed_documents 白名单外拒绝 | 单元测试通过（Node 6 验证项） |
| dispatch 请求 documents 字段含白名单文件 | Tauri 侧日志打印 dispatch request body（dev 模式下 trace log）|

### req-022 沙盒

| product.md 验收条目 | 技术验证方法 |
|-------------------|------------|
| review-agent dispatch 后只有 SQLite 更新 | `find /data/workbench/ -newer workbench.db -type f` 无新文件 |
| output 槽仅 review_report + passed | `GET /api/tasks/{id}` 的 output 字段 JSON parse 只含这两个 key |
| allowed_documents 为空时无文件注入 | 服务端日志出现 `[context_builder] skipped: no allowed documents` |

### req-023 Harness

| product.md 验收条目 | 技术验证方法 |
|-------------------|------------|
| 无 DELIVERABLE 令牌时 technical Blocked | `GET /api/tasks/{technical_task_id}` status=Blocked, blocking_on="product_doc_not_delivered" |
| review 通过后 DELIVERABLE 写入，Blocked 解除 | `sqlite3 "SELECT * FROM capability_tokens WHERE token_type='Deliverable'"` 有记录；technical 任务 status=Pending |
| 无 APPROVED 令牌工程 Agent 被拒绝 | 服务端日志 `HarnessError::NotApproved`；`GET /api/tasks/{eng_task_id}` status=Blocked |
| CEO 批准后 APPROVED 令牌写入，工程 Agent Running | `sqlite3 "SELECT * FROM capability_tokens WHERE token_type='Approved'"` 有记录；任务 status=Running |

### req-018 决策收件箱

| product.md 验收条目 | 技术验证方法 |
|-------------------|------------|
| AwaitingDecision 时 SSE decision_created + 角标 | React DevTools 检查 `pendingDecisionCount`，Network 可见 backend-sse 事件 |
| decisions 模式 B1 卡片列表 HIGH→MEDIUM→LOW | Chrome 截图对比，排序单元测试 |
| 点击 DecisionCard P4 展开 | E2E：click card → `selectedDecisionId` 非 null → P4 visible |
| 直接决策后角标 -1 | `pendingDecisionCount` 减少，`decisions` 表 resolved_at 非空 |
| 对话辅助决策后 CEO 确认摘要再写入 | P4 对话区可见确认摘要消息；resolve_decision 在用户确认后才调用 |
| 决策对话不进主对话 | QA 目录新文件数量无增加；`currentPath` 不包含决策消息 |
| P1-Icons 专注折叠 | `p1IconsVisible=false` 后 NavIcons 宽度为 0，P3 flex-1 宽度扩展 |

### req-020 主对话保护

| product.md 验收条目 | 技术验证方法 |
|-------------------|------------|
| 后台任务完成不追加主对话消息 | 监听 task_status_changed 期间 `currentPath` 长度不变 |
| CEO system prompt 不含后台执行日志 | Tauri 日志打印 system prompt，grep 确认无 `output` 字段内容 |
| 用户询问时 CEO 包含任务摘要 | 手动发送「有什么在跑」，回复中出现 task_id + status |
| 主对话进行时后台事件暂存 | 触发 streaming 时从服务端广播事件，`pendingBackendEvents` 长度 +1，P3 无新消息 |

---

## 修订记录

| 版本 | 日期 | 变化 |
|------|------|------|
| doc_revision 1 | 2026-05-18 | 初稿，16 个实现节点，4 组（后端基础 A / 后端核心 B / 前端联调 C / 集成验收在测试清单） |
| doc_revision 2 | 2026-05-18 | review-agent 修复（12 项）：① Node 1 补 /health 端点；② Node 2 decisions.options JSON 手动序列化说明；③ Node 8 hook 函数签名补 task_id 参数；④ Node 9 resolve_decision 中 technical_md_path 来源（从 input_context JSON 提取）；⑤ Node 7 补 ceo-event 自动触发逻辑（trigger_ceo_event + 防死循环）；⑥ Node 16 list_tasks 过滤参数改为多次调用合并；⑦ Node 15 DecisionChat system prompt 隔离约束明确（独立最小化，禁止注入任务摘要）；⑧ Node 15 补自由输入 custom resolution 完整子流程；⑨ Node 12 Zustand store 合并方式明确（追加到已有 useStore，不新建）；⑩ Node 14 p1IconsVisible 折叠范围明确（仅 NavIcons 52px，不影响 NavList）；⑪ Node 11 SSE 客户端措辞修正（reqwest bytes_stream，不复用 tauri-plugin-http）；⑫ 测试清单 DecisionChat system prompt 补充具体验证手段 |
| doc_revision 3 | 2026-05-18 | review-agent 修复（2 项）：① Node 10 删除与 Node 1 重复的 /health 定义步骤；② trigger_ceo_event 改为 AgentDispatcher 方法（补 &self，通过 self.dispatch 复用调度逻辑，uploaded_docs 传空 HashMap，防死循环条件说明） |
