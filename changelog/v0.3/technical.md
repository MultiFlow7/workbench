---
project: 工作台
version: v0.3
status: draft
doc_revision: 1
created: 2026-05-18
updated: 2026-05-18
author: workbench-technical
---

# technical.md · 工作台 v0.3

---

## 架构概览

v0.3 是纯增量变更，不修改 v0.2 的任何 API 或后端服务。所有改动在 Tauri 桌面层（Rust 命令 + React 前端）。

变更范围：
- **Rust 侧**：`models.rs`、`commands/qa_atoms.rs`、`commands/ai_stream.rs`（3 个文件）
- **前端侧**：`store/conversationSlice.ts`（扩展）、`components/ChatView/ChatView.tsx`（扩展）、新增 3 个文件
- **无后端服务变更**：v0.2 的 Axum 后端、SQLite、Agent 调度均不涉及

---

## 数据模型变更

### Node 1：Rust 扩展 `QAAtomMeta` 和 `QAAtom`（`models.rs`）

在现有结构体中新增可选 token 字段：

```rust
// 新增：token 使用量（可选，旧 atom 无此字段）
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

// QAAtomMeta 新增字段（已有字段不变）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QAAtomMeta {
    pub id: String,
    pub prev: Option<String>,
    pub children: Vec<String>,
    pub summary: String,
    pub timestamp: String,
    // v0.3 新增（可选，旧 atom 无此字段时为 None）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_tokens_used: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window_limit: Option<u32>,
}
```

**验收**：`cargo check` 无新错误。

---

### Node 2：Rust 扩展 `write_qa_atom` 写入 token 字段（`commands/qa_atoms.rs`）

**2a. 扩展 `RawFrontmatter`（读取侧）**：

```rust
#[derive(serde::Deserialize, Default)]
struct RawFrontmatter {
    id: String,
    #[serde(default)] prev: Option<String>,
    #[serde(default)] children: Vec<String>,
    #[serde(default)] timestamp: String,
    #[serde(default)] summary: Option<String>,
    // v0.3 新增（旧文件无此字段时 serde 自动填 None）
    #[serde(default)] model: Option<String>,
    #[serde(default)] input_tokens: Option<u32>,
    #[serde(default)] output_tokens: Option<u32>,
    #[serde(default)] context_tokens_used: Option<u32>,
    #[serde(default)] context_window_limit: Option<u32>,
}
```

**2b. 更新 `list_qa_atoms` 和 `read_qa_atom` 的字段映射**：

`RawFrontmatter` 是扁平结构（`input_tokens`/`output_tokens`），`QAAtomMeta.usage` 是嵌套结构，需显式构造：

```rust
// 在 atoms.push(QAAtomMeta { ... }) 和 Ok(QAAtom { meta: QAAtomMeta { ... } }) 处添加：
let usage = match (raw.input_tokens, raw.output_tokens) {
    (Some(i), Some(o)) => Some(TokenUsage { input_tokens: i, output_tokens: o }),
    _ => None,
};

QAAtomMeta {
    id: file_id,
    prev: raw.prev.filter(|s| !s.is_empty()),
    children: raw.children,
    summary,
    timestamp: raw.timestamp,
    // v0.3 新增
    model: raw.model,
    usage,
    context_tokens_used: raw.context_tokens_used,
    context_window_limit: raw.context_window_limit,
}
```

**2c. 更新 `write_qa_atom` 的 frontmatter 序列化**：

token 字段插入位置固定在 `timestamp` 之后、`status: done` 之前，维持字段顺序一致性：

```rust
// prev_yaml：None 时写空字符串（YAML 中省略该行），Some(id) 时写 "prev: id\n"
let prev_yaml = atom.meta.prev.as_deref()
    .map(|s| format!("prev: {}\n", s))
    .unwrap_or_default();

// children_str：空列表写 "children: []\n"，非空写 "children: [id1, id2]\n"（单行数组）
let children_str = if atom.meta.children.is_empty() {
    "children: []\n".to_string()
} else {
    format!("children: [{}]\n", atom.meta.children.join(", "))
};

let token_yaml = if let Some(usage) = &atom.meta.usage {
    // usage 存在时写入全部 5 个 token 字段
    format!(
        "model: \"{}\"\ninput_tokens: {}\noutput_tokens: {}\ncontext_tokens_used: {}\ncontext_window_limit: {}\n",
        atom.meta.model.as_deref().unwrap_or(""),
        usage.input_tokens,
        usage.output_tokens,
        atom.meta.context_tokens_used.unwrap_or(0),
        atom.meta.context_window_limit.unwrap_or(0),
    )
} else {
    String::new()  // usage 缺失时不写 token 字段（不写 0）
};

// frontmatter 字段顺序：id → prev → children → timestamp → [token 字段] → status
let content = format!(
    "---\nid: {}\n{}{}timestamp: \"{}\"\n{}status: done\n---\n\n## Q\n\n{}\n\n## A\n\n{}\n",
    atom.meta.id, prev_yaml, children_str, atom.meta.timestamp,
    token_yaml,   // 空字符串时不影响格式
    atom.question, atom.answer,
);
```

**验收**：
- 写入含 usage 的 atom，.md frontmatter 依次包含 id/prev/children/timestamp/model/input_tokens/output_tokens/context_tokens_used/context_window_limit/status
- 写入无 usage 的 atom，frontmatter 不含 token 字段，`status: done` 紧跟 timestamp
- 读取旧 atom（无 token 字段），`usage: None`，程序无报错

---

### Node 3：Rust 扩展 `stream_ai` 解析 usage 并修复 ai-done 双触发（`commands/ai_stream.rs`）

**Claude API SSE 事件格式（相关事件）**：

```
data: {"type":"message_start","message":{"usage":{"input_tokens":1024,"output_tokens":1}}}
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":256}}
data: {"type":"message_stop"}
```

**新增两个辅助函数（JSON path 明确）**：

```rust
// 从 message_start 事件解析 input_tokens
// JSON path: val["message"]["usage"]["input_tokens"]
fn parse_usage_input(line: &str) -> Option<u32> {
    let data = line.strip_prefix("data: ")?;
    let val: serde_json::Value = serde_json::from_str(data).ok()?;
    if val["type"].as_str()? == "message_start" {
        val["message"]["usage"]["input_tokens"].as_u64().map(|n| n as u32)
    } else {
        None
    }
}

// 从 message_delta 事件解析 output_tokens
// JSON path: val["usage"]["output_tokens"]（顶层 usage，不在 delta 内）
fn parse_usage_output(line: &str) -> Option<u32> {
    let data = line.strip_prefix("data: ")?;
    let val: serde_json::Value = serde_json::from_str(data).ok()?;
    if val["type"].as_str()? == "message_delta" {
        val["usage"]["output_tokens"].as_u64().map(|n| n as u32)
    } else {
        None
    }
}
```

**修复 ai-done 双触发 + 增加 usage 采集**：

```rust
let mut full_content = String::new();
let mut usage_input: Option<u32> = None;
let mut usage_output: Option<u32> = None;
let mut done_emitted = false;  // 防止双触发
let mut stream = response.bytes_stream();

// 提取 usage payload 并 emit ai-done 的内联闭包（避免重复代码）
macro_rules! emit_done {
    ($app:expr, $atom_id:expr, $full_content:expr) => {{
        if !done_emitted {
            done_emitted = true;
            let usage_payload = match (usage_input, usage_output) {
                (Some(inp), Some(out)) => serde_json::json!({ "input_tokens": inp, "output_tokens": out }),
                _ => serde_json::Value::Null,
            };
            let _ = $app.emit("ai-done", serde_json::json!({
                "atom_id": $atom_id,
                "full_content": $full_content,
                "usage": usage_payload,
            }));
        }
    }};
}

loop {
    tokio::select! {
        _ = cancel.cancelled() => {
            let _ = app.emit("ai-cancelled", serde_json::json!({ "atom_id": atom_id }));
            return Ok(());
        }
        chunk = stream.next() => {
            match chunk {
                None => {
                    emit_done!(app, atom_id, full_content);
                    return Ok(());
                }
                Some(Err(e)) => {
                    let _ = app.emit("ai-error", serde_json::json!({ "error": e.to_string() }));
                    return Err(e.to_string());
                }
                Some(Ok(bytes)) => {
                    let text = String::from_utf8_lossy(&bytes);
                    for line in text.lines() {
                        // 解析 usage（累积，message_start 和 message_delta 各一次）
                        if let Some(inp) = parse_usage_input(line) { usage_input = Some(inp); }
                        if let Some(out) = parse_usage_output(line) { usage_output = Some(out); }
                        // 解析文本 delta
                        if let Some(delta) = parse_delta(line) {
                            full_content.push_str(&delta);
                            let _ = app.emit("ai-token", serde_json::json!({ "text": delta }));
                        }
                        // message_stop → emit ai-done
                        if is_message_stop(line) {
                            emit_done!(app, atom_id, full_content);
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
}
```

**关键修复说明**：
- `done_emitted` flag：确保 `None` 分支和 `message_stop` 分支不会重复 emit `ai-done`
- usage 解析时序：`message_start` 先于 `message_delta`，两者不在同一 chunk 时分别累积，最终合并在 emit 时使用
- `usage` 字段为 Null 时前端收到 null，与 usage 缺失等价处理（不写 token 字段）

**验收**：在 `ChatView` console.log `ai-done` 事件，确认整个对话只触发一次；`usage.input_tokens` 和 `usage.output_tokens` 有非零值。

---

## 前端常量与类型

### Node 4：新增模型常量文件（新文件 `src/constants/modelLimits.ts`）

```typescript
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-7': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'gemini-2.5-pro': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
}

export function getContextLimit(model: string): number | undefined {
  return MODEL_CONTEXT_LIMITS[model]
}
```

**验收**：TypeScript 无报错，`getContextLimit('claude-sonnet-4-6')` 返回 200000，`getContextLimit('unknown')` 返回 undefined。

---

### Node 5：扩展前端 store 的 `QAAtomMeta`（`store/conversationSlice.ts`）

**5a. 扩展接口**：

```typescript
export interface TokenUsage {
  input_tokens: number
  output_tokens: number
}

// QAAtomMeta 新增可选 token 字段
export interface QAAtomMeta {
  id: string
  prev: string | null
  children: string[]
  summary: string
  timestamp: string
  // v0.3 新增
  model?: string
  usage?: TokenUsage
  context_tokens_used?: number
  context_window_limit?: number
}
```

**5b. ContextIndicator 的 token 计算函数**：

> **技术说明**：`context_tokens_used` 字段（写入 .md 文件）存储的是「发送本 atom 时，前一个 atom 的 input_tokens + output_tokens 近似值」，仅作存档用途，不被 ContextIndicator 读回。ContextIndicator 实时从 store 计算（`selectContextTokensUsed`），取 currentPath 最后一个有 usage 的 atom 的 `input_tokens + output_tokens`，比累加所有 atom 更准确（逐 atom 累加会重复计数，因为每个 atom 的 input_tokens 已包含前面所有历史上下文）。

```typescript
// 从 currentPath 计算当前上下文近似使用量
export const selectContextTokensUsed = (pathAtoms: QAAtomMeta[]): number => {
  // 找路径中最后一个有 usage 数据的 atom
  const lastWithData = [...pathAtoms].reverse().find(a => a.usage)
  if (!lastWithData?.usage) return 0
  // 使用该 atom 的 input+output 作为当前上下文近似（最近一次 API 计量值）
  return lastWithData.usage.input_tokens + lastWithData.usage.output_tokens
}
```

**5c. 新增 store action `updateAtomTokens`**：

```typescript
updateAtomTokens: (atomId: string, tokenData?: Pick<QAAtomMeta, 'model' | 'usage' | 'context_tokens_used' | 'context_window_limit'>) => {
  set((state) => ({
    atoms: state.atoms.map(a =>
      a.id === atomId ? { ...a, ...(tokenData ?? {}) } : a
    )
  }))
}
// tokenData 为 undefined 时（usage 缺失），merge 空对象，atom 的 token 字段保持 undefined
```

**验收**：TypeScript 无报错；`selectContextTokensUsed` 对含 usage 的路径返回最后一个 atom 的 input+output 之和；对空路径或无 usage 路径返回 0。

---

## ChatView 扩展

### Node 6：`ChatView.tsx` — 计算 context_tokens_used，接收 usage 写入 atom

**6a. 发送前准备**：

```typescript
// handleSend 中 invoke('stream_ai', ...) 之前
const pathAtoms = useStore.getState().currentPath
const contextTokensUsed = selectContextTokensUsed(pathAtoms)
const contextWindowLimit = getContextLimit(selectedModel)
```

**6b. `ai-done` 监听器扩展**：

```typescript
listen<{
  atom_id: string
  full_content: string
  usage?: { input_tokens: number; output_tokens: number } | null
}>('ai-done', async (e) => {
  const { atom_id, full_content, usage } = e.payload

  // 构建 token 元数据（usage 为 null 或 undefined 时不附加 token 字段）
  const tokenMeta = usage ? {
    model: selectedModel,
    usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens },
    context_tokens_used: contextTokensUsed,
    context_window_limit: contextWindowLimit,
  } : undefined

  await invoke('write_qa_atom', {
    filePath: atomFilePath,
    atom: {
      meta: { ...atomMeta, ...(tokenMeta ?? {}) },
      question: currentQuestion,
      answer: full_content,
    }
  })

  // 更新 store 缓存（usage 缺失时传 undefined，updateAtomTokens 保留字段为 undefined）
  useStore.getState().updateAtomTokens(atom_id, tokenMeta)
})
```

**验收**：发送一条消息后，对应 atom 文件含 token 字段；store 中该 atom.usage 非 undefined；第二条消息的 contextTokensUsed 等于第一条 atom 的 input+output 之和（selectContextTokensUsed 的返回值）。

---

## Context Indicator 组件

### Node 7：新增 `ContextIndicator` 组件（`src/components/ContextIndicator/ContextIndicator.tsx`）

**默认放置位置：A1（输入框上方嵌入行）**。用户决定议题 A 后，若选 A2/A3，只需将 `<ContextIndicator>` 标签移到对应位置，组件逻辑不变。

**Props**：

```typescript
interface ContextIndicatorProps {
  tokensUsed: number
  model: string
}
```

**渲染逻辑**：

```typescript
const limit = getContextLimit(model)

if (limit === undefined) {
  return <div className="ctx-indicator">{tokensUsed.toLocaleString()} tokens（上限未知）</div>
}

const pct = limit > 0 ? tokensUsed / limit * 100 : 0
const colorClass = pct < 70 ? 'ctx-indicator--green' : pct < 90 ? 'ctx-indicator--orange' : 'ctx-indicator--red'
```

**渲染结构**（纯 CSS，无图表依赖）：

```tsx
<div className={`ctx-indicator ${colorClass}`}>
  <div className="ctx-indicator__bar">
    <div className="ctx-indicator__fill" style={{ width: `${Math.min(pct, 100)}%` }} />
  </div>
  <span>{tokensUsed.toLocaleString()} / {limit.toLocaleString()} · {pct.toFixed(1)}%</span>
  <span className="ctx-indicator__model">{model}</span>
  {pct >= 90 && <span className="ctx-indicator__warning">上下文接近上限，建议在此节点开新分支</span>}
</div>
```

**在 ChatView 中的数据绑定**：

```typescript
// ChatView state
const [ctxTokensUsed, setCtxTokensUsed] = useState(0)

// 监听 currentPath 变化，重算
useEffect(() => {
  setCtxTokensUsed(selectContextTokensUsed(currentPath))
}, [currentPath, selectedModel])

// 渲染（A1 位置：input-area 内，textarea 上方）
<div className="chat-input-area">
  <ContextIndicator tokensUsed={ctxTokensUsed} model={selectedModel} />
  <textarea ... />
  <button>发送</button>
</div>
```

**验收（T3/T4/T5）**：
- 切换到含 5 个 atom 路径（最后一个 atom input=3000/output=800），指示器显示 3,800（不是 5 个 atom 的累加）
- 切换模型为 gemini-2.5-pro，百分比更新（分母变为 1,048,576）
- 选择常量表外的模型，显示「X tokens（上限未知）」

---

## Token Analytics Panel

### Node 8：新增 `TokenAnalyticsPanel` 组件（`src/components/TokenAnalytics/TokenAnalyticsPanel.tsx`）

**计算逻辑（O(n) 遍历，纯内存）**：

```typescript
function computeAnalytics(atoms: QAAtomMeta[], pathAtoms?: QAAtomMeta[]) {
  const target = pathAtoms ?? atoms  // 路径维度 or 全树
  const withData = target.filter(a => a.usage)

  const totalInput = withData.reduce((s, a) => s + a.usage!.input_tokens, 0)
  const totalOutput = withData.reduce((s, a) => s + a.usage!.output_tokens, 0)

  const byModel: Record<string, number> = {}
  withData.forEach(a => {
    const key = a.model ?? 'unknown'
    byModel[key] = (byModel[key] ?? 0) + a.usage!.input_tokens + a.usage!.output_tokens
  })

  const top5 = [...withData]
    .sort((a, b) =>
      (b.usage!.input_tokens + b.usage!.output_tokens) -
      (a.usage!.input_tokens + a.usage!.output_tokens)
    )
    .slice(0, 5)

  return {
    totalInput, totalOutput,
    total: totalInput + totalOutput,
    byModel,
    top5,
    withDataCount: withData.length,
    atomCount: target.length
  }
}
```

**渲染**（CSS 纯实现条形图）：

```tsx
const grandTotal = Object.values(byModel).reduce((s, n) => s + n, 0)

// 模型分布条
Object.entries(byModel).map(([model, tokens]) => (
  <div key={model}>
    <span>{model}</span>
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${grandTotal > 0 ? tokens/grandTotal*100 : 0}%` }} />
    </div>
    <span>{formatTokens(tokens)}</span>
  </div>
))
```

**空数据状态**：`withDataCount === 0` 时显示「当前画布暂无 token 数据，发送新消息后将自动采集」。

**路径维度 vs. 全树**：`pathAtoms` prop 非空时显示路径维度统计，否则显示全树。标题区分「全画布 Token 分析」/「路径 Token 分析（根→当前节点）」。

**验收（T6/T7/T8）**：
- 2 个含 usage 的 atom + 1 个旧 atom → 「2/3 个节点有 token 数据」
- 条形图总宽度比例正确（各模型占比之和 = 100%）
- Top 5 按 input+output 总量降序，不含无 usage 的旧 atom

---

## NavIcons + 路由扩展

### Node 9：`NavIcons.tsx` 新增 analytics 图标；`layoutSlice.ts` 扩展 mode

**`layoutSlice.ts`**（追加，不改现有类型）：

```typescript
currentMode: 'conversation' | 'tools' | 'console' | 'decisions' | 'analytics'
```

**`NavIcons.tsx`** 新增图标（SVG 使用简单折线图形状）：

```tsx
<button
  className={`nav-icon ${currentMode === 'analytics' ? 'nav-icon--active' : ''}`}
  onClick={() => setCurrentMode('analytics')}
  title="Token 分析"
  aria-label="Token 分析"
>
  {/* 折线图 SVG */}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <polyline points="2,12 6,8 9,10 14,4" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <circle cx="2" cy="12" r="1.5" fill="currentColor"/>
    <circle cx="14" cy="4" r="1.5" fill="currentColor"/>
  </svg>
</button>
```

### Node 10：`App.tsx` / `Layout.tsx` 绑定 analytics 模式到 P4

```tsx
// P4 渲染逻辑（在现有 DecisionPanel 条件外追加）
{currentMode === 'analytics'
  ? <TokenAnalyticsPanel atoms={allAtoms} pathAtoms={selectedPathAtoms} />
  : currentMode === 'decisions'
    ? <DecisionPanel />
    : <DefaultDetailPanel />
}
```

P1 决策角标（`pendingDecisionCount > 0` 时的红点）独立于 `currentMode`，始终渲染在 NavIcons 中，不受 analytics 模式影响。

**验收（T10）**：
- 点击 Token 分析图标，P4 切换到分析面板，P3 对话仍可使用
- 点击决策图标，P4 切换回 DecisionPanel，角标保留
- 刷新页面（或重启 app），currentMode 恢复默认，不残留 analytics 状态

---

## P2 节点 Token 标注

### Node 11：P2 树节点 token 标注（默认 B1 方案，用户可覆盖）

**默认选定：B1（始终显示小徽章）**。用户决定议题 B 后，若选 B2/B3，修改 P2 树组件中的条件渲染逻辑。

**先完成公共 util**（三种方案均需要）：

```typescript
// src/utils/tokenFormat.ts

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

// 是否超过路径平均值 1.5×（路径维度，不含无 usage 的 atom）
export function isHighConsumption(atom: QAAtomMeta, pathAtoms: QAAtomMeta[]): boolean {
  if (!atom.usage) return false
  const withData = pathAtoms.filter(a => a.usage)
  if (withData.length === 0) return false
  const avg = withData.reduce((s, a) => s + a.usage!.input_tokens + a.usage!.output_tokens, 0) / withData.length
  const total = atom.usage.input_tokens + atom.usage.output_tokens
  return total > avg * 1.5
}
```

**B1 方案（始终显示，JSX 片段）**：

```tsx
// 在 P2 树节点 JSX 的 id 旁边追加
{atom.usage && (
  <span className={`token-badge ${isHighConsumption(atom, pathAtoms) ? 'token-badge--warn' : ''}`}>
    {formatTokens(atom.usage.input_tokens + atom.usage.output_tokens)}
    {isHighConsumption(atom, pathAtoms) && ' ⚠'}
  </span>
)}
{!atom.usage && <span className="token-badge token-badge--empty">-</span>}
```

**⚠ 高消耗徽章固定行为**（无论 B 选哪种方案）：`isHighConsumption` 为 true 时 ⚠ 始终可见，不受折叠/开关影响。

**验收（T9）**：路径平均 1000 tokens，一个 atom 有 2100 tokens（> 1.5×），该 atom 显示 ⚠；无 usage 的 atom 显示「-」。

---

## 测试计划

| 测试项 | 步骤 | 预期 |
|-------|------|------|
| T1: atom 写入 token | 发送一条消息，查看 .md frontmatter | 含 model/input_tokens/output_tokens/context_tokens_used/context_window_limit；首条消息 context_tokens_used=0，第二条 >0 |
| T2: atom 无 usage 兼容 | 模拟 usage Null（或旧文件），读取 | .md 不含 token 字段，文件正常；store atom.usage 为 undefined |
| T3: 指示器数字 | 路径最后一个 atom input=3000/output=800 | 指示器显示 3,800 / [上限] |
| T4: 指示器颜色 | 3,800/200,000 ≈ 1.9%（绿色） | 进度条为绿色；在 React DevTools 中将该 atom 的 usage.input_tokens 临时改为 180000（保持 output_tokens=800，model=claude-sonnet-4-6），切换路径到该节点触发 selectContextTokensUsed 重算，指示器变红且出现警告文字 |
| T5: 指示器未知模型 | 选择不在常量表的模型 | 显示「X tokens（上限未知）」，无百分比 |
| T6: 分析面板数字 | 2 atom 有 usage，1 atom 无 | 面板显示「2/3 个节点有 token 数据」 |
| T7: 模型分布 | 2 atom 用 claude-sonnet，1 atom 用 gemini | 条形图两个模型及各自比例 |
| T8: Top 5 排序 | 5 个 atom token 数不同 | Top 5 按 input+output 总量降序 |
| T9: ⚠ 高消耗标记 | 路径平均 1000 tokens，一个 atom 有 2100 | 该 atom 显示 ⚠ |
| T10: P4 切换 | analytics → decisions | P4 正确切换，决策角标保留 |
| T11: ai-done 单次触发 | 完整对话，console.log ai-done | 只打印一次，无重复 |

---

## 实现节点 Checklist

### 阶段一：数据层（Node 1-3，Rust）

- [ ] Node 1：`models.rs` 新增 `TokenUsage`，扩展 `QAAtomMeta`
- [ ] Node 2a：`qa_atoms.rs` 扩展 `RawFrontmatter` 读取 token 字段
- [ ] Node 2b：`qa_atoms.rs` 更新 `list_qa_atoms` / `read_qa_atom`，含显式 `usage` 构造逻辑
- [ ] Node 2c：`qa_atoms.rs` 更新 `write_qa_atom`，token 字段位置固定（timestamp 之后）
- [ ] Node 3：`ai_stream.rs` 新增 `parse_usage_input` / `parse_usage_output`（含 JSON path），添加 `done_emitted` flag，两个 ai-done 触发点均通过 flag 去重
- [ ] `cargo check` 无新错误

### 阶段二：前端基础（Node 4-6）

- [ ] Node 4：新建 `src/constants/modelLimits.ts`
- [ ] Node 5a：`conversationSlice.ts` 扩展 `QAAtomMeta` + `TokenUsage`
- [ ] Node 5b：`conversationSlice.ts` 新增 `selectContextTokensUsed`（取最后一个有 usage 的 atom）
- [ ] Node 5c：`conversationSlice.ts` 新增 `updateAtomTokens` action
- [ ] Node 6a：`ChatView.tsx` 发送前计算 contextTokensUsed
- [ ] Node 6b：`ChatView.tsx` 更新 `ai-done` 监听器，接收 usage，构建 tokenMeta
- [ ] Node 6c：`ChatView.tsx` 写 atom 时附加 tokenMeta，调用 updateAtomTokens
- [ ] `tsc --noEmit` 无新错误

### 阶段三：Context Indicator（Node 7）

- [ ] Node 7：新建 `ContextIndicator.tsx` + `ContextIndicator.css`
- [ ] 插入到 A1 位置（ChatView 输入区上方）
- [ ] T3/T4/T5/T11 手工验证通过

### 阶段四：Token Analytics（Node 8-10）

- [ ] Node 8：新建 `TokenAnalyticsPanel.tsx` + `TokenAnalyticsPanel.css`
- [ ] Node 9：`NavIcons.tsx` 新增折线图 SVG 图标；`layoutSlice.ts` 扩展 mode 类型
- [ ] Node 10：`App.tsx` / `Layout.tsx` 绑定 analytics 模式到 P4
- [ ] T6/T7/T8/T10 手工验证通过

### 阶段五：P2 Token 标注（Node 11）

- [ ] Node 11a：新建 `src/utils/tokenFormat.ts`（formatTokens + isHighConsumption）
- [ ] Node 11b：P2 树组件实现 B1 方案（始终显示徽章）
- [ ] T9 手工验证通过

---

## 依赖说明

- **无新外部依赖**：所有 UI 用 CSS 纯实现，不引入图表库
- **serde_yaml**：`commands/qa_atoms.rs` 已引入
- **reqwest + bytes_stream**：`ai_stream.rs` 已有

---

## 修订记录

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1 | 2026-05-18 | workbench-technical | 初稿 |
| v2 | 2026-05-18 | workbench-technical | review-agent 第 1 轮修复：B-01 ai-done 双触发（done_emitted flag + macro）、B-02 usage JSON path 明确（message_start→val["message"]["usage"]["input_tokens"]，message_delta→val["usage"]["output_tokens"]）、W-01 两分支去重、W-02 context_tokens_used 改为取路径最后一个 atom 的 input+output、W-03 Node 2b 显式 usage 构造代码、W-04 默认 A1+B1 选定、W-05 token 字段写入顺序固定、W-06 T1 验收标准补充首条/次条消息场景、新增 T11 |
| v3 | 2026-05-19 | workbench-technical | review-agent 第 2 轮修复：W-07 新增 prev_yaml/children_str 序列化示例（防止读写格式不一致）、W-08 统一 context_tokens_used 语义说明（存档而非实时，ContextIndicator 从 store 计算）、W-09 T4 验收步骤改为 React DevTools 具体操作 |
