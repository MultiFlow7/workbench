---
project: 工作台
version: v0.5
status: approved
doc_revision: 3
created: 2026-05-18
updated: 2026-05-19
author: workbench-technical
approved_by: workbench-ceo
approved_at: 2026-05-19
---

# technical.md · 工作台 v0.5

---

## 架构概览

v0.5 全部变更集中在 Axum 后端服务（43.135.174.27:8081）和前端 DashboardView，不涉及 Tauri Rust 命令的新增（除 `get_token_stats_from_gateway` 一个新命令）。

变更范围：
- **Rust Axum 后端**：
  - `src/routes/llm_proxy.rs`：扩展流式 SSE 转发路径（Node 1）
  - `src/state.rs`（或 `main.rs`）：新增 `key_index: AtomicUsize`，`AppState` 包含 Google key 池（Node 2）
  - `Cargo.toml`：新增 `tokio-stream`（或确认 axum 已含 stream 能力）
- **配置**：`workbench.env` 迁移 `GOOGLE_API_KEY` → `GOOGLE_API_KEYS`；修改 `AI_ENDPOINT`（Node 3）
- **Tauri 前端**：
  - 新增 Tauri 命令 `get_token_stats_from_gateway`（Node 4）
  - 扩展 `DashboardView.tsx`（Node 5）

---

## Rust 后端（Axum，43.135.174.27:8081）

### Node 1：`/llm/proxy` 扩展流式 SSE 转发（`src/routes/llm_proxy.rs`）

**流式 vs 非流式路由判断**（在现有 handler 入口添加）：

```rust
pub async fn llm_proxy(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let is_streaming = body.get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if is_streaming {
        llm_proxy_stream(state, body).await
    } else {
        llm_proxy_nonstream(state, body).await  // v0.4 已有逻辑，返回类型需同步更新为 Response
    }
}
```

> **注**：`llm_proxy_nonstream`（v0.4 实现）的返回类型须同步改为 `Response`，否则两分支类型不统一编译失败。

**流式 handler `llm_proxy_stream`**：

```rust
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use futures::StreamExt;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use std::sync::atomic::Ordering;
use uuid::Uuid;

async fn llm_proxy_stream(
    state: AppState,
    body: serde_json::Value,
) -> Response {
    let model = body["model"].as_str().unwrap_or("unknown").to_string();
    let provider = detect_provider(&model);
    let ts = chrono::Utc::now().timestamp_millis();
    let start = std::time::Instant::now();

    // 未知 provider 早返回（detect_provider 返回 "unknown" 而非 None）
    if provider == "unknown" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": format!("Unsupported model: {}", model)})),
        ).into_response();
    }

    // 构造请求（多 key 轮转）
    let result = build_and_send_request(&state, &model, provider, &body).await;

    let resp = match result {
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            ).into_response();
        }
        Ok(r) if !r.status().is_success() => {
            let status = r.status();
            let bytes = r.bytes().await.unwrap_or_default();
            return (status, bytes).into_response();
        }
        Ok(r) => r,
    };

    // tee 模式：SSE 流逐 chunk 转发，同时提取 usage
    let (tx, rx) = mpsc::channel::<Result<Event, std::convert::Infallible>>(64);
    let pool = state.pool.clone();
    let model_clone = model.clone();

    tokio::spawn(async move {
        let mut byte_stream = resp.bytes_stream();
        let mut usage_input: Option<i64> = None;
        let mut usage_output: Option<i64> = None;
        let mut current_event_type: Option<String> = None;  // 跟踪 SSE event: 行类型

        while let Some(chunk) = byte_stream.next().await {
            let Ok(bytes) = chunk else { break };
            let text = String::from_utf8_lossy(&bytes);

            for line in text.lines() {
                // 解析 usage（tee：读取但不修改）
                if let Some(inp) = parse_sse_usage_input(line) { usage_input = Some(inp); }
                if let Some(out) = parse_sse_usage_output(line) { usage_output = Some(out); }

                // message_stop → 触发 llm_calls 写入
                if line.contains("\"message_stop\"") {
                    let lat_ms = start.elapsed().as_millis() as i64;
                    let id = Uuid::new_v4().to_string();
                    let _ = sqlx::query(
                        "INSERT INTO llm_calls
                         (id, ts, model, provider, input_tokens, output_tokens, latency_ms)
                         VALUES (?, ?, ?, ?, ?, ?, ?)"
                    )
                    .bind(&id).bind(ts).bind(&model_clone).bind(provider)
                    .bind(usage_input).bind(usage_output).bind(lat_ms)
                    .execute(&pool).await;
                }

                // 转发 SSE：先记录 event 类型，data 行剥离前缀后发送
                // 避免双重 data: 前缀（Event::default().data(line) 会包一层，导致 data: data: {...}）
                // 空行是 SSE 事件边界，重置 event 类型（防止跨事件错误附加）
                if line.is_empty() {
                    current_event_type = None;
                } else if let Some(ev_type) = line.strip_prefix("event: ") {
                    current_event_type = Some(ev_type.to_string());
                } else if let Some(data_content) = line.strip_prefix("data: ") {
                    let mut evt = Event::default().data(data_content);
                    if let Some(ref ev) = current_event_type {
                        evt = evt.event(ev);
                        current_event_type = None;
                    }
                    if tx.send(Ok(evt)).await.is_err() { return; }
                }
            }
        }
    });

    Sse::new(ReceiverStream::new(rx))
        .keep_alive(KeepAlive::default())
        .into_response()
}
```

**SSE usage 解析辅助函数**（与 v0.3 `stream_ai` 解析的 SSE 格式一致，实现在 Axum 侧）：

```rust
// 从 message_start 事件提取 input_tokens
// JSON path: data["message"]["usage"]["input_tokens"]
fn parse_sse_usage_input(line: &str) -> Option<i64> {
    let data = line.strip_prefix("data: ")?;
    let val: serde_json::Value = serde_json::from_str(data).ok()?;
    if val["type"].as_str()? == "message_start" {
        val["message"]["usage"]["input_tokens"].as_i64()
    } else {
        None
    }
}

// 从 message_delta 事件提取 output_tokens
// JSON path: data["usage"]["output_tokens"]（顶层 usage，不在 delta 内）
fn parse_sse_usage_output(line: &str) -> Option<i64> {
    let data = line.strip_prefix("data: ")?;
    let val: serde_json::Value = serde_json::from_str(data).ok()?;
    if val["type"].as_str()? == "message_delta" {
        val["usage"]["output_tokens"].as_i64()
    } else {
        None
    }
}
```

**`Cargo.toml` 新增**（若 axum 未自带 sse feature）：

```toml
axum = { version = "0.7", features = ["macros", "http2"] }
tokio-stream = "0.1"
futures = "0.3"
```

**验收**：
- `curl -N -X POST .../llm/proxy -d '{"model":"claude-haiku-4-5-20251001","messages":[{"role":"user","content":"hi"}],"max_tokens":10,"stream":true}'` 输出多行 SSE 事件，最终含 `event: message_stop` 的行
- 流式完成后，`llm_calls` 表有新记录，`input_tokens` 和 `output_tokens` 非 null
- 非流式请求（无 `"stream":true`）行为不变（走 v0.4 代码路径）
- 未知 model（如 `"gpt-4"`）返回 400 含「Unsupported model」错误，不 panic

---

### Node 2：多 key 轮转（`AppState` + `llm_proxy.rs` 扩展）

**`AppState` 扩展**（`src/state.rs` 或 `main.rs`）：

```rust
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

pub struct AppState {
    pub pool: SqlitePool,
    pub http_client: reqwest::Client,
    // v0.5 新增
    pub google_keys: Vec<String>,          // 从 GOOGLE_API_KEYS 解析，只读
    pub google_key_index: Arc<AtomicUsize>, // 轮询计数器，多请求安全
    pub anthropic_key: String,
}

// 初始化（在 main.rs 的 AppState 构建处）
let google_keys_raw = std::env::var("GOOGLE_API_KEYS").unwrap_or_default();
let google_keys: Vec<String> = google_keys_raw
    .split(',')
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
    .collect();
// google_keys 为空时 warn，不 panic（服务仍可启动，但 Google 请求会 500）
if google_keys.is_empty() {
    tracing::warn!("GOOGLE_API_KEYS not set or empty; Google provider unavailable");
}
let anthropic_key = std::env::var("ANTHROPIC_API_KEY").unwrap_or_default();
```

**轮转取 key 函数**（在 `llm_proxy.rs` 中调用）：

```rust
fn pick_google_key(state: &AppState) -> Option<&str> {
    if state.google_keys.is_empty() { return None; }
    let idx = state.google_key_index.fetch_add(1, Ordering::Relaxed) % state.google_keys.len();
    Some(&state.google_keys[idx])
}
```

**单 key 429 切换逻辑**（集成到 `build_and_send_request`）：

```rust
// 返回类型改为 Box<dyn Error>，避免手动构造 reqwest::Error
async fn build_and_send_request(
    state: &AppState,
    model: &str,
    provider: &str,
    body: &serde_json::Value,
) -> Result<reqwest::Response, Box<dyn std::error::Error + Send + Sync>> {
    match provider {
        "anthropic" => {
            state.http_client
                .post(ANTHROPIC_URL)
                .header("x-api-key", &state.anthropic_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(body)
                .send()
                .await
                .map_err(Into::into)
        }
        "google" => {
            let url = format!("{}{}:generateContent", GOOGLE_URL_PREFIX, model);
            // 第一次尝试
            let Some(key) = pick_google_key(state) else {
                return Err("No Google API keys configured".into());
            };
            let resp = state.http_client
                .post(&url).bearer_auth(key).json(body).send().await
                .map_err(Into::into)?;
            // 429 时仅在有多个 key 时切换重试（单 key 场景重试同一 key 无意义）
            if resp.status().as_u16() == 429 && state.google_keys.len() > 1 {
                if let Some(key2) = pick_google_key(state) {
                    return state.http_client
                        .post(&url).bearer_auth(key2).json(body).send().await
                        .map_err(Into::into);
                }
            }
            Ok(resp)
        }
        _ => Err(format!("Unsupported provider: {}", provider).into())
    }
}
```

**验收**：
- 配置 2 个 Google key，连续 4 次 Google 请求，`RUST_LOG=debug` 日志中两个 key 各出现 2 次
- 单 key 429 场景（mock 或使用已过期 key）：gateway 切换 key 并成功返回
- Anthropic 请求不使用 key 轮转，`google_keys` 为空时 Google 请求返回 500 含「Google provider unavailable」错误信息

---

### Node 3：配置迁移（`workbench.env` + AI_ENDPOINT 切换）

**分两步操作（服务器侧，非代码变更）**：

**步骤 1：迁移 Google key（在 Phase 2 SSE 验收前完成）**

```bash
# 编辑 /data/workbench/workbench.env
# 删除旧行：GOOGLE_API_KEY=key1
# 追加新行：GOOGLE_API_KEYS=key1,key2,key3
systemctl restart workbench-backend
```

验证：`curl http://43.135.174.27:8081/llm/proxy -d '{"model":"gemini-2.5-pro",...}'` 正常响应。

**步骤 2：切换 AI_ENDPOINT（在 Phase 2 SSE + 多 key 轮转均验收后）**

```bash
# 修改 AI_ENDPOINT（原值：http://43.135.174.27:8080）
AI_ENDPOINT=http://43.135.174.27:8081/llm/proxy
systemctl reload workbench-backend  # 或 restart，取决于 service 配置
```

回退：改回 `AI_ENDPOINT=http://43.135.174.27:8080` 并 reload。

---

## 前端（Tauri React）

### Node 4：新增 Tauri 命令 `get_token_stats_from_gateway`（Rust 侧）

此命令查询 `llm_calls` SQLite 表，返回与 `DayModelBucket[]` 结构相同的数据，供仪表盘「完整调用」视图使用。

**Rust 侧命令**（新建 `src/commands/token_stats_gateway.rs`）：

```rust
use sqlx::SqlitePool;

#[tauri::command]
pub async fn get_token_stats_from_gateway(
    pool: tauri::State<'_, SqlitePool>,
    date_from: Option<String>,  // 可选过滤，格式 "YYYY-MM-DD"
    date_to: Option<String>,
) -> Result<Vec<DayModelBucketRow>, String> {
    // 使用运行时版本（非宏），避免 sqlx::query_as! 需编译期 DATABASE_URL
    let rows: Vec<DayModelBucketRow> = sqlx::query_as::<_, DayModelBucketRow>(
        r#"
        SELECT
            date(ts / 1000, 'unixepoch') AS date,
            model,
            SUM(COALESCE(input_tokens, 0))  AS input_tokens,
            SUM(COALESCE(output_tokens, 0)) AS output_tokens
        FROM llm_calls
        WHERE
            (? IS NULL OR date(ts / 1000, 'unixepoch') >= ?)
            AND (? IS NULL OR date(ts / 1000, 'unixepoch') <= ?)
        GROUP BY date(ts / 1000, 'unixepoch'), model
        ORDER BY date ASC
        "#,
    )
    .bind(&date_from).bind(&date_from)
    .bind(&date_to).bind(&date_to)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[derive(serde::Serialize, sqlx::FromRow)]
pub struct DayModelBucketRow {
    pub date: String,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
}
```

前端接收类型与 `DayModelBucket` 对齐（`costUSD` 字段由前端用 `calcCostUSD` 计算，不从 Rust 侧返回）：

```typescript
// 调用
const rows = await invoke<DayModelBucketRow[]>('get_token_stats_from_gateway', {
  dateFrom: cutoffDate ?? null,
  dateTo: null,
})
// 转换为 DayModelBucket（含 costUSD 计算）
const buckets: DayModelBucket[] = rows.map(r => ({
  date: r.date,
  model: r.model,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  costUSD: calcCostUSD(r.model, r.input_tokens, r.output_tokens),
}))
```

在 `main.rs` 注册命令：
```rust
.invoke_handler(tauri::generate_handler![
    // 现有命令...
    token_stats_gateway::get_token_stats_from_gateway,
])
```

**验收**：`llm_calls` 表有 3 条记录（2 天，2 个模型），`invoke('get_token_stats_from_gateway', {})` 返回 2 行（按 date+model 分组后），`input_tokens` 和 `output_tokens` 为累加值；空表时返回空数组，不报错。

---

### Node 5：`DashboardView.tsx` 扩展 — 双视图切换

在 v0.4 `DashboardView.tsx` 基础上扩展（不重写）：

**`aggregateFromBuckets` 辅助函数**（将 `DayModelBucket[]` 聚合为 `AggregatedStats`，与 `aggregateAtoms` 计算口径一致）：

```typescript
// 从已分好桶的 DayModelBucket[] 直接计算聚合统计
// aggregateAtoms 接收 QAAtom[]，gateway 视图已是 DayModelBucket[]，需要此函数
function aggregateFromBuckets(buckets: DayModelBucket[]): AggregatedStats {
  const totalInputTokens = buckets.reduce((s, b) => s + b.inputTokens, 0)
  const totalOutputTokens = buckets.reduce((s, b) => s + b.outputTokens, 0)

  const knownBuckets = buckets.filter(b => b.costUSD !== null)
  const knownModelCostUSD = knownBuckets.length > 0
    ? knownBuckets.reduce((s, b) => s + b.costUSD!, 0)
    : null
  const unknownModelCount = new Set(
    buckets.filter(b => b.costUSD === null).map(b => b.model)
  ).size

  // 日均分母：有数据的天数（非 30）
  const activeDays = new Set(buckets.map(b => b.date)).size
  const dailyAvgInputTokens = activeDays > 0 ? totalInputTokens / activeDays : 0
  const dailyAvgOutputTokens = activeDays > 0 ? totalOutputTokens / activeDays : 0

  return {
    buckets,
    totalInputTokens,
    totalOutputTokens,
    knownModelCostUSD,
    unknownModelCount,
    dailyAvgInputTokens,
    dailyAvgOutputTokens,
  }
}
```

**新增状态与数据获取**：

```typescript
const [dataSource, setDataSource] = useState<'atoms' | 'gateway'>('atoms')
const [gatewayBuckets, setGatewayBuckets] = useState<DayModelBucket[]>([])
const [gatewayLoading, setGatewayLoading] = useState(false)
const [gatewayEmpty, setGatewayEmpty] = useState(false)

// 切换到 gateway 视图时加载数据（依赖 cutoffDate 而非 dateRange，两者保持一致）
useEffect(() => {
  if (dataSource !== 'gateway') return
  setGatewayLoading(true)
  invoke<DayModelBucketRow[]>('get_token_stats_from_gateway', {
    dateFrom: cutoffDate ?? null,
    dateTo: null,
  }).then(rows => {
    const buckets = rows.map(r => ({
      date: r.date,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costUSD: calcCostUSD(r.model, r.input_tokens, r.output_tokens),
    }))
    setGatewayBuckets(buckets)
    setGatewayEmpty(buckets.length === 0)
  }).catch(() => setGatewayEmpty(true))
  .finally(() => setGatewayLoading(false))
}, [dataSource, cutoffDate])  // 与 fetch body 中的 cutoffDate 保持一致

// 当前视图的聚合统计
// gateway 视图使用 aggregateFromBuckets（接收 DayModelBucket[]）
// atoms 视图使用 aggregateAtoms（接收 QAAtom[]），类型不同不能混用
const activeStats = useMemo(() => {
  if (dataSource === 'atoms') return stats
  return aggregateFromBuckets(gatewayBuckets)
}, [dataSource, stats, gatewayBuckets])
```

**视图切换标签 UI**（在成本 Banner 上方添加）：

```tsx
<div className="dashboard__source-tabs">
  <button
    className={`source-tab ${dataSource === 'atoms' ? 'active' : ''}`}
    onClick={() => setDataSource('atoms')}
  >
    对话记录（atom）
  </button>
  <button
    className={`source-tab ${dataSource === 'gateway' ? 'active' : ''}`}
    onClick={() => setDataSource('gateway')}
  >
    完整调用（gateway）
  </button>
</div>

{dataSource === 'gateway' && gatewayEmpty && (
  <div className="dashboard__empty">
    gateway 数据尚未积累，发送消息后将自动记录
  </div>
)}
{dataSource === 'gateway' && gatewayLoading && (
  <div className="dashboard__loading">加载中...</div>
)}
```

**验收**：
- 点击「完整调用（gateway）」标签，仪表盘切换为 `llm_calls` 数据，卡片数值更新；`llm_calls` 为空时显示降级提示
- 点击「对话记录（atom）」标签，切换回 v0.4 的 atom frontmatter 数据，数值恢复
- 两个视图的「日均消耗」分母均为有记录天数，切换视图后计算口径一致（数值可能不同，因为数据来源不同）

---

## 测试计划

| 测试项 | 步骤 | 预期 |
|-------|------|------|
| T1: SSE 流式转发 | curl -N POST /llm/proxy，含 stream:true | 多行 SSE 输出，含 event: message_stop |
| T2: 流式 usage 写入 | 流式完成后查 llm_calls | input_tokens 和 output_tokens 非 null |
| T3: 非流式兼容 | curl POST /llm/proxy，不含 stream | v0.4 行为不变，llm_calls 有记录 |
| T4: Tauri 流式对话 | 切换 AI_ENDPOINT 后发消息 | 流式回复正常，llm_calls 有记录，qa_atom 有 token 字段 |
| T5: sub2api 备用 | 切换 AI_ENDPOINT 回 sub2api | 对话正常，llm_calls 无新记录 |
| T6: key 轮转 | 2 个 Google key，连续 4 次请求 | debug 日志两个 key 各用 2 次 |
| T7: 单 key 429 | mock 第一个 key 返回 429 | gateway 切换到第二个 key，响应成功 |
| T8: gateway 视图数据 | 切换到「完整调用」视图 | 显示 llm_calls 数据，数值不同于 atom 视图 |
| T9: gateway 视图空数据 | llm_calls 表清空后切换视图 | 显示降级提示，不报错 |
| T10: 视图切换计算一致性 | 对比两视图的「日均」分母 | 均为有记录天数（行为描述可对比） |
| T11: 未知 model | POST /llm/proxy 传 model: "gpt-4" | 返回 400「Unsupported model」，不 panic |

---

## 实现节点 Checklist

### 阶段一：Axum 后端扩展（Node 1-2）

- [ ] Node 1：`llm_proxy.rs` 入口判断 `is_streaming`，新建 `llm_proxy_stream` 函数（返回 `Response`）
- [ ] Node 1：`llm_proxy_nonstream` 返回类型同步改为 `Response`（避免分支类型不统一）
- [ ] Node 1：实现 tee 模式（tokio::spawn + mpsc channel + ReceiverStream）
- [ ] Node 1：新增 `parse_sse_usage_input` / `parse_sse_usage_output`（含 JSON path 注释）
- [ ] Node 1：SSE 转发使用 `current_event_type` 跟踪 + 剥离 `data: ` 前缀后传入 `.data()`
- [ ] Node 1：`message_stop` 检测后写入 `llm_calls`
- [ ] Node 1：T1/T2/T3/T11 验收通过（需填写 API keys 后测试）
- [ ] Node 2：`AppState` 新增 `google_keys: Vec<String>` + `google_key_index: Arc<AtomicUsize>`
- [ ] Node 2：`build_and_send_request` 提取为公共函数，返回类型 `Box<dyn Error + Send + Sync>`
- [ ] Node 2：`workbench.env` 迁移 `GOOGLE_API_KEY` → `GOOGLE_API_KEYS`（待用户填写）
- [ ] Node 2：T6/T7 验收通过（debug 日志确认）
- [ ] `cargo build --release` 并重启 systemd 服务

### 阶段二：AI_ENDPOINT 切换（Node 3）

- [ ] Node 3：Phase 2 SSE + 多 key 轮转均验收通过后，修改 `AI_ENDPOINT`
- [ ] T4/T5 验收通过（流式对话 + 回退测试）

### 阶段三：前端 DashboardView 扩展（Node 4-5）

- [ ] Node 4：`get_token_stats_from_gateway` Tauri 命令（实现为 HTTP 调用服务器 `/llm/stats`，而非本地 SQLite，与 existing backend_client.rs 模式一致）
- [ ] Node 4：在 `lib.rs` 注册命令
- [ ] Node 5：新增 `aggregateFromBuckets` 函数（接收 `DayModelBucket[]`，与 `aggregateAtoms` 计算口径一致）
- [ ] Node 5：`DashboardView.tsx` 新增 `dataSource` 状态 + 视图切换标签 + gateway 数据加载
- [ ] Node 5：T8/T9/T10 手工验收通过

---

## 依赖说明

- **新 Rust 依赖（Axum 后端）**：`tokio-stream`、`futures`（若未有）；`axum` sse feature
- **Tauri 已有**：`sqlx`、`tauri`、`serde`
- **前端无新依赖**：`invoke` 使用已有 Tauri API

---

## 修订记录

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1 | 2026-05-18 | workbench-technical | 初稿，含 SSE tee 模式、多 key 轮转、AI_ENDPOINT 切换、llm_calls Tauri 命令、DashboardView 双视图扩展 |
| v2 | 2026-05-18 | workbench-technical | review-agent Round 1 修复：SSE 双重 data: 前缀（B-01）、impl IntoResponse 类型不统一（B-02）、aggregateAtoms([]) 逻辑错误→aggregateFromBuckets（B-03）、unknown model unreachable!()→早返回400（B-04）、todo!()→proper error（B-05）、单key 429 无效重试（B-06）、sqlx::query_as! 宏→运行时版本（B-07）、cutoffDate vs dateRange 不一致（B-08）、latency_ms.unwrap() 冗余（W-01） |
| v3 | 2026-05-19 | workbench-technical | review-agent Round 2 修复：W-02 current_event_type 空行未重置（新增 line.is_empty() 分支重置 event 类型，符合 SSE 规范事件边界语义） |
