---
project: 工作台
version: v0.4
status: draft
doc_revision: 1
created: 2026-05-18
updated: 2026-05-18
author: workbench-technical
---

# technical.md · 工作台 v0.4

---

## 架构概览

v0.4 同时涉及两个执行环境：
- **Tauri 桌面层**（React + Rust commands）：新增仪表盘视图（req-028），包含数据聚合和图表展示
- **Axum 后端服务**（43.135.174.27:8081，v0.2 已部署）：新增 `/llm/proxy` 路由和 `llm_calls` 表（req-029 Phase 1）

变更范围：
- **Rust 后端（Axum）**：新增 `src/routes/llm_proxy.rs`、数据库 migration 逻辑、`Cargo.toml` 依赖（uuid、reqwest）
- **Rust Tauri 命令**（可选，取决于议题 E）：若选 E2，新增 `get_token_stats` 命令
- **前端**：新增 `src/constants/modelPrices.ts`、`src/utils/tokenAggregation.ts`、`src/components/Dashboard/DashboardView.tsx`、`TokenTimeChart.tsx`、扩展 `layoutSlice.ts`、扩展 `NavIcons.tsx`
- **环境配置**：`/data/workbench/workbench.env` 追加 `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`

**重要决策依赖**：
- **议题 D**（图表库）影响 Node 9 的实现方式，见 ui-decisions.html；technical.md 以 D2（CSS+SVG 手写）为默认实现
- **议题 E**（数据聚合位置）影响 Node 7 是否替换为后端命令，见 ui-decisions.html；technical.md 以 E1（前端 JS）为默认实现

---

## Rust 后端（Axum，43.135.174.27:8081）

### Node 1：`Cargo.toml` 新增依赖

在 `workbench-backend/Cargo.toml` 的 `[dependencies]` 中追加：

```toml
uuid = { version = "1", features = ["v4"] }
reqwest = { version = "0.12", features = ["json"] }
```

> `reqwest` 0.12 默认含 tokio 运行时和 rustls TLS，无需额外 feature 声明即可在 Axum 环境中异步使用。若 v0.2 已引入 reqwest 0.11，升级至 0.12（或改为 `features = ["json", "rustls-tls"]`）。`uuid` 用于生成 `llm_calls.id`。

**验收**：`cargo check` 无新错误。

---

### Node 2：数据库 migration — `llm_calls` 表

假设现有 migration 函数签名为 `async fn setup_db(pool: &SqlitePool) -> Result<()>`，在其中追加建表语句（`IF NOT EXISTS` 兼容旧库，服务重启安全）：

```rust
sqlx::query(
    "CREATE TABLE IF NOT EXISTS llm_calls (
        id            TEXT PRIMARY KEY,
        ts            INTEGER NOT NULL,
        model         TEXT NOT NULL,
        provider      TEXT NOT NULL,
        input_tokens  INTEGER,
        output_tokens INTEGER,
        latency_ms    INTEGER,
        qa_atom_id    TEXT,
        agent_role    TEXT
    )"
).execute(pool).await?;
```

**验收**：Axum 服务启动后，`sqlite3 /data/workbench/workbench.db ".tables"` 输出包含 `llm_calls`；再次重启服务不报错（`IF NOT EXISTS` 幂等）。

---

### Node 3：`/data/workbench/workbench.env` 追加 API key

在现有 env 文件末尾追加（服务器侧操作，非代码变更）：

```
ANTHROPIC_API_KEY=<Anthropic API key>
GOOGLE_API_KEY=<Google API key>
```

Rust 侧读取：`std::env::var("ANTHROPIC_API_KEY")` / `std::env::var("GOOGLE_API_KEY")`。两个变量在路由处理时按需读取，缺失时返回 500（不在服务启动时 panic，保持 sub2api 等其他功能不受影响）。

---

### Node 4：新增 `src/routes/llm_proxy.rs`

**导入声明**：

```rust
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use tracing;
use uuid::Uuid;
// AppState 从 crate 的 state 模块引入，含 pool: SqlitePool + http_client: reqwest::Client
use crate::state::AppState;
```

**Provider 推导函数与 URL 常量**：

```rust
fn detect_provider(model: &str) -> &'static str {
    if model.starts_with("claude-") { "anthropic" }
    else if model.starts_with("gemini-") { "google" }
    else { "unknown" }
}

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const GOOGLE_URL_PREFIX: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/";
// Google URL 格式：{GOOGLE_URL_PREFIX}{model}:generateContent
```

**路由 handler（非流式）**：

```rust
pub async fn llm_proxy(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let model = body["model"].as_str().unwrap_or("unknown").to_string();
    let provider = detect_provider(&model);
    let ts = chrono::Utc::now().timestamp_millis();

    // 按 provider 构造不同的转发请求（认证方式不同）
    let start = std::time::Instant::now();
    let result = match provider {
        "anthropic" => {
            let api_key = std::env::var("ANTHROPIC_API_KEY").unwrap_or_default();
            state.http_client
                .post(ANTHROPIC_URL)
                .header("x-api-key", &api_key)          // Anthropic 使用 x-api-key 头
                .header("anthropic-version", "2023-06-01")  // Anthropic 要求版本头
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
        }
        "google" => {
            let api_key = std::env::var("GOOGLE_API_KEY").unwrap_or_default();
            let url = format!("{}{}:generateContent", GOOGLE_URL_PREFIX, model);
            state.http_client
                .post(&url)
                .bearer_auth(&api_key)                   // Google 使用 Bearer Token
                .json(&body)
                .send()
                .await
        }
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "unknown provider for model"})),
            ).into_response();
        }
    };

    match result {
        Err(e) => {
            // 网络错误（DNS 失败/连接超时等）：不写 llm_calls，返回 502
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            ).into_response()
        }
        Ok(resp) => {
            let latency_ms = start.elapsed().as_millis() as i64;
            let status = resp.status();

            if !status.is_success() {
                // provider 返回 4xx/5xx：原样透传状态码和 body，不写 llm_calls
                let body_bytes = resp.bytes().await.unwrap_or_default();
                return (status, body_bytes).into_response();
            }

            let resp_json: serde_json::Value = resp.json().await.unwrap_or_default();

            // 提取 usage（路径因 provider 而异）
            // Anthropic: resp["usage"]["input_tokens"] / ["output_tokens"]
            // Google:    resp["usageMetadata"]["promptTokenCount"] / ["candidatesTokenCount"]
            let input_tokens: Option<i64> = resp_json["usage"]["input_tokens"]
                .as_i64()
                .or_else(|| resp_json["usageMetadata"]["promptTokenCount"].as_i64());
            let output_tokens: Option<i64> = resp_json["usage"]["output_tokens"]
                .as_i64()
                .or_else(|| resp_json["usageMetadata"]["candidatesTokenCount"].as_i64());

            // 写入 llm_calls（失败只记日志，不阻断响应）
            let id = Uuid::new_v4().to_string();
            if let Err(e) = sqlx::query(
                "INSERT INTO llm_calls
                 (id, ts, model, provider, input_tokens, output_tokens, latency_ms)
                 VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&id)
            .bind(ts)
            .bind(&model)
            .bind(provider)
            .bind(input_tokens)
            .bind(output_tokens)
            .bind(latency_ms)
            .execute(&state.pool)
            .await
            {
                tracing::error!("llm_calls insert failed: {e}");
            }

            Json(resp_json).into_response()
        }
    }
}
```

**关键说明**：
- **Anthropic 认证**：使用 `x-api-key: <KEY>` 和 `anthropic-version: 2023-06-01` 两个请求头，不使用 Bearer Token（Anthropic 不接受 Authorization Bearer）
- **Google 认证**：使用 `Authorization: Bearer <KEY>`（标准 OAuth2 格式）
- `reqwest::Client` 在 `AppState` 中初始化（`reqwest::Client::new()`），跨请求复用连接池
- `chrono` crate 若未引入，在 `Cargo.toml` 追加 `chrono = { version = "0.4", features = ["std"] }`

**验收（T1/T2a/T2b/T3）**：
- **T1**：`curl -X POST http://43.135.174.27:8081/llm/proxy -H 'Content-Type: application/json' -d '{"model":"claude-haiku-4-5-20251001","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'`，响应包含 `content` 字段；`llm_calls` 表有新记录，`model='claude-haiku-4-5-20251001'`，`provider='anthropic'`，`input_tokens` 为整数
- **T2a（网络错误路径）**：临时将 `ANTHROPIC_URL` 改为无效域名（如 `https://invalid.anthropic.test`），发送请求 → 调用方收到 502，`llm_calls` 无新记录
- **T2b（provider 5xx 透传路径）**：使用真实但会返回 4xx 的请求（如缺少必填字段），`/llm/proxy` 透传原 status code，`llm_calls` 无新记录
- **T3**：sub2api 正常（`curl http://43.135.174.27:8080/v1/models` 返回 200），Tauri 正常对话，`llm_calls` 表无新记录

---

### Node 5：Axum `router` 注册 `/llm/proxy`

在 `main.rs` 的 Router 构建处追加路由：

```rust
use axum::routing::post;

let app = Router::new()
    // 现有路由...
    .route("/llm/proxy", post(llm_proxy::llm_proxy))
    .with_state(state);
```

**验收**：`curl -X POST http://43.135.174.27:8081/llm/proxy` 返回 JSON 错误（而非 404 `Method Not Allowed`），确认路由已注册。

---

## 前端（Tauri React）

### Node 6：新增模型价格常量（`src/constants/modelPrices.ts`）

```typescript
export interface ModelPrice {
  inputPerMillion: number   // USD per 1M input tokens
  outputPerMillion: number  // USD per 1M output tokens
}

// key 格式与 MODEL_CONTEXT_LIMITS 完全一致（带日期后缀）
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'gemini-2.5-pro':           { inputPerMillion: 1.25,  outputPerMillion: 10.00 },
  'claude-opus-4-7':          { inputPerMillion: 15.00, outputPerMillion: 75.00 },
  'claude-sonnet-4-6':        { inputPerMillion: 3.00,  outputPerMillion: 15.00 },
  'claude-haiku-4-5-20251001':{ inputPerMillion: 0.80,  outputPerMillion: 4.00  },
}

export function calcCostUSD(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = MODEL_PRICES[model]
  if (!price) return null
  return (inputTokens / 1_000_000) * price.inputPerMillion
       + (outputTokens / 1_000_000) * price.outputPerMillion
}
```

**验收**：`calcCostUSD('claude-sonnet-4-6', 1_000_000, 1_000_000)` 返回 18；`calcCostUSD('unknown-model', 0, 0)` 返回 null。

---

### Node 7：数据聚合工具（`src/utils/tokenAggregation.ts`）

**E1 方案（默认，前端 JS 聚合）**：

```typescript
import { QAAtomMeta } from '../store/conversationSlice'
import { calcCostUSD } from '../constants/modelPrices'

export interface DayModelBucket {
  date: string    // YYYY-MM-DD
  model: string
  inputTokens: number
  outputTokens: number
  costUSD: number | null  // null 表示该模型不在价格表
}

export interface AggregatedStats {
  buckets: DayModelBucket[]
  totalInput: number
  totalOutput: number
  // 已知模型的成本总和（忽略未知模型的 null bucket）；所有有数据模型均为未知时为 null
  knownModelCostUSD: number | null
  unknownModelCount: number  // 不在价格表的模型数，>0 时 Banner 注明「其成本未计入」
  atomsWithData: number
  atomsTotal: number
  avgDailyTokens: number | null  // Σ有记录天的 token / 有记录天数；无数据时 null
  mostActiveModel: string | null
  mostExpensiveDay: string | null  // YYYY-MM-DD，仅基于已知模型成本
}

export function aggregateAtoms(atoms: QAAtomMeta[]): AggregatedStats {
  const atomsWithData = atoms.filter(a => a.usage)
  const atomsTotal = atoms.length

  // 按 date + model 分桶
  const bucketMap = new Map<string, DayModelBucket>()
  for (const atom of atomsWithData) {
    const date = atom.timestamp.slice(0, 10)  // ISO 8601 取前 10 字符 YYYY-MM-DD
    const model = atom.model ?? 'unknown'
    const key = `${date}|${model}`
    const existing = bucketMap.get(key) ?? {
      date, model, inputTokens: 0, outputTokens: 0, costUSD: 0,
    }
    existing.inputTokens += atom.usage!.input_tokens
    existing.outputTokens += atom.usage!.output_tokens
    const costDelta = calcCostUSD(model, atom.usage!.input_tokens, atom.usage!.output_tokens)
    // 只有桶内所有 atom 都能计算成本时，桶的 costUSD 才为非 null
    existing.costUSD = costDelta !== null && existing.costUSD !== null
      ? existing.costUSD + costDelta
      : null
    bucketMap.set(key, existing)
  }
  const buckets = Array.from(bucketMap.values())

  const totalInput = buckets.reduce((s, b) => s + b.inputTokens, 0)
  const totalOutput = buckets.reduce((s, b) => s + b.outputTokens, 0)

  // 仅累加已知模型（costUSD !== null）的成本，不因未知模型而置整体为 null
  const knownBuckets = buckets.filter(b => b.costUSD !== null)
  const knownModelCostUSD = knownBuckets.length > 0
    ? knownBuckets.reduce((s, b) => s + b.costUSD!, 0)
    : null
  const unknownModelCount = new Set(
    buckets.filter(b => b.costUSD === null).map(b => b.model)
  ).size

  // 日均（有记录天，分母为有记录天数）
  const tokensByDate = new Map<string, number>()
  for (const b of buckets) {
    tokensByDate.set(b.date, (tokensByDate.get(b.date) ?? 0) + b.inputTokens + b.outputTokens)
  }
  const avgDailyTokens = tokensByDate.size > 0
    ? Array.from(tokensByDate.values()).reduce((s, n) => s + n, 0) / tokensByDate.size
    : null

  // 最活跃模型
  const tokensByModel = new Map<string, number>()
  for (const b of buckets) {
    tokensByModel.set(b.model, (tokensByModel.get(b.model) ?? 0) + b.inputTokens + b.outputTokens)
  }
  const mostActiveModel = tokensByModel.size > 0
    ? [...tokensByModel.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null

  // 最贵单日（仅基于已知模型成本）
  const costByDate = new Map<string, number>()
  for (const b of knownBuckets) {
    costByDate.set(b.date, (costByDate.get(b.date) ?? 0) + b.costUSD!)
  }
  const mostExpensiveDay = costByDate.size > 0
    ? [...costByDate.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null

  return {
    buckets, totalInput, totalOutput,
    knownModelCostUSD, unknownModelCount,
    atomsWithData: atomsWithData.length, atomsTotal,
    avgDailyTokens, mostActiveModel, mostExpensiveDay,
  }
}
```

> **E2 替代方案**（若议题 E 选后端）：新增 Tauri 命令 `get_token_stats`，参数为 `{ project_path: string, date_from?: string, date_to?: string }`，返回与 `DayModelBucket[]` 结构相同的 JSON（Rust 端扫描 frontmatter 并聚合）。前端 `tokenAggregation.ts` 改为调用该命令，接口契约与 E1 输出格式一致，`DashboardView` 无需改动。

**验收**：

精确场景定义：
```
atom A: day1 | claude-sonnet | input=1000, output=200
atom B: day1 | claude-sonnet | input=800, output=100   ← 同天同模型，合并到一个桶
atom C: day2 | gemini-2.5-pro | input=2000, output=500
```
期望：`buckets.length === 2`（`day1|claude-sonnet` 和 `day2|gemini-2.5-pro`）；`atomsWithData === 3`；`knownModelCostUSD > 0`；`avgDailyTokens === (1900 + 2500) / 2 === 2200`。

含未知模型场景：
```
atom D: day1 | unknown-model | input=1000, output=200
atom E: day1 | claude-sonnet | input=1000, output=200
```
期望：`unknownModelCount === 1`；`knownModelCostUSD > 0`（仅含 claude-sonnet）；`knownModelCostUSD !== null`（不因未知模型变为 null）。

---

### Node 8：`DashboardView.tsx` — 汇总卡片与子组件

新建 `src/components/Dashboard/DashboardView.tsx`：

**子组件接口**（同文件或同目录下分文件）：

```typescript
// SummaryCard：简单数据卡片
interface SummaryCardProps {
  label: string
  value: string
}
function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <div className="summary-card">
      <div className="summary-card__label">{label}</div>
      <div className="summary-card__value">{value}</div>
    </div>
  )
}

// DashboardFilters：过滤器控件
interface DashboardFiltersProps {
  dateRange: '7d' | '30d' | 'all'
  onDateRangeChange: (v: '7d' | '30d' | 'all') => void
  allModels: string[]
  modelFilter: string[]           // 空数组 = 全选
  onModelFilterChange: (models: string[]) => void
}
function DashboardFilters({ dateRange, onDateRangeChange, allModels, modelFilter, onModelFilterChange }: DashboardFiltersProps) {
  return (
    <div className="dashboard__filters">
      {/* 日期范围单选 */}
      {(['7d', '30d', 'all'] as const).map(v => (
        <button key={v} className={dateRange === v ? 'active' : ''}
          onClick={() => onDateRangeChange(v)}>
          {v === '7d' ? '近 7 天' : v === '30d' ? '近 30 天' : '全部'}
        </button>
      ))}
      {/* 模型多选（allModels 中每个模型一个 checkbox） */}
      {allModels.map(m => (
        <label key={m}>
          <input type="checkbox"
            checked={modelFilter.length === 0 || !modelFilter.includes(m)}
            onChange={e => {
              if (e.target.checked) {
                // 选中：从排除列表移除（若 modelFilter 为空则为全选，无需操作）
                onModelFilterChange(modelFilter.filter(x => x !== m))
              } else {
                // 取消选中：将该模型加入排除列表
                onModelFilterChange([...modelFilter.filter(x => x !== m), m])
              }
              // 注：modelFilter 语义为「排除列表」，空数组 = 全选；checked = !modelFilter.includes(m)
            }}
          /> {m}
        </label>
      ))}
    </div>
  )
}
```

**主组件**（粒度状态由 DashboardView 持有，传入 TokenTimeChart）：

```typescript
import React, { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { aggregateAtoms } from '../../utils/tokenAggregation'
import { formatTokens } from '../../utils/tokenFormat'
import { TokenTimeChart } from './TokenTimeChart'

export function DashboardView() {
  const atoms = useStore(s => s.atoms)
  const [dateRange, setDateRange] = useState<'7d' | '30d' | 'all'>('30d')
  const [modelFilter, setModelFilter] = useState<string[]>([])
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day')

  const filteredAtoms = useMemo(() => {
    const cutoff = dateRange === '7d'
      ? Date.now() - 7 * 86400_000
      : dateRange === '30d'
        ? Date.now() - 30 * 86400_000
        : 0
    return atoms.filter(a => {
      if (cutoff > 0 && new Date(a.timestamp).getTime() < cutoff) return false
      // modelFilter 语义为「排除列表」：列表中的模型被排除，空列表=全选
      if (modelFilter.length > 0 && modelFilter.includes(a.model ?? '')) return false
      return true
    })
  }, [atoms, dateRange, modelFilter])

  const stats = useMemo(() => aggregateAtoms(filteredAtoms), [filteredAtoms])
  const noData = stats.atomsWithData === 0

  // 成本 Banner 文字随 dateRange 变化
  const rangeLabel = dateRange === '7d' ? '近 7 天' : dateRange === '30d' ? '近 30 天' : '全部'
  const costText = stats.knownModelCostUSD !== null
    ? `$${stats.knownModelCostUSD.toFixed(2)}${stats.unknownModelCount > 0 ? `（${stats.unknownModelCount} 个未知模型成本未计入）` : ''}`
    : '-'

  return (
    <div className="dashboard">
      <div className="dashboard__cost-banner">
        {rangeLabel}预估成本：{costText}（基于公开价格，仅供参考）
      </div>

      <div className="dashboard__cards">
        <SummaryCard label="总 Token 消耗"
          value={noData ? '-' : formatTokens(stats.totalInput + stats.totalOutput)} />
        <SummaryCard label="日均消耗"
          value={stats.avgDailyTokens !== null ? formatTokens(Math.round(stats.avgDailyTokens)) : '-'} />
        <SummaryCard label="最活跃模型"
          value={stats.mostActiveModel ?? '-'} />
        <SummaryCard label="最贵日期"
          value={stats.mostExpensiveDay ?? '-'} />
      </div>

      {stats.atomsTotal > stats.atomsWithData && (
        <div className="dashboard__partial-notice">
          {stats.atomsTotal - stats.atomsWithData} 个历史节点无 token 数据，未计入
        </div>
      )}

      {noData && (
        <div className="dashboard__empty">
          暂无 token 数据，发送新消息后将自动采集
        </div>
      )}

      {!noData && (
        <TokenTimeChart
          buckets={stats.buckets}
          granularity={granularity}
          onGranularityChange={setGranularity}
        />
      )}

      <DashboardFilters
        dateRange={dateRange} onDateRangeChange={setDateRange}
        allModels={[...new Set(stats.buckets.map(b => b.model))]}
        modelFilter={modelFilter} onModelFilterChange={setModelFilter}
      />
    </div>
  )
}
```

**验收**：加载含 3 个 atom 的 store，DashboardView 渲染 4 张卡片，「总 Token 消耗」非零；2 个 atom 无 token 数据时显示「2 个历史节点无 token 数据，未计入」；含 1 个 unknown-model atom 时，Banner 显示已知模型成本且注明「1 个未知模型成本未计入」。

---

### Node 9：`TokenTimeChart` — 时序图表

**默认实现：D2 方案（CSS+SVG 手写折线，不引入图表库）**

> 若议题 D 选 D1（Recharts），将下方 SVG 实现替换为 Recharts `<LineChart>`；Props 接口保持不变，DashboardView 无需修改。

新建 `src/components/Dashboard/TokenTimeChart.tsx`：

```typescript
interface TokenTimeChartProps {
  buckets: DayModelBucket[]
  granularity: 'day' | 'week' | 'month'
  onGranularityChange: (g: 'day' | 'week' | 'month') => void
}

export function TokenTimeChart({ buckets, granularity, onGranularityChange }: TokenTimeChartProps) {
  const grouped = groupByGranularity(buckets, granularity)
  const { topModels, points } = computeChartPoints(grouped)

  const W = 480, H = 200, PAD = { top: 10, right: 20, bottom: 30, left: 50 }
  const maxY = Math.max(...points.flatMap(p => p.values), 1)
  const xScale = (i: number) =>
    PAD.left + (i / Math.max(points.length - 1, 1)) * (W - PAD.left - PAD.right)
  const yScale = (v: number) =>
    PAD.top + (1 - v / maxY) * (H - PAD.top - PAD.bottom)

  return (
    <div className="chart-container">
      {/* 粒度切换（状态由 DashboardView 持有） */}
      <div className="chart-granularity">
        {(['day', 'week', 'month'] as const).map(g => (
          <button key={g} className={granularity === g ? 'active' : ''}
            onClick={() => onGranularityChange(g)}>
            {g === 'day' ? '天' : g === 'week' ? '周' : '月'}
          </button>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
        {topModels.map((model, mi) => {
          const pathData = points.map((p, i) =>
            p.values[mi] > 0
              ? `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)},${yScale(p.values[mi]).toFixed(1)}`
              : null
          ).filter(Boolean).join(' ')
          return pathData
            ? <path key={model} d={pathData} stroke={MODEL_COLORS[mi]}
                strokeWidth="1.5" fill="none" />
            : null
        })}
        {points.map((p, i) => (
          <text key={p.label} x={xScale(i)} y={H - 5}
            textAnchor="middle" fontSize="10">{p.label}</text>
        ))}
        <text x={PAD.left - 4} y={PAD.top + 4} textAnchor="end" fontSize="10">
          {formatTokens(maxY)}
        </text>
      </svg>

      <div className="chart-legend">
        {topModels.map((m, i) => (
          <span key={m} style={{ color: MODEL_COLORS[i] }}>■ {m}</span>
        ))}
      </div>
    </div>
  )
}

const MODEL_COLORS = ['#2563eb', '#16a34a', '#ea580c', '#6b7280']
```

**辅助函数说明**（需在同文件或 util 中实现）：

`groupByGranularity(buckets, granularity)` → `Map<label, DayModelBucket[]>`：
- `'day'`：label = `YYYY-MM-DD`（直接用 `bucket.date`）
- `'week'`：label = ISO 周号，例如 `2026-W20`（`date-fns/getISOWeek` 或手算）
- `'month'`：label = `YYYY-MM`（`bucket.date.slice(0, 7)`）

`computeChartPoints(grouped)` → `{ topModels: string[], points: { label: string, values: number[] }[] }`：
- 按历史 token 总量降序取前 3 个模型，其余合并为 `"其他"`
- `points[i].values[j]` = 第 i 个时间点，第 j 个 topModel 的 token 总量

**D1 替代实现提示**（若议题 D 选 Recharts）：
```
npm install recharts
// TokenTimeChart.tsx 改为使用 <LineChart data={points}> + <Line> per topModel
// Props 接口（buckets, granularity, onGranularityChange）保持不变
```

**验收**：
- D2 方案：含 2 个模型的数据，SVG 渲染 2 条折线（不同颜色），X 轴显示日期标签；点击「周」按钮，`onGranularityChange('week')` 被调用，DashboardView 更新 granularity，图表重新按周聚合
- D1 方案（若选）：Recharts LineChart 渲染同样数据，TypeScript 无报错

---

### Node 10：`layoutSlice.ts` 扩展 + `NavIcons.tsx` 新增图标

**`layoutSlice.ts`**（追加，不改现有 mode 类型定义）：

```typescript
currentMode: 'conversation' | 'tools' | 'console' | 'decisions' | 'analytics' | 'dashboard'
```

**`NavIcons.tsx`** 新增仪表盘图标：

```tsx
<button
  className={`nav-icon ${currentMode === 'dashboard' ? 'nav-icon--active' : ''}`}
  onClick={() => setCurrentMode('dashboard')}
  title="Token 仪表盘"
  aria-label="Token 仪表盘"
>
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="9" width="3" height="6" fill="currentColor" rx="0.5"/>
    <rect x="6" y="5" width="3" height="10" fill="currentColor" rx="0.5"/>
    <rect x="11" y="2" width="3" height="13" fill="currentColor" rx="0.5"/>
  </svg>
</button>
```

---

### Node 11：`App.tsx` / `Layout.tsx` 绑定 dashboard 模式

```tsx
{currentMode === 'dashboard'
  ? (
    <>
      <div className="p2-empty" />   {/* P2 折叠或空白 */}
      <DashboardView />               {/* P3 渲染仪表盘 */}
    </>
  )
  : (
    // 现有 conversation / tools / console / analytics 分支...
  )
}
```

> dashboard 模式下 P4 保持 DefaultDetailPanel（仪表盘不需要 P4 详情）。

**验收（T4）**：点击仪表盘图标，P3 切换为 DashboardView；点击对话图标，恢复对话模式，P2 分支树和 P3 对话正常；刷新后 currentMode 恢复默认，不残留 dashboard 状态。

---

## 测试计划

| 测试项 | 步骤 | 预期 |
|-------|------|------|
| T1: /llm/proxy 正常转发 | curl POST /llm/proxy，Anthropic 非流式请求（Content-Type: application/json） | 响应含 content 字段；llm_calls 有新记录，provider='anthropic' |
| T2a: 网络错误路径 | 将 ANTHROPIC_URL 改为无效域名 | 调用方收到 502；llm_calls 无新记录 |
| T2b: provider 错误透传 | 发送缺少必填字段的 Anthropic 请求 → 真实 400 | 调用方收到 400；llm_calls 无新记录 |
| T3: Tauri 对话隔离 | 正常对话一条消息 | stream_ai 不经过 /llm/proxy；llm_calls 表无变化 |
| T4: 仪表盘路由切换 | 点击仪表盘图标 → 点对话图标 | P3 切换为 DashboardView 再恢复对话；刷新后不残留 |
| T5: 汇总卡片计算 | 精确场景（见 Node 7 验收）3 个 atom | buckets.length===2；avgDailyTokens===2200 |
| T6: 成本估算 | claude-sonnet-4-6，1M input + 1M output | knownModelCostUSD = 18.00 |
| T7: 未知模型成本不阻断 | 含 unknown-model 的 atom + claude-sonnet atom | knownModelCostUSD > 0；unknownModelCount=1；Banner 注明未计入 |
| T8: 旧数据提示 | 3 atom 中 1 个无 token 字段 | 显示「1 个历史节点无 token 数据，未计入」 |
| T9: 日期过滤 | 切换为「7 天」，8 天前 atom 有 token | 8 天前 atom 不计入统计；卡片数值减少 |
| T10: 模型过滤 | 过滤只看 gemini-2.5-pro | 图表只显示 gemini 线；其他模型 token 不计入卡片 |
| T11: llm_calls migration | 服务重启后 .tables 输出 | 包含 llm_calls；再次重启不报错 |

---

## 实现节点 Checklist

### 阶段一：Axum 后端（Node 1-5）

- [ ] Node 1：`Cargo.toml` 追加 `uuid 1.x`、`reqwest 0.12`（含 json feature）；`cargo check` 无新错误
- [ ] Node 2：migration 函数中追加 `llm_calls` 建表 SQL（`IF NOT EXISTS`，`execute(pool)` 参数正确）
- [ ] Node 3：`workbench.env` 追加 `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`（待用户填写）
- [ ] Node 4：新建 `src/routes/llm_proxy.rs`，Anthropic 使用 `x-api-key` + `anthropic-version` 头，Google 使用 Bearer；usage 提取覆盖两个 provider 路径；错误处理三条规则正确
- [ ] Node 5：`main.rs` Router 注册 `/llm/proxy POST`
- [ ] T1/T2a/T2b/T3/T11 手工验收通过
- [ ] `cargo build --release` 并重启 systemd 服务

### 阶段二：前端基础（Node 6-7）

- [ ] Node 6：新建 `src/constants/modelPrices.ts`（MODEL_PRICES + calcCostUSD）；TypeScript 无报错
- [ ] Node 7：新建 `src/utils/tokenAggregation.ts`（aggregateAtoms，含分桶、日均、knownModelCostUSD/unknownModelCount、最活跃模型、最贵日期）；T5/T6/T7/T8 逻辑验证

### 阶段三：仪表盘视图（Node 8-11）

- [ ] Node 8：新建 `DashboardView.tsx`（含 SummaryCard、DashboardFilters 子组件定义；granularity 状态由 DashboardView 持有并传入 TokenTimeChart）
- [ ] Node 9：新建 `TokenTimeChart.tsx`（Props 含 onGranularityChange；D2 默认 SVG 实现）
- [ ] Node 10：`layoutSlice.ts` 追加 `'dashboard'` mode；`NavIcons.tsx` 新增仪表盘图标
- [ ] Node 11：`App.tsx` / `Layout.tsx` 绑定 dashboard 模式
- [ ] T4/T5/T9/T10 手工验收通过

---

## 依赖说明

- **新 Rust 依赖**：`uuid` 1.x、`reqwest` 0.12（仅 Axum 后端）；`chrono` 若未有则追加
- **新前端依赖（D1 方案）**：`recharts` 2.x；D2/D3 方案无新依赖
- **Axum 后端已有**：`sqlx`、`axum`、`tokio`、`serde_json`、`tracing`

---

## 修订记录

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1 | 2026-05-18 | workbench-technical | 初稿 |
| v2 | 2026-05-18 | workbench-technical | review-agent 第 1 轮修复：B-01 Anthropic 认证改为 x-api-key+version 头（非 Bearer）、B-02 T2 拆分为 T2a（网络错误→502）和 T2b（provider 5xx 透传）、B-03 Node 7 验收场景精确化为 day1/claude-sonnet×2+day2/gemini，明确 buckets.length=2 的前提、B-04 reqwest 升级至 0.12（含默认 TLS）、B-05 granularity 状态上移至 DashboardView + onGranularityChange prop、W-01 SummaryCard/DashboardFilters Props 接口和骨架实现、W-02 Banner 文字随 dateRange 动态变化（近7天/近30天/全部）、W-03 totalCostUSD 改为 knownModelCostUSD（仅累加已知模型）+unknownModelCount（不因未知模型置 null）、W-04 llm_proxy.rs 顶部 use 声明、W-05 Node 2 migration 函数签名明确 |
| v3 | 2026-05-18 | workbench-technical | review-agent 第 2 轮修复：W-06 DashboardFilters checkbox 逻辑修正（取消选中分支修复为正确的排除列表追加逻辑）、W-07 use uuid 改为 use uuid::Uuid 与代码内 Uuid::new_v4() 统一 |
| v4 | 2026-05-18 | workbench-technical | review-agent 第 3 轮修复：R-01 filteredAtoms 模型过滤逻辑修正（`!includes` 改为 `includes`，与 modelFilter 排除列表语义一致；原逻辑为白名单导致过滤结果完全反向） |
| v5 | 2026-05-18 | workbench-technical | review-agent 第 4 轮修复：W-08 DashboardFilters checkbox checked 属性修正（`includes(m)` 改为 `!includes(m)`，排除列表中的模型应显示为未选中；原逻辑 UI 与过滤状态相反） |
