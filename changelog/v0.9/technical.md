---
project: 工作台
version: v0.9
status: approved
doc_revision: 3
created: 2026-05-20
updated: 2026-05-20
author: technical-planning
approved_by: workbench-ceo
approved_at: 2026-05-20
tags:
  - 类型/规划文档
  - 主题/技术/工作台
  - 状态/已批准
---

# technical.md · 工作台 v0.9 · 对话体验提升 + 模型灵活性

---

## 背景说明（v0.8 已有 + v0.9 新增）

### v0.8 已交付的代码资产（与 v0.9 直接相关）

| 模块 | 文件路径 | v0.9 可用内容 |
|------|---------|--------------|
| 调度器核心 | `backend/src/dispatcher/mod.rs` | `AgentDispatcher::dispatch_core()`，已完整实现 Claude API 调用（`self.agent_model` 全局单一模型）；响应解析后捕获 `output_tokens_captured`；调用后写 `write_event_log()` |
| 数据库初始化 | `backend/src/db.rs` | `create_tables()`，已有 `agent_tasks` / `capability_tokens` / `decisions` / `ui_events` 四张表；v0.7 已有 ALTER TABLE migration 模式 |
| 上下文构建器 | `backend/src/context_builder/mod.rs` | `write_event_log()` 工具函数（已被 dispatcher 广泛使用，v0.9 `llm_calls` 写入可参考其风格但写独立表） |
| 路由层 | `backend/src/routes/` | 已有 `agents / decisions / events / health / notifications / tasks / tokens` 七个路由模块；`routes/mod.rs` 通过 `pub mod` 声明各模块 |
| Agent 角色枚举 | `backend/src/state_machine/task.rs` | `AgentRole` enum：`Ceo / ProductAgent / ReviewAgent / TechnicalAgent / QaAgent`（五个已定义角色） |
| Tauri 命令层 | `workbench/src-tauri/src/commands/backend_client.rs` | `BACKEND_URL = "http://43.135.174.27:8081"`；已有 `create_task / dispatch_task / list_tasks / check_backend_health` 等命令模式 |
| ChatView | `workbench/src/components/ChatView/ChatView.tsx` | AI 消息气泡第 285 行直接渲染 `{msg.content}`（纯文本）；streaming 气泡第 292 行直接渲染 `{streamingText}` |
| ChatView 样式 | `workbench/src/components/ChatView/ChatView.css` | `.bubble--ai` 已有 `background / color / border / border-radius`；`.bubble` 含 `white-space: pre-wrap`（需与 markdown 渲染共存处理） |
| Dashboard | `workbench/src/components/Dashboard/DashboardView.tsx` | `SummaryCard` 组件（`label / value` props）；`TokenTimeChart` 样式体系；已有 gateway / atom 双数据源视图 |

### v0.9 新增模块概览

1. **Node 1（req-032）**：`workbench/` 新增 `react-markdown + remark-gfm + rehype-highlight` 依赖；修改 `ChatView.tsx` + `ChatView.css`
2. **Node 2（req-024）**：`backend/src/` 新建 `roles/` 目录存放角色 YAML 配置；修改 `dispatcher/mod.rs` 实现角色级模型读取与 fallback
3. **Node 3（req-029 缩减版）**：`backend/src/db.rs` 追加 `llm_calls` 表；修改 `dispatcher/mod.rs` 写入记录；新建 `backend/src/routes/llm_stats.rs`；`backend/src/routes/mod.rs` 声明新模块；新增 Tauri 命令 `get_llm_stats`；修改 `DashboardView.tsx` 新增 Agent LLM 汇总卡片

---

## 架构概览（变更层级图）

```
【现有层（v0.8，不改动主流程）】
dispatcher::dispatch_core()
    └─ context_builder::build()
    └─ reqwest POST self.sub2api_url（self.agent_model 全局单一）
    └─ 解析 resp_json["usage"]["output_tokens"]
    └─ write_event_log(pool, "agent_dispatch_completed", ...)

【v0.9 Node 1：ChatView Markdown 渲染（纯前端）】
workbench/src/components/ChatView/ChatView.tsx
    └─ AI 气泡：{msg.content} → <ReactMarkdown ...>{msg.content}</ReactMarkdown>
    └─ streaming 气泡：{streamingText} → <ReactMarkdown ...>{streamingText}</ReactMarkdown>
workbench/src/components/ChatView/ChatView.css
    └─ .bubble--ai .markdown-body 子样式（heading / code / pre / table）

【v0.9 Node 2：Per-agent LLM 配置（backend）】
backend/src/roles/{role_name}.yaml  ← 新建，存放角色 model 配置
dispatcher/mod.rs
    └─ AgentDispatcher 新增 roles_dir: String 字段
    └─ dispatch_core() 调用 load_role_model_config(role) 读取 YAML
    └─ 若有配置 → 使用配置的 provider_url + model_id
    └─ 若无配置 → fallback self.sub2api_url + self.agent_model（现有路径，零变更）

【v0.9 Node 3：LLM 调用成本日志（backend + frontend）】
backend/src/db.rs
    └─ create_tables() 追加 llm_calls 表 DDL
dispatcher/mod.rs
    └─ dispatch_core() API 调用成功后：insert_llm_call(pool, ...) 写入记录
backend/src/routes/llm_stats.rs  ← 新建
    └─ GET /api/llm-stats?days=N
workbench/src-tauri/src/commands/backend_client.rs
    └─ get_llm_stats(days: u32) Tauri 命令（透传到后端端点）
workbench/src/components/Dashboard/DashboardView.tsx
    └─ 新增「Agent LLM 调用」汇总卡片（近 7 天）
```

---

## Node 1：req-032 ChatView Markdown 渲染

**负责角色**：frontend-ui

### 技术分析

当前 `ChatView.tsx` 渲染逻辑（基于实际代码）：

- **历史 AI 消息**（第 284–286 行）：`<div className="bubble bubble--{msg.role}">{msg.content}</div>`，内容为纯文本节点
- **Streaming AI 气泡**（第 291–293 行）：`<div className="bubble bubble--ai bubble--streaming">{streamingText}</div>`，同为纯文本
- **用户消息**：同一渲染路径，需保持不变

当前 `ChatView.css` 注意事项：

- `.bubble` 有 `white-space: pre-wrap`（第 72 行），引入 ReactMarkdown 后 AI 气泡内部 block 元素会与此产生样式冲突，需在 `.bubble--ai` 上覆盖为 `white-space: normal`
- `.bubble--ai` 已有明确的背景色和边框，markdown 子样式在其内部叠加

**依赖现状**：检查 `workbench/package.json`，`dependencies` 中**不含** `react-markdown`、`remark-gfm`、`rehype-highlight`，需全部安装。

### 实现步骤

**步骤 1**：在 `workbench/` 目录执行依赖安装

```
pnpm add react-markdown remark-gfm rehype-highlight
```

**步骤 2**：修改 `ChatView.tsx`

在文件顶部 import 区域追加：

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github.css'
```

将第 285 行（历史消息气泡渲染）从：

```tsx
<div className={`bubble bubble--${msg.role}`}>{msg.content}</div>
```

改为：

```tsx
<div className={`bubble bubble--${msg.role}`}>
  {msg.role === 'ai' ? (
    <ReactMarkdown
      className="markdown-body"
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
    >
      {msg.content}
    </ReactMarkdown>
  ) : (
    msg.content
  )}
</div>
```

将第 292 行（streaming 气泡渲染）从：

```tsx
<div className="bubble bubble--ai bubble--streaming">{streamingText}</div>
```

改为：

```tsx
<div className="bubble bubble--ai bubble--streaming">
  <ReactMarkdown
    className="markdown-body"
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[rehypeHighlight]}
  >
    {streamingText}
  </ReactMarkdown>
</div>
```

**步骤 3**：修改 `ChatView.css`

在 `.bubble--ai` 规则块后追加：

```css
/* v0.9 req-032: AI 气泡 markdown 渲染样式覆盖 */
.bubble--ai {
  white-space: normal; /* 覆盖 .bubble 的 pre-wrap，让 markdown block 元素正常换行 */
}

.bubble--ai .markdown-body {
  font-size: 13px;
  line-height: 1.6;
  color: inherit;
}

.bubble--ai .markdown-body h1,
.bubble--ai .markdown-body h2,
.bubble--ai .markdown-body h3 {
  font-weight: 600;
  margin: 8px 0 4px;
}

.bubble--ai .markdown-body h1 { font-size: 16px; }
.bubble--ai .markdown-body h2 { font-size: 14px; }
.bubble--ai .markdown-body h3 { font-size: 13px; }

.bubble--ai .markdown-body code {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 12px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 3px;
  padding: 1px 4px;
}

.bubble--ai .markdown-body pre {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 6px 0;
}

.bubble--ai .markdown-body pre code {
  background: none;
  padding: 0;
}

.bubble--ai .markdown-body table {
  border-collapse: collapse;
  font-size: 12px;
  margin: 6px 0;
}

.bubble--ai .markdown-body th,
.bubble--ai .markdown-body td {
  border: 1px solid var(--color-border);
  padding: 4px 8px;
}

.bubble--ai .markdown-body ul,
.bubble--ai .markdown-body ol {
  padding-left: 18px;
  margin: 4px 0;
}

.bubble--ai .markdown-body p {
  margin: 4px 0;
}
```

### 实现节点 Checklist

- [x] 安装 react-markdown remark-gfm rehype-highlight 依赖（`pnpm add react-markdown remark-gfm rehype-highlight`）
- [x] ChatView.tsx：顶部追加 ReactMarkdown / remarkGfm / rehypeHighlight import
- [x] ChatView.tsx：历史消息气泡（第 285 行）—— AI 消息改为 ReactMarkdown 渲染，用户消息保持纯文本
- [x] ChatView.tsx：streaming 气泡（第 292 行）—— 改为 ReactMarkdown 渲染
- [x] ChatView.css：`.bubble--ai` 覆盖 `white-space: normal`
- [x] ChatView.css：补充 `.bubble--ai .markdown-body` 子样式（h1/h2/h3 / code / pre / table / ul / ol / p）
- [ ] 验证：发送含 `# 标题`、`**粗体**`、代码围栏块的消息，确认 AI 气泡正常渲染为 HTML
- [ ] 验证：streaming 过程中不完整 markdown（如未闭合的代码块）不报错、不崩溃
- [ ] 验证：用户消息气泡显示原始文本（`**`、`#` 等符号可见，未被渲染）

---

## Node 2：req-024 Per-agent LLM 配置

**负责角色**：backend-agent

### 技术分析

当前调度器结构（基于实际代码）：

- `AgentDispatcher` 结构体（`dispatcher/mod.rs` 第 33–42 行）含 `sub2api_url: String` 和 `agent_model: String`，均为全局单值
- `dispatch_core()` 中直接使用 `self.sub2api_url` 和 `self.agent_model` 构造请求体（第 165–171 行）
- 当前五个 Agent 角色：`Ceo / ProductAgent / ReviewAgent / TechnicalAgent / QaAgent`
- 现有代码中**不存在** `roles/` 目录或角色 YAML 配置文件，需全新建立

**角色配置文件设计**（新建 `backend/src/roles/` 目录）：

```yaml
# backend/src/roles/review_agent.yaml 示例
provider: sub2api          # sub2api | anthropic_direct（v0.9 先支持 sub2api，后者为预留）
model_id: claude-opus-4-7  # 实际发给 API 的 model 字段值
api_endpoint: ""           # 空字符串表示使用全局 self.sub2api_url
max_tokens: 4096
temperature: null          # null 表示不传 temperature 参数
```

文件命名规则：角色 enum 变体转 snake_case 后加 `.yaml`
- `Ceo` → `ceo.yaml`
- `ProductAgent` → `product_agent.yaml`
- `ReviewAgent` → `review_agent.yaml`
- `TechnicalAgent` → `technical_agent.yaml`
- `QaAgent` → `qa_agent.yaml`

**Fallback 逻辑**：YAML 文件不存在、文件解析失败、`provider` 字段缺失时，均使用 `self.sub2api_url + self.agent_model`（现有路径，零改动）。

### 实现步骤

**步骤 1**：新建 `backend/src/roles/` 目录，创建初始角色 YAML

至少为以下三个角色创建配置文件（验收要求「至少 3 个」）：
- `review_agent.yaml`（示例中使用 `claude-opus-4-7`）
- `product_agent.yaml`（使用默认 `gemini-2.5-pro`，api_endpoint 为空）
- `technical_agent.yaml`（按需配置）

**步骤 2**：在 `backend/Cargo.toml` 确认或添加 `serde_yaml` 依赖

```toml
serde_yaml = "0.9"
```

（若 Cargo.toml 中已存在则跳过）

**步骤 3**：修改 `backend/src/dispatcher/mod.rs`

在 `AgentDispatcher` 结构体中新增字段：

```rust
pub roles_dir: String,  // 角色配置目录路径，例如 "./src/roles"
```

新增 `RoleModelConfig` 结构体和 `load_role_model_config()` 函数：

```rust
#[derive(Debug, serde::Deserialize)]
struct RoleModelConfig {
    provider: Option<String>,
    model_id: Option<String>,
    api_endpoint: Option<String>,
    max_tokens: Option<u64>,
}

fn load_role_model_config(roles_dir: &str, role: &AgentRole) -> Option<RoleModelConfig> {
    let role_snake = match role {
        AgentRole::Ceo => "ceo",
        AgentRole::ProductAgent => "product_agent",
        AgentRole::ReviewAgent => "review_agent",
        AgentRole::TechnicalAgent => "technical_agent",
        AgentRole::QaAgent => "qa_agent",
    };
    let path = format!("{}/{}.yaml", roles_dir, role_snake);
    let content = std::fs::read_to_string(&path).ok()?;
    serde_yaml::from_str(&content).ok()
}
```

在 `dispatch_core()` 的 Claude API 调用部分（当前第 160–182 行「Call sub2api」注释块），替换为：

```rust
// v0.9 req-024: 读取角色级模型配置，fallback 全局默认
let role_cfg = load_role_model_config(&self.roles_dir, &task.role);
let effective_url = role_cfg
    .as_ref()
    .and_then(|c| c.api_endpoint.as_deref())
    .filter(|s| !s.is_empty())
    .unwrap_or(&self.sub2api_url);
let effective_model = role_cfg
    .as_ref()
    .and_then(|c| c.model_id.as_deref())
    .unwrap_or(&self.agent_model);
let effective_max_tokens = role_cfg
    .as_ref()
    .and_then(|c| c.max_tokens)
    .unwrap_or(4096);

info!(
    "[dispatcher] POST {} for task_id={}, role={:?}, model={}",
    effective_url, task_id, task.role, effective_model
);

let request_body = json!({
    "model": effective_model,
    "max_tokens": effective_max_tokens,
    "stream": false,
    "system": prompt.system,
    "messages": prompt.messages
});
// 同时将下方 http_client.post(&self.sub2api_url) 改为 http_client.post(effective_url)
// 即第 176 行（当前）：.post(&self.sub2api_url) → .post(effective_url)
```

**步骤 4**：修改 `backend/src/dispatcher/mod.rs` 中 `AgentDispatcher::new()` 函数签名，新增 `roles_dir: String` 参数，并在函数体内将其赋值给结构体的 `roles_dir` 字段。

当前 `new()` 签名（第 45–52 行）：

```rust
pub fn new(
    state_machine: Arc<StateMachine>,
    context_builder: Arc<ContextBuilder>,
    sub2api_key: String,
    sse_tx: broadcast::Sender<SseEvent>,
    notify_tx: broadcast::Sender<SseNotification>,
    agent_model: String,
) -> Self {
```

修改后新增 `roles_dir` 参数：

```rust
pub fn new(
    state_machine: Arc<StateMachine>,
    context_builder: Arc<ContextBuilder>,
    sub2api_key: String,
    sse_tx: broadcast::Sender<SseEvent>,
    notify_tx: broadcast::Sender<SseNotification>,
    agent_model: String,
    roles_dir: String,  // v0.9 req-024
) -> Self {
    AgentDispatcher {
        // ... 现有字段 ...
        roles_dir,
    }
}
```

**步骤 5**：在 `backend/src/main.rs` 中调用 `AgentDispatcher::new()` 处，传入 `roles_dir` 实参（如 `"./src/roles".to_string()` 或从配置读取）。

### 实现节点 Checklist

- [x] 新建 `backend/src/roles/` 目录，创建至少 3 个角色 YAML 文件（review_agent / product_agent / technical_agent）
- [x] `backend/Cargo.toml`：确认 `serde_yaml` 依赖已存在或追加
- [x] `dispatcher/mod.rs`：`AgentDispatcher` 结构体新增 `roles_dir: String` 字段
- [x] `dispatcher/mod.rs`：`AgentDispatcher::new()` 函数签名新增 `roles_dir: String` 参数，并在构造体中赋值
- [x] `dispatcher/mod.rs`：新增 `RoleModelConfig` 结构体（`provider / model_id / api_endpoint / max_tokens`）
- [x] `dispatcher/mod.rs`：新增 `load_role_model_config(roles_dir, role)` 函数，角色名 snake_case 映射 + 文件读取 + serde_yaml 解析
- [x] `dispatcher/mod.rs`：`dispatch_core()` 中替换硬编码 `self.sub2api_url / self.agent_model` 为 `effective_url / effective_model`；同时将第 176 行 `.post(&self.sub2api_url)` 改为 `.post(effective_url)`
- [x] `dispatcher/mod.rs`：fallback 逻辑（文件不存在或解析失败时使用 `self.sub2api_url + self.agent_model`）
- [x] `backend/src/main.rs`：`AgentDispatcher::new()` 调用新增传入 `roles_dir` 参数
- [ ] 测试：将 `review_agent.yaml` 配置为 `claude-opus-4-7`，触发 ReviewAgent 任务，确认日志中 `model=claude-opus-4-7`
- [ ] 测试：删除 `qa_agent.yaml`（或保持不存在），触发 QaAgent 任务，确认行为与现有一致（使用全局默认模型）

---

## Node 3：req-029（缩减版）LLM 调用成本日志

**负责角色**：backend-agent（后端部分）+ frontend-ui（前端部分）

### 技术分析

**后端**：

- 现有 `db.rs` 的 `create_tables()` 采用 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` migration 模式，新增 `llm_calls` 表直接追加即可
- 现有 `write_event_log()` 写入 `ui_events` 表，`llm_calls` 写入独立表（不复用 `ui_events`），需新建独立的 `insert_llm_call()` 函数
- `dispatcher/mod.rs` 的 `dispatch_core()` 在 API 响应成功后已经获取：`output_tokens_captured`（第 248–252 行）、`task_id`、`role_str`、`dispatch_start`（用于计算 `duration_ms`）；**缺少 input_tokens**，需从 `resp_json["usage"]["input_tokens"]` 同步读取
- 现有路由 `routes/mod.rs` 用 `pub mod` 列举各模块，新增 `llm_stats` 仅需追加一行

**前端**：

- `DashboardView.tsx` 已有 `SummaryCard` 组件，直接复用
- 新增卡片需要一次 Tauri `invoke` 调用，pattern 与 `get_token_stats_from_gateway` 完全一致
- 无数据时降级显示「暂无数据」，复用 `.dashboard__empty` 样式类

### 后端实现步骤

**步骤 1**：修改 `backend/src/db.rs`

在 `create_tables()` 函数末尾（`ui_events` 表创建之后）追加：

```rust
sqlx::query(
    r#"
    CREATE TABLE IF NOT EXISTS llm_calls (
        id            TEXT PRIMARY KEY,
        model         TEXT NOT NULL,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        duration_ms   INTEGER NOT NULL DEFAULT 0,
        called_at     TEXT NOT NULL,
        task_id       TEXT NOT NULL
    )
    "#,
)
.execute(pool)
.await
.expect("无法创建 llm_calls 表");
```

**步骤 2**：在 `backend/src/context_builder/mod.rs`（或新建 `backend/src/llm_log.rs`）新增 `insert_llm_call()` 函数

推荐直接在 `dispatcher/mod.rs` 内定义为私有异步函数，与现有 `write_event_log()` 的调用模式保持一致：

```rust
async fn insert_llm_call(
    pool: &SqlitePool,
    task_id: &str,
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    duration_ms: u64,
) {
    let id = Uuid::new_v4().to_string();
    let called_at = Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "INSERT INTO llm_calls (id, model, input_tokens, output_tokens, duration_ms, called_at, task_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(model)
    .bind(input_tokens as i64)
    .bind(output_tokens as i64)
    .bind(duration_ms as i64)
    .bind(&called_at)
    .bind(task_id)
    .execute(pool)
    .await;
}
```

**步骤 3**：修改 `backend/src/dispatcher/mod.rs` 的 `dispatch_core()`

在 API 响应成功解析后（当前第 248–261 行），同步读取 `input_tokens`：

```rust
let input_tokens_captured = resp_json
    .get("usage")
    .and_then(|u| u.get("input_tokens"))
    .and_then(|t| t.as_u64())
    .unwrap_or(0);

// output_tokens_captured 已有，继续保留
let output_tokens_captured = resp_json
    .get("usage")
    .and_then(|u| u.get("output_tokens"))
    .and_then(|t| t.as_u64())
    .unwrap_or(0);
```

在写入 `agent_dispatch_completed` 日志之后，调用：

```rust
let duration_ms = dispatch_start.elapsed().as_millis() as u64;
insert_llm_call(
    pool,
    task_id,
    effective_model,   // v0.9 req-024 引入后使用此变量；若 Node 2 未实现，用 &self.agent_model
    input_tokens_captured,
    output_tokens_captured,
    duration_ms,
).await;
```

**步骤 4**：新建 `backend/src/routes/llm_stats.rs`

```rust
// GET /api/llm-stats?days=N
// 返回：{ total_calls, total_input_tokens, total_output_tokens, by_model: [...] }
```

端点逻辑：按 `days` 参数过滤 `called_at >= (now - days * 86400s)`，聚合 `COUNT(*) / SUM(input_tokens) / SUM(output_tokens)`，按 `model` 分组返回列表及总计。

**步骤 5**：修改 `backend/src/routes/mod.rs`

追加：

```rust
pub mod llm_stats;
```

并在 `backend/src/main.rs` 的路由注册处添加 `llm_stats` 端点挂载。

**步骤 6**：修改 `workbench/src-tauri/src/commands/backend_client.rs`

新增 Tauri 命令：

```rust
#[tauri::command]
pub async fn get_llm_stats(days: u32) -> Result<serde_json::Value, String> {
    let client = make_client();
    let url = format!("{}/api/llm-stats?days={}", BACKEND_URL, days);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("get_llm_stats request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("get_llm_stats HTTP {}: {}", status, text));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("get_llm_stats parse failed: {}", e))?;

    Ok(data)
}
```

同时在 `workbench/src-tauri/src/commands/mod.rs`（或 `lib.rs`）中注册该命令。

### 前端实现步骤

**步骤 7**：修改 `workbench/src/components/Dashboard/DashboardView.tsx`

新增状态和接口定义：

```tsx
interface LlmStatsData {
  total_calls: number
  total_input_tokens: number
  total_output_tokens: number
}

const [llmStats, setLlmStats] = useState<LlmStatsData | null>(null)
const [llmStatsEmpty, setLlmStatsEmpty] = useState(false)
```

在 `useEffect` 中（可与 gateway 数据加载并列，或独立一个 useEffect）调用：

```tsx
useEffect(() => {
  invoke<LlmStatsData>('get_llm_stats', { days: 7 })
    .then((data) => {
      setLlmStats(data)
      setLlmStatsEmpty(data.total_calls === 0)
    })
    .catch(() => setLlmStatsEmpty(true))
}, [])
```

在 `dashboard__cards` 区域末尾追加 Agent LLM 汇总卡片：

```tsx
<div className="dashboard__section-title">Agent LLM 调用（近 7 天）</div>
<div className="dashboard__cards">
  {llmStatsEmpty ? (
    <div className="dashboard__empty">暂无数据</div>
  ) : llmStats ? (
    <>
      <SummaryCard label="总调用次数" value={String(llmStats.total_calls)} />
      <SummaryCard
        label="总 Input Tokens"
        value={formatTokens(llmStats.total_input_tokens)}
      />
      <SummaryCard
        label="总 Output Tokens"
        value={formatTokens(llmStats.total_output_tokens)}
      />
    </>
  ) : null}
</div>
```

### 实现节点 Checklist

- [x] `backend/src/db.rs`：`create_tables()` 末尾追加 `llm_calls` 表 DDL（7 个字段：id / model / input_tokens / output_tokens / duration_ms / called_at / task_id）
- [x] `backend/src/dispatcher/mod.rs`：API 响应成功后同步读取 `input_tokens_captured`（从 `resp_json["usage"]["input_tokens"]`）
- [x] `backend/src/dispatcher/mod.rs`：新增 `insert_llm_call()` 异步函数，使用 sqlx INSERT 写入 `llm_calls` 表
- [x] `backend/src/dispatcher/mod.rs`：`dispatch_core()` 成功路径末尾调用 `insert_llm_call()`
- [x] `backend/src/routes/llm_stats.rs`（新建）：实现 `GET /api/llm-stats?days=N` 端点，返回 `total_calls / total_input_tokens / total_output_tokens / by_model`
- [x] `backend/src/routes/mod.rs`：追加 `pub mod llm_stats;`
- [x] `backend/src/main.rs`：路由注册处挂载 `llm_stats` 端点
- [x] `workbench/src-tauri/src/commands/backend_client.rs`：新增 `get_llm_stats(days: u32)` Tauri 命令
- [x] Tauri `lib.rs`/`mod.rs`：注册 `get_llm_stats` 命令
- [x] `DashboardView.tsx`：新增 `LlmStatsData` 接口和 `llmStats / llmStatsEmpty` 状态
- [x] `DashboardView.tsx`：useEffect 调用 `get_llm_stats({ days: 7 })`
- [x] `DashboardView.tsx`：在 `dashboard__cards` 区域追加「Agent LLM 调用（近 7 天）」分组，复用 `SummaryCard` 展示 total_calls / input_tokens / output_tokens
- [ ] 验证：触发一次 Agent 任务，检查 SQLite `llm_calls` 表有记录写入（id / model / input_tokens / output_tokens / duration_ms / called_at / task_id 均非空）
- [ ] 验证：`GET /api/llm-stats?days=7` 返回正确 JSON，`total_calls >= 1`
- [ ] 验证：Dashboard 打开，「Agent LLM 调用」卡片数据与 `llm_calls` 表一致
- [ ] 验证：清空 `llm_calls` 表后刷新 Dashboard，卡片显示「暂无数据」，不报错

---

## 测试清单

### T1：Node 1 验收（req-032 Markdown 渲染）

| 编号 | 测试项 | 操作 | 期望结果 |
|------|--------|------|---------|
| T1-01 | 标题渲染 | 发送一条 AI 消息（或让 AI 回复含 `# H1 ## H2 ### H3` 的内容） | 气泡内渲染为对应 HTML heading，字号依次缩小，前缀 `#` 符号不可见 |
| T1-02 | 粗体 / 斜体 | 消息含 `**粗体**` 和 `*斜体*` | 分别渲染为 `<strong>`（加粗）和 `<em>`（斜体），原始符号不显示 |
| T1-03 | 围栏代码块 | 消息含 ` ```python ... ``` ` | 渲染为等宽字体区块，有背景色区分；`rehype-highlight` 代码高亮生效 |
| T1-04 | 行内代码 | 消息含 `` `code` `` | 渲染为高亮 span，字体切换为 JetBrains Mono |
| T1-05 | 无序列表 | 消息含 `- item1 \n- item2` | 渲染为 `<ul>`，带缩进和列表符 |
| T1-06 | 有序列表 | 消息含 `1. item1 \n2. item2` | 渲染为 `<ol>`，带序号 |
| T1-07 | 表格渲染 | 消息含 Markdown 表格（GFM 扩展） | 渲染为 `<table>`，有边框线（依赖 `remark-gfm`） |
| T1-08 | 用户消息不受影响 | 发送含 `**text**` 的用户消息 | `bubble--user` 显示原始文本 `**text**`，未渲染为 `<strong>` |
| T1-09 | Streaming 不崩溃 | 触发一次 AI 流式回复，包含未闭合代码块（如只有开头 ` ``` ` 无结尾） | streaming 过程不报 React 错误，渲染降级为纯文本或部分渲染，页面不白屏 |
| T1-10 | XSS 安全性 | 构造含 `<script>alert(1)</script>` 的 AI 消息 | `react-markdown` 默认不渲染 raw HTML，脚本不执行，内容以转义文本显示 |

### T2：Node 2 验收（req-024 Per-agent LLM 配置）

| 编号 | 测试项 | 操作 | 期望结果 |
|------|--------|------|---------|
| T2-01 | YAML 文件格式合法 | 读取 `backend/src/roles/*.yaml`，用 YAML linter 或 serde_yaml 解析 | 至少 3 个文件解析无错，字段符合设计（provider / model_id / api_endpoint / max_tokens） |
| T2-02 | 调度器读取配置 | 配置 `review_agent.yaml` 为 `model_id: claude-opus-4-7`，触发 ReviewAgent 任务 | 后端日志出现 `model=claude-opus-4-7`；`llm_calls` 表（若 Node 3 已实现）记录的 `model` 字段为 `claude-opus-4-7` |
| T2-03 | Fallback 行为 | 删除或不创建 `qa_agent.yaml`，触发 QaAgent 任务 | 后端日志使用全局默认模型（`gemini-2.5-pro`）；任务正常 Completed，无错误 |
| T2-04 | 无前端代码改动 | 检查前端 git diff | `workbench/src/` 下无新增下拉框或模型选择 UI 组件 |
| T2-05 | 配置热更新（可选）| 修改 YAML 文件后重启后端，再触发任务 | 新配置生效（v0.9 不要求无重启热更新，文件读取时机为 dispatch_core 调用时） |

### T3：Node 3 验收（req-029 LLM 成本日志）

| 编号 | 测试项 | 操作 | 期望结果 |
|------|--------|------|---------|
| T3-01 | 表结构创建 | 启动后端，用 SQLite 客户端检查 `llm_calls` 表 | 表存在，包含 `id / model / input_tokens / output_tokens / duration_ms / called_at / task_id` 七个字段，类型符合 DDL |
| T3-02 | 数据写入 | 触发一次 Agent 任务（任意角色） | `SELECT * FROM llm_calls` 有新增记录，各字段非空，`input_tokens + output_tokens > 0` |
| T3-03 | 数据准确性 | 对比 `llm_calls` 记录与 `ui_events` 的 `agent_dispatch_completed` 记录（同一 task_id） | `output_tokens` 数值一致（均来自 API response `usage.output_tokens`） |
| T3-04 | API 端点 | 调用 `GET /api/llm-stats?days=7` | 返回 200 JSON，包含 `total_calls / total_input_tokens / total_output_tokens`，数值与 `llm_calls` 表手动 COUNT/SUM 一致 |
| T3-05 | Dashboard 卡片可见 | 打开 Tauri 应用 → Dashboard → 滚动到「Agent LLM 调用」区域 | 卡片显示正确数据（总调用次数 / 总 Input / 总 Output） |
| T3-06 | 无数据降级 | 清空 `llm_calls` 表后刷新 Dashboard | 「Agent LLM 调用」区域显示「暂无数据」文字，无 JS 报错，无崩溃 |
| T3-07 | 已知局限确认 | 若 Node 2 配置了非 sub2api endpoint 的角色并触发任务 | `llm_calls` 记录不写入（v0.9 已知局限，非 bug），日志中无错误 |

---

## Out of Scope 约束（与 product.md 一致）

- **不替换 sub2api**：Node 2 的多 provider 支持仅为角色级 YAML 配置；`sub2api_url` 字段保留，全局 fallback 路径不变
- **不新增代理路由**：`llm_calls` 写入挂载在现有 sub2api 调用路径，不引入新的 HTTP 代理或 SSE 转发层
- **不实现 Gateway Phase 1/2**：`GET /api/llm-stats` 是只读统计端点，非透明代理路由

---

## 修订记录

| 版本 | 日期 | 修改内容 |
|------|------|---------|
| doc_revision 1 | 2026-05-20 | 初稿，technical-planning 基于 v0.9 product.md 创建 |
| doc_revision 2 | 2026-05-20 | review-agent 修复：① Node 2 实现步骤补充「修改 `AgentDispatcher::new()` 函数签名新增 `roles_dir` 参数」（步骤 4，原步骤 4 顺延为步骤 5）；② Node 2 Checklist 补充对应条目；③ Node 2 步骤 3 代码注释明确 `.post()` 调用修改的具体行号（第 176 行） |
| doc_revision 3 | 2026-05-20 | workbench-ceo 审批通过，status: draft → approved |
