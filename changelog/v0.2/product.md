---
project: 工作台
version: v0.2
status: draft
doc_revision: 6
created: 2026-05-18
updated: 2026-05-18
author: workbench-product
---

# product.md · 工作台 v0.2

---

## 版本背景与目标

### 版本方向

**v0.2 的目标是建立 Agent 协作的后端最小可行基础设施。**

v0.1 完成了「看」「选」「切」三个核心动作，建立了四面板 Tauri 桌面应用骨架和对话模式完整闭环。v0.2 建立 Agent 协作的后端基础设施：将真实的多 Agent 调度机制、持久化任务状态机、上下文构建层、沙盒隔离、Harness 管控门控迁移至独立的远程后端服务；同时在前端侧引入决策收件箱和主对话保护两个人机协作基础模块。

**v0.2 架构关键转变**：状态机、调度器、Harness 从本地 Tauri 进程迁移至独立后端服务（Rust + Axum，部署在 `43.135.174.27`）。Tauri 应用降级为**薄客户端**：负责本地文件读写、主对话流式推送、前端 UI 渲染，以及调用后端服务的 REST API / 订阅后端 SSE 事件流。Agent dispatch（Claude API 调用）在服务端执行，dispatch 使用的 SUB2API_KEY 仅存服务器端；Tauri 进程保留一个独立 KEY，专用于主对话流式调用（stream_ai 路径不变）。

这是产品方向中「后端逻辑 AI first」的第一个里程碑：Agent 有了真正隔离的执行环境，状态外化到确定性代码层，不再依赖 LLM 自律。用户则通过决策收件箱和主对话保护获得「管理 AI 团队而不被 AI 打断」的基础体验。

### 选取理由

- **可演示**：v0.2 结束时，用户可以观察到：product-agent 触发 review-agent 进行文档审查，审查通过后 Harness 颁发令牌，technical-agent 的 intake 凭此令牌拉取文档；整个过程通过 P1 角标和决策收件箱呈现，主对话不受干扰。这是可感受的完整新闭环。
- **可独立**：即便 v0.3 的多层级可视化和完整流水线未到来，v0.2 已经能可靠地运行两跳 Agent 流（product → review → technical），并结构性地保护主对话。
- **可依赖**：状态机、上下文构建器、沙盒边界是 v0.3 全流水线编排的地基。不先建稳，v0.3 会垮在依赖模糊上。

### 版本边界

**本版本做**：
- req-013：Agent 任务状态机（服务端 SQLite 持久化）
- req-014：真实多 Agent 调度（服务端独立 API call，隔离实例，不角色扮演）
- req-015：Agent 上下文构建器（Push-based，角色裁剪，服务端实现）
- req-022：Agent 沙盒（读写边界定义，服务端强制白名单隔离）
- req-023：Harness 管控层（仅 2 个最关键 hook：产品文档审查通过门 + technical 审批门，服务端中间件实现）
- req-018：决策收件箱（基础版：后台 Agent 决策请求队列化存储 SQLite，SSE 推送 P1 角标，决策列表视图）
- req-020：主对话保护（CEO Agent 双模式：主对话响应 vs 事件响应，上下文分开）

**本版本不做**：
- req-016：多层级可视化（需要状态机基础设施先建好，推 v0.3）
- req-017：Agent 执行流视图（依赖可视化层，推 v0.3）
- req-019：完整流水线触发规则（v0.2 只实现 2 个关键 hook，完整 DAG 引擎推 v0.3）
- req-021：记忆 Agent（CEO 单独处理，与本版后端重构不绑定）
- P4 编辑模式（v0.1 遗留 backlog，未变）
- 对话分叉操作（v0.1 遗留 backlog，未变）
- 对话目录配置 UI（v0.1 遗留 backlog，未变）
- 多工作区 Tab（v0.3）
- 控制台模式（v0.3）

---

## 版本需求范围

| ID | 需求 | 优先级 | 说明 |
|----|------|--------|------|
| [req-013](../../requirements/req-013-agent-task-state-machine.md) | Agent 任务状态机（服务端） | high | 所有 Agent 协作的共享状态基础，含权限令牌管理，SQLite 持久化 |
| [req-014](../../requirements/req-014-true-multi-agent-dispatch.md) | 真实多 Agent 调度（隔离实例） | high | 服务端独立 Claude API call，通过状态机通信，不角色扮演 |
| [req-015](../../requirements/req-015-context-builder.md) | Agent 上下文构建器 | high | 服务端 Push-based，按角色裁剪注入 context，文件内容由 Tauri 随 dispatch 上传 |
| [req-022](../../requirements/req-022-agent-sandbox.md) | Agent 沙盒（隔离执行环境） | high | 服务端强制白名单，结构性隔离，不靠行为约束 |
| [req-023](../../requirements/req-023-harness-layer.md) | Harness 管控层（2 个关键 hook） | high | 产品文档审查通过门 + technical 审批门，服务端 Axum 中间件实现 |
| [req-018](../../requirements/req-018-decision-inbox.md) | 决策收件箱（基础版） | high | 后台决策请求队列化 SQLite，SSE 推送，P1 角标，决策列表视图 |
| [req-020](../../requirements/req-020-main-conversation-isolation.md) | 主对话保护 | high | CEO Agent 双模式，上下文分开，主对话不受后台打断 |

---

## 需求冲突与衍生

### 依赖关系（非冲突，执行顺序约束）

- **req-013 是地基**：req-014、req-015、req-022、req-023 全部依赖状态机先实现。状态机不完成，其余需求无法有意义地开发。
- **req-015 依赖 req-013 + req-022**：上下文构建器需要从状态机读任务状态，需要从沙盒定义读取允许注入的文件范围，两者先到位，构建器才能实现完整逻辑。
- **req-023 依赖 req-013 + req-014 + req-015**：Harness hook 挂在状态机转换点上，需要调度器和上下文构建器都工作后才有意义验证。
- **req-018 依赖 req-013**：决策收件箱本质是状态机中 `awaiting-decision` 状态的前端展示。状态机设计时需预留 `decision_request` 字段。
- **req-020 依赖 req-014**：CEO Agent 的双模式是多 Agent 调度在 CEO 角色上的具体实例化，依赖调度器的模式区分机制。

### 冲突

- **req-014 与 req-020 的 CEO 角色复用**：CEO 在主对话模式和事件响应模式下被调用，共享同一 Agent 定义但上下文不同。潜在混淆点是：两种模式的产出应写到不同目的地（主对话 vs 状态机 + 收件箱）。裁决：调度器根据触发来源（用户消息 vs 后台事件）选择不同的 context 包和输出路由，CEO Agent 本身无感知，见 req-020 功能设计。
- 其余需求之间无阻断性冲突。

### 衍生需求（处置）

1. **前端任务状态实时更新**：req-013 要求「任务状态变更时触发事件，前端实时更新可视化」，但 v0.2 不做多层级可视化（req-016 推 v0.3）。处置：v0.2 状态机变更后，服务端通过 SSE 事件流推送 `task_status_changed` 事件，Tauri 前端订阅后只更新 P1 决策角标（req-018 入口），不渲染任务树状态。任务状态变更事件接口预留，v0.3 可视化层直接消费。**补入 v0.3 backlog。**

2. **令牌持久化一致性**：多 Agent 并发时权限令牌的原子性要求。处置：v0.2 使用 SQLite 事务保证原子性写入，不需要文件锁。SQLite 在服务端单进程场景下天然满足并发安全要求，并发压测留 v0.3 之前的 technical review 阶段。

3. **沙盒 vs 现有 Tauri Commands 的兼容性**：req-022 沙盒的「结构性隔离」在服务端架构下意味着 context builder 在服务端执行，不让 Agent 直接访问 Tauri 层——Agent 只能看到服务端上下文构建器注入的内容。v0.1 已有的 `read_qa_atom` 等 Tauri Commands 用于结构化读取本地 QA atom 文件（含格式解析），v0.2 保持不变，供主对话路径和本地文件写回使用。对于 context builder 需要的原始文档内容（product.md、需求文档等非 QA atom 格式的文件），Tauri 在触发 dispatch 时将文件内容**主动随请求打包上传**给服务端（push 模式），服务端 context builder 直接使用上传的内容，无需自行拉取——这与 Push-based 原则完全一致，同时消除了服务端远程访问用户本地文件的网络拓扑问题。

4. **服务器不可达时的降级策略**：v0.2 的后端服务（:8081）与 sub2api（:8080）运行在同一台服务器（43.135.174.27），服务器不可达时 Agent 调度和主对话 LLM 调用均不可用（两者都依赖服务器上的 sub2api）。v0.2 不做分级降级区分，统一提示「工作台服务暂时不可达，请检查网络或稍后重试」——TopBar 红点持久显示 + 首次出现时弹出可关闭 Banner；本地 QA atom 读写（list_qa_atoms / read_qa_atom / write_qa_atom）仍可正常使用。分级降级（Agent 团队暂停但主对话独立可用）在 req-029 LLM Gateway 内化后实现，届时主对话可绕过服务器直连 LLM。**降级 UI 实现留 technical.md 详细设计。**

---

## 功能设计

### req-013 · Agent 任务状态机（服务端）

**实现方案**：独立后端服务（Rust + Axum，部署在 `43.135.174.27:8081`）。任务状态持久化到服务端 SQLite 数据库（`/data/workbench/workbench.db`）。

**SQLite 表结构**（两张核心表）：

```sql
-- 任务表
CREATE TABLE agent_tasks (
    task_id     TEXT PRIMARY KEY,        -- UUID v4
    task_type   TEXT NOT NULL,           -- ProductPlanning | Review | Engineering | Memory
    role        TEXT NOT NULL,           -- Ceo | ProductAgent | ReviewAgent | TechnicalAgent
    status      TEXT NOT NULL,           -- Pending | Running | Blocked | AwaitingDecision | Completed | Failed
    project     TEXT NOT NULL,
    version     TEXT NOT NULL,           -- "v0.2"
    input_context TEXT NOT NULL,         -- 触发时注入的上下文摘要（非完整 prompt）
    output      TEXT,                    -- JSON 序列化的 TaskOutput，完成后写入
    blocking_on TEXT,                    -- 阻塞原因描述
    decision_request TEXT,              -- JSON 序列化的 DecisionRequest，req-018 使用
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- 权限令牌表
CREATE TABLE capability_tokens (
    token_id    TEXT PRIMARY KEY,        -- UUID v4
    token_type  TEXT NOT NULL,           -- Deliverable | Approved | Mergeable
    target_id   TEXT NOT NULL,           -- 文档路径或任务 ID
    issued_at   TEXT NOT NULL,
    issued_by   TEXT NOT NULL            -- 颁发方（确定性代码流程名）
);
```

**任务数据结构**（服务端 Rust 类型）：

```rust
// backend/src/state_machine/task.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTask {
    pub task_id: String,
    pub task_type: TaskType,
    pub role: AgentRole,
    pub status: TaskStatus,
    pub project: String,
    pub version: String,
    pub input_context: String,
    pub output: Option<TaskOutput>,
    pub blocking_on: Option<BlockingCondition>,
    pub decision_request: Option<DecisionRequest>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionRequest {
    pub question: String,
    pub options: Vec<String>,
    pub risk_level: RiskLevel,     // Low | Medium | High
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}
```

**权限令牌**：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityToken {
    pub token_id: String,
    pub token_type: TokenType,     // Deliverable | Approved | Mergeable
    pub target_id: String,
    pub issued_at: DateTime<Utc>,
    pub issued_by: String,
}
```

令牌仅由服务端确定性代码颁发。`revoke_token` 在 v0.2 暂不触发（无令牌撤销场景），接口预留供 v0.3 使用。

**服务端 REST API 接口**（Tauri 调用）：

| 方法 | 路径 | 作用 | v0.2 状态 |
|------|------|------|---------|
| `POST` | `/api/tasks` | 创建新任务，返回 task_id | 实现 |
| `PATCH` | `/api/tasks/{task_id}/status` | 更新任务状态（经 Harness pre-hook 验证） | 实现 |
| `GET` | `/api/tasks/{task_id}` | 读取单个任务 | 实现 |
| `GET` | `/api/tasks` | 按状态/角色/项目过滤列表 | 实现 |
| `POST` | `/api/tokens` | 颁发权限令牌（仅内部代码路径调用） | 实现 |
| `GET` | `/api/tokens/check` | 查询令牌是否存在（供 hook 调用） | 实现 |
| `DELETE` | `/api/tokens/{token_id}` | 撤销权限令牌 | 预留接口，v0.3 实现 |

**状态变更事件**：任务状态每次变更后，服务端通过 SSE 端点（`GET /api/events/stream`）向订阅的 Tauri 前端广播 `task_status_changed` 事件，携带 `{ task_id, new_status, decision_request? }`。前端监听此事件更新 P1 角标（req-018）。

---

### req-014 · 真实多 Agent 调度

**核心原则**：每个 Agent 角色 = 一次独立的 Claude API 调用，system prompt 定义角色边界，context 由上下文构建器（req-015）注入。Agent 之间不共享对话上下文，通过状态机（req-013）通信。

**调度器实现（服务端 Rust）**：

```rust
// backend/src/dispatcher/mod.rs
pub struct AgentDispatcher {
    state_machine: Arc<StateMachine>,
    context_builder: ContextBuilder,
    http_client: reqwest::Client,
}

impl AgentDispatcher {
    pub async fn dispatch(&self, task_id: &str) -> Result<TaskOutput, DispatchError> {
        // 1. 读取任务（SQLite）
        let task = self.state_machine.get_task(task_id).await?;
        // 2. 构建 context（调用 context builder，使用 Tauri 随 dispatch 上传的文件内容）
        let prompt = self.context_builder.build(&task, &uploaded_docs).await?;
        // 3. 更新状态为 Running
        self.state_machine.update_status(task_id, TaskStatus::Running).await?;
        // 4. 调用 Claude API（独立 API call，不共享对话）
        let response = self.call_claude_api(prompt).await?;
        // 5. 写回产出物，更新状态为 Completed（SQLite 事务）
        self.state_machine.complete_task(task_id, response).await?;
        Ok(response)
    }
}
```

**SUB2API_KEY**：存于服务器环境变量，不出现在 Tauri 进程中。Agent dispatch 使用的 API 端点：`43.135.174.27:8080/v1/messages`（非流式，`stream: false`）。

**Tauri 侧 SUB2API_KEY**：主对话（ceo-main，走 `stream_ai` 路径）仍在 Tauri 侧执行，Tauri 进程持有一个**独立的** SUB2API_KEY，专用于主对话流式调用。两个 KEY 归属不同侧，互相独立：服务端 KEY 用于 Agent dispatch（非流式），Tauri 侧 KEY 用于主对话（流式）。

**并发支持**：Rust `tokio::spawn` 并发多个 `dispatch` 调用，每个独立 API call 在独立 async task 中运行，SQLite 事务保证并发写入的安全性。

**dispatch 触发端点**：

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/tasks/{task_id}/dispatch` | 触发指定任务的 Agent dispatch（服务端执行 Claude API 调用） |

**角色定义（v0.2 实现的最小角色集）**：

| 角色 | System Prompt 核心职责 | 触发条件 |
|------|----------------------|---------|
| `product-agent` | 产品文档起草，输出 product.md | CEO 通过 Tauri 调用 `POST /api/tasks` 创建 ProductPlanning 类型任务，再调用 dispatch |
| `review-agent` | 文档审查，输出审查报告 + 通过/拒绝 | product-agent 任务状态变为 `Completed` 后，调度器 post-hook 自动创建 Review 任务并触发 dispatch |
| `ceo-main` | 主对话响应，接收用户消息，规划任务 | 用户通过 P3 对话框发送消息（直接触发 Tauri stream_ai，不经过任务队列） |
| `ceo-event` | 事件响应，处理后台任务完成/决策 | 服务端调度器监听任务状态，Completed / Failed / AwaitingDecision 时服务端触发 ceo-event dispatch |
| `technical-agent` | 工程实现，按 technical.md 节点逐步执行代码/文档变更，输出执行报告 | `APPROVED` 令牌颁发后，Harness `pre_hook_engineering_start` 放行，调度器触发 dispatch |

---

### req-015 · Agent 上下文构建器

**Push-based 原则**：Agent 看到的就是它被允许看到的全部。context builder 主动将内容推送给 Agent，Agent 不主动拉取任何信息。

**服务端实现**（Rust，运行于 `43.135.174.27`）：

```rust
// backend/src/context_builder/mod.rs
pub struct ContextBuilder;

impl ContextBuilder {
    pub async fn build(
        &self,
        task: &AgentTask,
        uploaded_docs: &HashMap<String, String>,  // Tauri 随 dispatch 请求上传的文件内容
    ) -> Result<ClaudePrompt, BuildError> {
        let mut context = Vec::new();

        // 层 1：Role system prompt（角色行为边界，从服务端 /data/workbench/roles/ 读取）
        context.push(self.load_role_system_prompt(&task.role)?);

        // 层 2：Task state（结构化任务状态，from SQLite）
        context.push(self.format_task_state(task));

        // 层 3：Relevant documents（从 Tauri 随 dispatch 上传的内容中取，按白名单过滤）
        for doc_path in task.allowed_documents() {
            if let Some(content) = uploaded_docs.get(&doc_path) {
                context.push(format_document(&doc_path, content.clone()));
            } else {
                log::warn!("[context_builder] doc not uploaded: {}", doc_path);
            }
        }

        // 层 4：Trigger context（触发原因）
        context.push(self.format_trigger_context(task));

        // 层 5：Memory injection（v0.2 用文件直接注入，req-021 后期升级）
        if let Some(memory_path) = task.memory_hint() {
            if let Some(memory) = uploaded_docs.get(&memory_path) {
                context.push(format_memory(memory.clone()));
            }
        }

        Ok(ClaudePrompt {
            system: context.join("\n\n---\n\n"),
            messages: task.input_as_messages(),
        })
    }
}
```

**文件内容传递机制（Push 模式）**：服务端在远程服务器，无法主动访问用户 macOS 本地文件。因此 v0.2 采用 **Push 模式**：Tauri 在触发 dispatch 时，根据任务的 `allowed_documents` 白名单，主动在本地读取所有需要的文件内容，与 dispatch 请求一并上传给服务端（`POST /api/tasks/{task_id}/dispatch` 请求体中包含 `documents: { path: content, ... }` 字段）。服务端 context builder 直接使用上传内容，无需自行拉取。这与 Push-based 原则完全一致，不引入服务端对用户本地网络的依赖。

**dispatch 请求体结构**：
```json
{
  "documents": {
    "产品方向.md": "<文件内容>",
    "requirements/README.md": "<文件内容>"
  }
}
```

Tauri 在上传前校验文件路径是否在白名单内（客户端预校验，服务端再次校验）。白名单由服务端任务定义持有，Tauri 通过 `GET /api/tasks/{task_id}` 获取后本地读取对应文件。

**角色裁剪规则（v0.2 实现的隔离约束）**：

| Agent 角色 | 可读取的文档白名单 | 不可读取 |
|----------|--------------|---------|
| `review-agent` | 待审文档全文（task.allowed_documents） | 工程 Agent 的决策过程、CEO 对话历史 |
| `ceo-main` | 所有任务状态摘要（不含详细执行日志） | 各任务的完整原始输出 |
| `ceo-event` | 触发事件的任务完整输出 | 其他并行任务的状态 |
| `product-agent` | 产品方向文档、需求池、用户指令 | review-agent 的审查历史 |

**System Prompt 存储路径**：服务端 `/data/workbench/roles/{role_name}.md`，v0.2 预置 4 个服务端角色文件：`review-agent / ceo-event / product-agent / technical-agent`。`ceo-main` 的 system prompt 由 Tauri 侧构建，不存储在服务端 roles/ 目录。

---

### req-022 · Agent 沙盒

**实现方式**：沙盒边界在服务端 ContextBuilder 层强制执行，不是操作系统层隔离。每个任务在 `AgentTask.allowed_documents` 字段明确声明可读取的文件路径白名单，服务端 context builder 只使用 Tauri 随 dispatch 请求上传的白名单内文件内容，不允许 Agent 主动扩展读取范围，服务端也不自行访问任何外部文件路径。

**沙盒边界定义**（服务端实现）：

```rust
impl AgentTask {
    /// 返回本次任务允许注入的文档路径白名单
    pub fn allowed_documents(&self) -> Vec<String> {
        match self.task_type {
            TaskType::Review => vec![
                self.output_path_of_product_doc(),
            ],
            TaskType::ProductPlanning => vec![
                product_direction_path(&self.project),
                requirements_readme_path(&self.project),
            ],
            TaskType::Engineering => vec![
                technical_md_path(&self.project, &self.version),
            ],
            _ => vec![],
        }
    }
}
```

**写入限制**：Agent 的输出通过 `TaskOutput` 结构体返回给服务端调度器，调度器再决定写入 SQLite 或通过 SSE 通知 Tauri 写本地文件。Agent 不直接调用任何文件写入接口，所有写入都经过服务端调度器和 Harness hook。

**review-agent 典型沙盒配置（v0.2 关键路径）**：
- 注入：product.md 全文（由 Tauri 随 dispatch 请求上传）+ review system prompt
- 不注入：工程 Agent 决策过程、CEO 对话历史、其他任务状态
- 产出：审查报告（`review_report` 字段）+ 通过/拒绝结论（`passed: bool`）

---

### req-023 · Harness 管控层（2 个关键 hook）

**v0.2 实现范围**：仅实现最关键的 2 个 pre-hook，在服务端 Axum 中间件层实现。工作流 DAG 引擎和完整权限管理留 v0.3。

#### Hook 1：产品文档审查通过门（DELIVERABLE 令牌）

**触发时机**：review-agent 完成审查，返回 `passed: true`。

**流程**（服务端执行）：
```
review-agent 输出 {passed: true, review_report: "..."}
    → 服务端调度器读取 passed
    → 确定性代码调用 issue_token(TokenType::Deliverable, product_md_path)
    → SQLite capability_tokens 表写入令牌记录
    → task 状态更新为 Completed
    → SSE 广播：task_status_changed
    → 服务端扫描所有 Blocked 任务，检查 blocking_on == "product_doc_not_delivered"
    → 对应 technical-agent 任务状态更新为 Pending，重新进入调度队列
```

**门控位置**：technical-agent 的 `intake` 阶段（任务创建时）。

```rust
// backend/src/harness/hooks.rs
pub async fn pre_hook_technical_intake(
    state_machine: &StateMachine,
    product_md_path: &str,
) -> Result<(), HarnessError> {
    if !state_machine.check_token(TokenType::Deliverable, product_md_path).await? {
        return Err(HarnessError::DocumentNotDelivered {
            path: product_md_path.to_owned(),
            message: "产品文档尚未通过 review-agent 审查，technical agent 拒绝拉取".to_string(),
        });
    }
    Ok(())
}
```

**前端感知**：technical-agent 任务状态变为 `blocked`，`blocking_on` 字段值为 `"product_doc_not_delivered"`，服务端通过 SSE 推送，前端在决策收件箱显示说明（不需要用户操作，等待 review 完成自动解除）。

#### Hook 2：Technical 审批门（APPROVED 令牌）

**触发时机**：CEO 用户在决策收件箱点击「批准 technical.md」。

**流程**（Tauri 调用服务端 API）：
```
用户在决策收件箱点击「批准」
    → 前端调用 Tauri Command: resolve_decision(decision_id, "approved")
    → Tauri 调用服务端 POST /api/decisions/{decision_id}/resolve
    → 服务端验证 decision 来源合法
    → 确定性代码调用 issue_token(TokenType::Approved, technical_md_path)
    → SQLite 写入令牌记录
    → 工程 Agent 任务状态从 Blocked 变为 Pending
    → SSE 广播：task_status_changed
    → 服务端调度器触发工程 Agent dispatch
```

**门控位置**：工程 Agent 启动前（`dispatch` 入口）。

```rust
pub async fn pre_hook_engineering_start(
    state_machine: &StateMachine,
    technical_md_path: &str,
) -> Result<(), HarnessError> {
    if !state_machine.check_token(TokenType::Approved, technical_md_path).await? {
        return Err(HarnessError::NotApproved {
            path: technical_md_path.to_owned(),
            message: "technical.md 尚未经 CEO 审批，工程 Agent 拒绝启动".to_string(),
        });
    }
    Ok(())
}
```

**新增 REST API 端点**：

| 方法 | 路径 | 作用 |
|------|------|------|
| `POST` | `/api/decisions/{decision_id}/resolve` | 处理决策（服务端执行令牌颁发） |

---

### req-018 · 决策收件箱（基础版）

**存储**：服务端 SQLite（`/data/workbench/workbench.db`），`decisions` 表。

**决策记录数据结构**：

```rust
// backend/src/decisions/mod.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionRecord {
    pub decision_id: String,
    pub task_id: String,
    pub agent_role: AgentRole,
    pub question: String,
    pub options: Vec<DecisionOption>,
    pub risk_level: RiskLevel,     // Low | Medium | High
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub resolution: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionOption {
    pub key: String,               // "approve" | "reject" | "defer"
    pub label: String,
    pub description: Option<String>,
}
```

**SQLite decisions 表**：

```sql
CREATE TABLE decisions (
    decision_id  TEXT PRIMARY KEY,
    task_id      TEXT NOT NULL,
    agent_role   TEXT NOT NULL,
    question     TEXT NOT NULL,
    options      TEXT NOT NULL,   -- JSON
    risk_level   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    resolved_at  TEXT,
    resolution   TEXT
);
```

**SSE 事件格式**：服务端通过 SSE 端点推送以下事件类型：
```json
// 任务状态变更时（含任务进入 AwaitingDecision 状态）
{ "type": "task_status_changed", "task_id": "...", "new_status": "AwaitingDecision", "decision_request": { "question": "..." } }

// 决策创建时（与 task_status_changed 同步触发，专门驱动角标计数）
{ "type": "decision_created", "decision_id": "...", "count": 3 }

// 决策处理完成时
{ "type": "decision_resolved", "decision_id": "...", "count": 2 }
```

任务进入 `AwaitingDecision` 状态时，服务端**同时**触发两个事件：`task_status_changed`（通知状态变更）和 `decision_created`（驱动 P1 角标 +1）。前端分别处理：`task_status_changed` 更新任务状态视图，`decision_created` 更新 `pendingDecisionCount`。

**前端交互**：

- **P1 角标（A1 方案）**：决策入口图标右上角叠加红色数字角标（直径 14px，`background: #dc2626`，白色数字 `font-size: 9px`），显示未处理决策数，响应 SSE `decision_created`（+1）和 `decision_resolved`（-1）。
- **P1-Icons 专注模式**：P1-Icons（52px 导航条）支持整体折叠（快捷键或双击左边缘触发），折叠后 P3 获得额外宽度；专注状态下角标不干扰视野。
- **进入决策模式**：点击角标或决策图标 → P3 切换到 `decisions` 模式，显示**决策卡片列表**（B1 风格）：
  - 按风险等级排序（HIGH → MEDIUM → LOW）
  - 每张 `DecisionCard` 显示：来源 Agent tag（蓝色 pill）+ 风险等级 badge（HIGH=红 / MEDIUM=橙 / LOW=灰）+ 等待时长 + 问题描述 + 操作按钮
  - `DecisionCard` 为可复用组件，后续 Agent 阶段性 checkpoint 等场景可直接复用
- **选中决策**：点击某张 DecisionCard → P4 自动展开为「**决策详情与对话**」面板，包含：
  - 上方：完整决策信息（来源 Agent、问题、背景说明、风险等级）
  - 中间：**决策对话区**（迷你对话界面，CEO 带当前决策记录作为上下文）
  - 下方：操作按钮区（预设选项）

**决策交互流**：

- **直接决策**：用户理解选项后直接点击操作按钮（批准 / 拒绝 / 延迟）→ `resolve_decision` → SSE `decision_resolved` → 角标 -1
- **对话辅助决策**：用户在 P4 对话区输入疑问 → CEO 带决策上下文回答 → 对话结束后：
  - 若结论映射到已有选项 → 用户点击对应按钮，走直接决策流
  - 若产生新路径 → 用户自由输入结论描述 → CEO 回复「我理解你的决策是：[X]，是否确认？」→ 用户确认 → `resolve_decision` 写入自定义 resolution
  - 若用户不确认 → 继续对话，直至形成清晰结论

「AI 反馈 → 用户确认」循环保证写入状态机的每条 resolution 都是明确的，不允许模糊决策进入系统。

**对话区上下文**：P4 决策对话区复用 `stream_ai` 路径（Tauri 侧 KEY），使用**独立最小化 system prompt**（仅包含：CEO 角色简要定义 + 当前决策记录全文），不包含 ceo-main 的任务状态摘要；不进入主对话历史，独立上下文；决策处理完成后上下文丢弃，不写入 QA atom。

**切回主对话**：完成决策后（或随时）可一键切回 `chat` 模式，主对话历史完整保留。

用户点击选项 → Tauri 调用 `POST /api/decisions/{id}/resolve` → SSE 推送 `decision_resolved` → 角标数量 -1

**Tauri Commands 接口**（Tauri 作为代理，内部调用服务端 REST API）：

| Command | 对应服务端 API | 作用 |
|---------|-------------|------|
| `list_decisions(filter)` | `GET /api/decisions` | 列出决策（pending / resolved / all） |
| `get_decision(decision_id)` | `GET /api/decisions/{id}` | 读取单条决策详情 |
| `resolve_decision(decision_id, resolution)` | `POST /api/decisions/{id}/resolve` | 处理决策（服务端触发令牌颁发） |

**与主对话的关系**：决策不进入主对话线程。CEO 在主对话模式中被调用时，上下文只包含「当前有 N 个待决策项」的摘要，不展开每条决策内容。用户主动询问时，CEO 才汇报具体内容。

---

### req-020 · 主对话保护

**CEO Agent 双模式实现**：

#### 模式 1：主对话响应（ceo-main）

**触发**：用户通过 P3 对话框发送消息。

**System Prompt Context**：
- CEO 角色定义（长期记忆：产品方向、架构原则）
- 当前所有任务的状态摘要（Tauri 调用 `GET /api/tasks` 获取，仅 task_id / role / status / version，不含执行日志）
- 待决策数量摘要（「当前 N 个待决策项，可说「帮我看决策」展开」）
- 用户消息

**产出路由**：与 v0.1 主对话路径完全一致——`stream_ai` SSE 流式推送 token，P3 逐字渲染；streaming 完成后 `write_qa_atom` 持久化到本地 QA 原子文件。CEO 主对话不通过任务队列，直接走 v0.1 已有路径。此路径使用 Tauri 侧独立 SUB2API_KEY。

#### 模式 2：事件响应（ceo-event）

**触发**：服务端后台任务完成或决策请求生成（服务端监听 SQLite 状态变更，触发 ceo-event dispatch）。

**System Prompt Context**：
- CEO 角色定义（同上）
- 触发事件的任务完整输出（如 review-agent 的完整审查报告，从 SQLite 读取）
- 需要 CEO 处理的具体问题（如「是否批准此 technical.md？」）

**产出路由**：写入服务端 SQLite（更新 CEO 的处理结论）+ 若需用户决策则写入 `decisions` 表并通过 SSE 通知 Tauri。不写入主对话流，不触发 P3 刷新。此路径使用服务端 SUB2API_KEY。

**Zustand 新增字段**：

```typescript
// 在 v0.1 layoutSlice 基础上扩展
interface LayoutSlice {
  // v0.1 已有
  p2Visible: boolean
  p4Visible: boolean
  currentMode: 'chat' | 'tools' | 'console' | 'decisions'  // 新增 decisions 模式
  // v0.2 新增
  pendingDecisionCount: number       // 驱动 P1 角标，由 SSE decision_created/decision_resolved 更新
  backendOnline: boolean             // 后端服务是否可达，驱动降级提示
  selectedDecisionId: string | null  // 当前选中的决策，驱动 P4 决策详情与对话面板
  p1IconsVisible: boolean            // P1-Icons 是否展开（专注模式折叠）
}
```

**保护规则**：
1. 后台任务完成不在主对话流中自动追加消息
2. 主对话的 CEO 调用不包含后台任务详细执行日志
3. 主对话进行中（用户正在输入），后台任务完成事件暂存，待用户消息发送完成后再处理（避免上下文污染）

---

## 架构方向

### v0.2 整体分层

```
Tauri 前端（React + Rust）                     [本地 macOS]
    ├── P1 NavList（决策角标 + decisions 模式入口）
    ├── P3（主对话 + 决策列表视图，模式切换）
    ├── Zustand Store（pendingDecisionCount / backendOnline / SSE 事件）
    ├── 本地文件读写（list_qa_atoms / read_qa_atom / write_qa_atom）
    ├── 主对话流式推送（stream_ai → P3 逐 token 渲染，Tauri 侧 SUB2API_KEY）
    ├── HTTP Client（调用后端服务 REST API，dispatch 时随请求上传文件内容）
    └── SSE Client（订阅后端 GET /api/events/stream）

        ↕ REST API + SSE（公网 HTTPS，双向）

后端服务（Rust + Axum，43.135.174.27:8081）   [远程服务器]
    ├── 状态机层（state_machine/）
    │     AgentTask / CapabilityToken / SQLite 持久化（workbench.db）
    ├── 调度层（dispatcher/）
    │     AgentDispatcher / 独立 API call（非流式）/ tokio 并发
    ├── 上下文构建层（context_builder/）
    │     Push-based / 角色裁剪 / 使用 Tauri 随 dispatch 上传的文件内容
    ├── 沙盒层（sandbox/）
    │     allowed_documents() 白名单 / 服务端强制
    ├── Harness 层（harness/）
    │     pre_hook_technical_intake / pre_hook_engineering_start
    ├── 决策层（decisions/）
    │     DecisionRecord / resolve_decision / SQLite 持久化
    └── SSE 端点（GET /api/events/stream）
          task_status_changed / decision_created / decision_resolved

远程 AI API                                    [sub2api]
    └── sub2api（43.135.174.27:8080）
          服务端 Agent dispatch 使用非流式 /v1/messages（服务端 SUB2API_KEY）
          Tauri 主对话继续使用流式（stream: true，Tauri 侧 SUB2API_KEY）
```

**通信方向说明**：Tauri（macOS）主动向服务端发起所有请求（REST + SSE 订阅均为 Tauri → Server 方向建立连接）。服务端**不主动访问** Tauri 所在的 macOS 机器——文件内容由 Tauri 在 dispatch 请求时随 body 上传（Push 模式），SSE 是 Tauri 保持的长连接，服务端向此连接写事件。网络防火墙只需 macOS 出站到服务器 8081 端口，无需服务器入站到 macOS 任何端口。

### 后端服务 REST API 端点总览

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/tasks` | 创建任务 |
| `GET` | `/api/tasks` | 列出任务（支持 status/role/project 过滤） |
| `GET` | `/api/tasks/{task_id}` | 读取单个任务 |
| `PATCH` | `/api/tasks/{task_id}/status` | 更新任务状态（经 Harness 验证） |
| `POST` | `/api/tasks/{task_id}/dispatch` | 触发 Agent dispatch |
| `POST` | `/api/tokens` | 颁发权限令牌（内部调用） |
| `GET` | `/api/tokens/check` | 查询令牌是否存在 |
| `DELETE` | `/api/tokens/{token_id}` | 撤销令牌（v0.3 实现，v0.2 预留） |
| `GET` | `/api/decisions` | 列出决策（支持过滤） |
| `GET` | `/api/decisions/{decision_id}` | 读取单条决策 |
| `POST` | `/api/decisions/{decision_id}/resolve` | 处理决策 |
| `GET` | `/api/events/stream` | SSE 事件流（Tauri 订阅） |

### 后端服务部署

- **服务器**：`43.135.174.27`，独立进程（独立于 sub2api 进程）
- **端口**：`8081`（避免与 sub2api:8080 冲突）
- **数据库**：`/data/workbench/workbench.db`（服务器本地 SQLite）
- **启动方式**：v0.2 先用 `screen` 或 `tmux` 管理进程；v0.3 升级为 `systemd` service
- **环境变量**：`SUB2API_KEY`（服务端 Agent dispatch 用）
- **日志**：标准输出重定向到 `/data/workbench/logs/backend.log`

### 实现顺序

```
req-013（状态机 + 令牌，SQLite，后端服务框架搭建）
  └── req-022（沙盒边界定义，allowed_documents，服务端）
        └── req-015（上下文构建器，Push-based，Tauri dispatch 上传文件联调）
              └── req-014（调度器，独立 API call，服务端 SUB2API_KEY）
                    ├── req-023（Harness 2 个 hook，Axum 中间件）
                    ├── req-018（决策收件箱，SSE 推送，Tauri 订阅联调）
                    └── req-020（主对话保护，CEO 双模式 context 路由）
```

### 长期一致性

对照 `产品方向.md` 核心原则：

| 原则 | v0.2 实现 | 对齐 |
|------|-----------|------|
| 后端逻辑 AI first | 状态机、调度器、Harness hook 全在服务端 Rust，不在 Tauri 进程 | ✅ |
| 前端逻辑 Human first | 决策角标、决策列表视图、主对话保护，全是前端 human-first 设计 | ✅ |
| Panel 只通过选中状态事件通信 | 新增 `decisions` 模式不破坏现有 Panel 通信约定 | ✅ |
| 不引入新运行时 | Rust Tokio + SQLite（服务端已有语言栈，无新运行时） | ✅ |
| Tauri Commands 最小权限 | Tauri 新增 Commands 仅访问本地文件和调用后端 REST API，不持有 Agent KEY | ✅ |
| 配置对象不硬编码 | 角色 system prompt 存服务端文件，令牌规则在代码中可配置 | ✅ |
| 「后端逻辑可信」原则 | 令牌颁发/撤销只在服务端 Rust 层，Agent 和前端 JS 不可直接操作 | ✅ |

### v0.1 兼容性

v0.2 后端服务是**全新服务**，与 v0.1 完全不相交：
- v0.1 的 `list_qa_atoms` / `read_qa_atom` / `write_qa_atom` / `stream_ai` Tauri Commands 保持不变
- v0.2 新增的后端服务模块（state_machine / dispatcher / context_builder / harness / decisions）作为独立进程部署，不修改 v0.1 任何现有 Command
- 主对话的 SSE 流式路径（`stream_ai` → P3 逐 token 渲染）完全不受影响，Tauri 侧 SUB2API_KEY 单独持有
- Zustand store 扩展（新增 `pendingDecisionCount` / `backendOnline` / `decisions` 模式 / `selectedDecisionId` / `p1IconsVisible`）向后兼容，不改动 v0.1 已有 slice

---

## 版本验收标准

### req-013 · 状态机验收

- [ ] 调用 `POST /api/tasks` 后，SQLite `agent_tasks` 表存在对应记录且字段正确
- [ ] 任务状态从 `Pending` → `Running` → `Completed` 的完整流转可通过 `GET /api/tasks/{task_id}` 验证
- [ ] 两个并发 dispatch 请求同时写入时，SQLite 事务保证无数据错误（服务端日志无冲突报错）
- [ ] 颁发 `DELIVERABLE` 令牌后，`GET /api/tokens/check` 返回 `true`；令牌不存在时返回 `false`
- [ ] 任务状态变更后，SSE 客户端（Tauri）收到 `task_status_changed` 事件

### req-014 · 多 Agent 调度验收

- [ ] product-agent 和 review-agent 分别触发时，服务端日志中可见两次独立的 `POST /v1/messages` 请求（不同 system prompt）
- [ ] review-agent 的 system prompt 中不包含 product-agent 的执行过程（服务端日志验证）
- [ ] 两个 Agent 并发运行时，各自任务状态正确（Running x2），完成后各自 Completed
- [ ] dispatch 调用使用服务端 `SUB2API_KEY` 环境变量，Tauri 进程日志中不出现 Agent dispatch 相关 KEY

### req-015 · 上下文构建器验收

- [ ] review-agent 收到的 context 仅包含：待审文档全文 + review system prompt + 触发原因（服务端日志验证）
- [ ] product-agent 收到的 context 包含：产品方向.md + requirements/README.md + CEO 指令（服务端日志验证）
- [ ] `allowed_documents` 白名单外的文件路径，context builder 拒绝读取并记录错误
- [ ] Tauri 发起 dispatch 时，请求 body 中 `documents` 字段包含白名单内的文件内容（抓包或 Tauri 日志验证）；服务端 context builder 日志显示使用了上传内容，未尝试自行拉取外部文件

### req-022 · 沙盒验收

- [ ] Agent 输出通过 `TaskOutput` 结构体返回，服务端调度器决定写入目标（验证方式：review-agent dispatch 完成后，仅 SQLite `agent_tasks` 表对应行被更新，无其他文件被写入）
- [ ] review-agent 的输出槽仅写入 `review_report` + `passed` 字段
- [ ] context builder 对白名单外文件路径拒绝读取：测试方法为在 `AgentTask.allowed_documents()` 返回空列表时调用 `ContextBuilder.build()`，验证层 3（Relevant documents）中无文件内容被注入，服务端日志输出 `[context_builder] skipped: no allowed documents`

### req-023 · Harness 验收

- [ ] 无 `DELIVERABLE` 令牌时，`pre_hook_technical_intake` 返回错误，服务端日志记录 `HarnessError::DocumentNotDelivered`，technical-agent 任务状态变为 `Blocked`，`blocking_on` 字段有正确说明
- [ ] review-agent 通过（`passed: true`）后，`DELIVERABLE` 令牌写入 SQLite，之前被 blocked 的 technical-agent 任务状态变为 `Pending`，SSE 推送状态变更
- [ ] 无 `APPROVED` 令牌时，工程 Agent dispatch 被 `pre_hook_engineering_start` 拒绝，服务端日志记录 `HarnessError::NotApproved`
- [ ] CEO 在决策收件箱点击「批准」后，服务端 `POST /api/decisions/{id}/resolve` 返回 200，`APPROVED` 令牌写入 SQLite，工程 Agent 自动从 `Blocked` 进入 `Running`，SSE 推送

### req-018 · 决策收件箱验收

- [ ] 任务状态变为 `AwaitingDecision` 时，服务端通过 SSE 推送 `decision_created` 事件，P1 决策图标右上角出现红色数字角标（数字 = 未处理决策数）
- [ ] 点击角标后，P3 切换到 `decisions` 模式，以 B1 卡片列表渲染所有未处理决策，按 HIGH→MEDIUM→LOW 排序
- [ ] 点击某张 DecisionCard 后，P4 自动展开为决策详情 + 对话面板，上方显示完整决策信息，中间为对话区，下方为操作按钮
- [ ] **直接决策路径**：点击操作按钮后，服务端 `decisions` 表 `resolved_at` 写入，SSE 推送 `decision_resolved`，角标 -1
- [ ] **对话辅助决策路径**：P4 对话区输入消息后，CEO 以决策上下文回答；自由输入结论后 CEO 回复确认摘要；用户确认后 `resolve_decision` 写入自定义 resolution
- [ ] 决策对话内容不出现在主对话 P3 历史中，不写入 QA atom
- [ ] P1-Icons 专注折叠：双击 P1 左边缘（或快捷键）可收起整个 P1-Icons 条，P3 宽度随之扩展
- [ ] SQLite `decisions` 表正确记录决策及解决结果（可用 `sqlite3` 命令在服务器验证）

### req-020 · 主对话保护验收

- [ ] 后台 review-agent 完成时（服务端 SSE task_status_changed），P3 主对话流中不出现新消息
- [ ] CEO 主对话模式的 system prompt 中不含后台任务的详细执行日志（Tauri 侧日志验证）
- [ ] 用户在 P3 主动询问「有什么在跑」时，CEO 响应中包含任务状态摘要（来自 `GET /api/tasks` 的摘要数据）
- [ ] 主对话进行时后台任务完成事件不打断用户输入

### 端到端集成验收

- [ ] **完整两跳流**：CEO 触发 product-agent（Tauri → `POST /api/tasks` + dispatch）→ product-agent 完成（服务端）→ review-agent 自动启动（服务端 post-hook）→ review-agent 通过 → DELIVERABLE 令牌写 SQLite → technical-agent intake 成功（之前 Blocked 解除）→ SSE 推送全程。全程主对话无干扰。
- [ ] **决策路径**：technical-agent 完成后服务端触发 ceo-event dispatch → CEO 写 SQLite decisions 表 → SSE decision_created → P1 角标 +1 → 用户处理决策 → APPROVED 令牌写 SQLite → 工程 Agent 从 Blocked 进入 Running。
- [ ] **隔离验证**：review-agent 被拒绝（passed: false）时，DELIVERABLE 令牌不写 SQLite，technical-agent 保持 Blocked 状态。
- [ ] **降级验证**：手动停止后端服务（模拟服务器不可达），前端 TopBar 显示红点 + 弹出可关闭 Banner 提示「工作台服务暂时不可达」；主对话 stream_ai 调用返回网络错误（sub2api 同服务器不可达）；本地 QA atom 读写（list_qa_atoms / read_qa_atom / write_qa_atom）仍可正常使用，无崩溃。

---

## 修订记录

| 版本 | 日期 | 变化 |
|------|------|------|
| doc_revision 1 | 2026-05-18 | 初稿，CEO 确定版本范围，workbench-product 起草 |
| doc_revision 2 | 2026-05-18 | review pass 1 修复：revoke_token 接口补入表格并说明 v0.2 预留状态；Hook 1 流程图补充 Blocked 解除逻辑；决策列表视图在 P3 渲染的面板职责依据补充；review-agent 触发条件明确为调度器 post-hook；req-022 第 3 条验收改为可测的日志验证；CEO 主对话产出路由明确走 stream_ai → write_qa_atom |
| doc_revision 3 | 2026-05-18 | 架构修订：用户决策状态机放服务器，引入 Rust+Axum 后端服务（43.135.174.27:8081）+ SQLite；Tauri 降级为薄客户端；服务端 SUB2API_KEY 用于 Agent dispatch（非流式），Tauri 侧保留独立 SUB2API_KEY 用于主对话（流式）；CEO 主对话路径保留 Tauri 侧（stream_ai 不变）；CEO 事件响应路径移服务端；文件内容传递改为 Tauri dispatch 时 Push 上传（消除服务端访问 macOS 本地的网络拓扑问题）；新增服务器不可达降级策略；SSE 三种事件类型格式定义（decision_created / decision_resolved / task_status_changed）；REST API 端点总览；后端服务部署说明；分层图补充通信方向说明 |
| doc_revision 4 | 2026-05-18 | UI 设计决策落地：① P1 角标采用 A1 方案（14px 红色数字角标叠加决策图标右上角）；② req-018 前端交互更新为 B1 卡片列表（P3）+ P4 决策详情与对话面板，新增「AI 反馈确认」决策流（对话辅助→CEO 确认摘要→用户确认→写状态机）；③ P1-Icons 支持整体折叠（专注模式，双击左边缘触发）；④ 降级策略修正：后端服务（:8081）与 sub2api（:8080）同服务器，服务器不可达时统一提示不可达，移除「主对话可用」误导性表述，分级降级推迟至 req-029 LLM Gateway 后实现；⑤ Zustand 新增 selectedDecisionId / p1IconsVisible 字段 |
| doc_revision 5 | 2026-05-18 | review-agent 修复：① SQL role 枚举移除 FrontendUi/TauriPlatform，改为 Ceo/ProductAgent/ReviewAgent/TechnicalAgent；② req-014 角色表补入 technical-agent（工程实现，APPROVED 令牌后 Harness 放行触发）；③ P4 决策对话区 system prompt 明确为独立最小化（仅 CEO 角色简要定义 + 决策记录，不含 ceo-main 任务状态摘要）；④ v0.1 兼容性章节补全 selectedDecisionId / p1IconsVisible 字段；⑤ 降级验收条件修正（stream_ai 也不可用，本地 QA atom 读写仍可用） |
| doc_revision 6 | 2026-05-18 | review-agent 修复：System Prompt 存储路径说明明确服务端预置 4 个角色文件（review-agent / ceo-event / product-agent / technical-agent），ceo-main 由 Tauri 侧构建不存服务端 |
