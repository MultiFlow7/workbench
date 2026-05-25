---
project: 工作台
version: v0.11
status: 开发完成
doc_revision: 4
created: 2026-05-21
updated: 2026-05-21
author: workbench-product
tags:
  - 类型/技术文档
  - 主题/技术/工作台
  - 状态/草稿
---

# technical.md · 工作台 v0.11 · 对话流修复 + 工具调用基础框架

---

## 版本概述

v0.11 包含两个层次的工作：

**已实现层（req-036~040）**：五个运行时 bug 修复，在上一开发 session 中已完成代码改动并通过 TypeScript 类型检查（0 errors）。本版本归档记录，将 checklist 直接标为 `[x]`，验收项留给 Tauri App 手动测试。

**待实现层（req-041~043）**：工具调用基础框架，包括后端 `stream_ai` 改造、新增 `execute_tool` 命令、三个内置工具（read_file / run_shell [禁用] / search_vault）、ChatView 工具调用处理逻辑和状态 UI 反馈。

---

## 现状确认（边界扫描）

### stream_ai 当前行为

`workbench/src-tauri/src/commands/ai_stream.rs`：
- 只解析 `content_block_delta.type == "text_delta"` 文字 token
- 不处理 `content_block_start.type == "tool_use"` 和 `content_block_delta.type == "input_json_delta"`
- `messages: Vec<Message>` 其中 `Message.content: String`（仅支持纯文字内容）
- 不接受 `tools` 参数

### vault.rs 已有 search_vault

`search_vault(vault_path: String, keyword: String)` 已实现并注册于 `lib.rs`，接受 vault 路径和关键词，返回 `Vec<NoteResult>`（含 title/path/excerpt）。req-042 的 `search_vault` 工具在 `execute_tool` 内部可直接复用此逻辑（不需要新命令）。

### 前端 Message 格式

ChatView 当前调用 `invoke('stream_ai', { messages: [...historyMessages, userMsg] })` 其中每条消息为 `{ role: 'user'|'assistant', content: string }`。工具调用续请求需要 content 为数组（`tool_use` / `tool_result` blocks），必须修改 messages 类型。

---

## 实现节点

### req-036~040 · 已实现 Bug 修复（归档）

- [x] T-A1 `ChatView.tsx`：两层超时 race condition 修复（`streamTimeoutRef` 双重 clearTimeout + streaming 状态 guard）
- [x] T-A2 `ChatView.tsx` + `NavList.tsx`：取消「新对话」占位 root atom，`pendingIsNewRootRef` + `handleSend` 根节点逻辑
- [x] T-A3 `projects.rs`：`parse_atom_ids` 提取 ID 后补 `.trim()` 修复重启画布空白
- [x] T-A4 `ChatView.tsx`：引入 `pendingQuestionRef`，发送后立即 `setInput('')`
- [x] T-A5 `ChatView.tsx`：`ai-done` handler 调用 `addAtomToProject` 将响应 atom 加入项目

---

### req-041 · Tool Calling 基础框架

**负责角色**：frontend-ui（ChatView）+ Rust 后端（ai_stream.rs）

#### 技术分析

**边界1：messages 类型变更**

当前 `stream_ai` 接受 `messages: Vec<Message>`，其中 `Message.content: String`。工具调用续请求需要内容块数组（tool_use / tool_result）。解决方案：将参数类型改为 `messages: Vec<serde_json::Value>`。Tauri 序列化层接受 JSON Value，旧有的字符串格式 `{ role, content: "text" }` 仍是合法 JSON Value，**向后兼容，前端非工具调用路径无需修改**。

**边界2：Claude API SSE 工具调用事件格式**

模型返回 tool_use 时的 SSE 序列：
```
data: {"type":"content_block_start","index":N,"content_block":{"type":"tool_use","id":"toolu_xxx","name":"tool_name","input":{}}}
data: {"type":"content_block_delta","index":N,"delta":{"type":"input_json_delta","partial_json":"{"}}
data: {"type":"content_block_delta","index":N,"delta":{"type":"input_json_delta","partial_json":'"path":"/foo"}'}}
data: {"type":"content_block_stop","index":N}
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":20}}
data: {"type":"message_stop"}
```

后端需要：追踪当前 tool_use block（index + id + name + input_json 累加器）；在 `content_block_stop` 时解析完整 input；在 `message_delta.stop_reason == "tool_use"` 时 emit `ai-tool-call` 事件（而非 `ai-done`）。

**边界3：工具调用续请求的消息格式**

第二次 `stream_ai` 调用的 messages 需包含：
```json
[
  { "role": "user", "content": "用户问题" },
  { "role": "assistant", "content": [{ "type": "tool_use", "id": "toolu_xxx", "name": "read_file", "input": {...} }] },
  { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "toolu_xxx", "content": "工具返回结果" }] }
]
```

前端需在 `handleSend` 时将 `[...historyMessages, userMsg]` 存入 `pendingMessagesRef`，以便 `ai-tool-call` handler 构造续请求。

#### 实现节点 Checklist

- [x] T-1 `ai_stream.rs`：`stream_ai` 参数 `messages: Vec<Message>` → `messages: Vec<serde_json::Value>`；新增可选参数 `tools: Option<serde_json::Value>`
- [x] T-2 `ai_stream.rs`：新增工具调用事件解析（追踪 tool_use block、累加 input_json_delta、emit `ai-tool-call`）
- [x] T-3 新文件 `src-tauri/src/commands/execute_tool.rs`：`execute_tool` Tauri command 框架（工具分发表）
- [x] T-4 `lib.rs`：注册 `execute_tool` 命令；`mod commands` 中引入 `execute_tool` 模块
- [x] T-5 `paths.ts`：新增 `VAULT_PATH` 常量（`BASE_PATH` 的父目录，即 `'...07-AI知识库/L1-原始对话'`），替代 `BASE_PATH.replace('/QA', '')` 脆弱推导
- [x] T-5b `ChatView.tsx`：`import { VAULT_PATH }` from paths.ts；新增 `pendingMessagesRef`（在 `handleSend` 中捕获完整 messages 数组）；`invoke('stream_ai', ...)` 新增 `tools: TOOL_SCHEMAS` 参数
- [x] T-6 `ChatView.tsx`：注册 `listen('ai-tool-call', ...)` handler（`useEffect` 内，与 `ai-done` 同批注册）
- [x] T-7 `ChatView.tsx`：`ai-tool-call` handler 实现工具调用循环（call execute_tool → 构造续请求 messages → 再次调用 stream_ai）

#### T-1 详情：stream_ai 参数类型变更 + tools 参数

**文件**：`workbench/src-tauri/src/commands/ai_stream.rs`

```diff
- use crate::models::Message;
  use crate::stream_state::StreamState;

 #[command]
 pub async fn stream_ai(
     app: AppHandle,
-    messages: Vec<Message>,
+    messages: Vec<serde_json::Value>,
     model: String,
     atom_id: String,
     system: Option<String>,
     api_key: Option<String>,
     base_url: Option<String>,
+    tools: Option<serde_json::Value>,
 ) -> Result<(), String> {
```

构建 request_body 时加入 tools：

```diff
  let mut request_body = serde_json::json!({
      "model": model,
      "max_tokens": 4096,
      "stream": true,
      "messages": messages,
  });
+ if let Some(t) = tools {
+     request_body["tools"] = t;
+ }
```

#### T-2 详情：工具调用事件解析

**文件**：`workbench/src-tauri/src/commands/ai_stream.rs`

在函数体顶部新增工具调用追踪状态：

```rust
// 工具调用追踪
struct ToolUseState {
    index: usize,
    id: String,
    name: String,
    input_json: String,
}
let mut pending_tool: Option<ToolUseState> = None;
```

新增三个解析函数（仿照已有的 `parse_delta`）：

```rust
fn parse_tool_use_start(line: &str) -> Option<(usize, String, String)> {
    let data = line.strip_prefix("data: ")?;
    let val: serde_json::Value = serde_json::from_str(data).ok()?;
    if val["type"].as_str()? == "content_block_start" {
        let block = &val["content_block"];
        if block["type"].as_str()? == "tool_use" {
            let index = val["index"].as_u64()? as usize;
            let id = block["id"].as_str()?.to_string();
            let name = block["name"].as_str()?.to_string();
            return Some((index, id, name));
        }
    }
    None
}

fn parse_input_json_delta(line: &str, expected_index: usize) -> Option<String> {
    let data = line.strip_prefix("data: ")?;
    let val: serde_json::Value = serde_json::from_str(data).ok()?;
    if val["type"].as_str()? == "content_block_delta"
        && val["index"].as_u64()? as usize == expected_index
    {
        let delta = &val["delta"];
        if delta["type"].as_str()? == "input_json_delta" {
            return delta["partial_json"].as_str().map(|s| s.to_string());
        }
    }
    None
}

fn is_tool_use_stop(line: &str) -> bool {
    if let Some(data) = line.strip_prefix("data: ") {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(data) {
            if val["type"].as_str() == Some("message_delta") {
                return val["delta"]["stop_reason"].as_str() == Some("tool_use");
            }
        }
    }
    false
}
```

在 SSE 解析循环中新增（在 `is_message_stop` 处理之前）：

```rust
// 工具调用事件解析
if let Some((idx, id, name)) = parse_tool_use_start(line) {
    pending_tool = Some(ToolUseState { index: idx, id, name, input_json: String::new() });
}
if let Some(ref mut tool) = pending_tool {
    if let Some(chunk) = parse_input_json_delta(line, tool.index) {
        tool.input_json.push_str(&chunk);
    }
}
if is_tool_use_stop(line) {
    if let Some(tool) = pending_tool.take() {
        let parsed_input: serde_json::Value =
            serde_json::from_str(&tool.input_json).unwrap_or(serde_json::Value::Null);
        let _ = app.emit("ai-tool-call", serde_json::json!({
            "atom_id": atom_id,
            "tool_use_id": tool.id,
            "tool_name": tool.name,
            "tool_input": parsed_input,
        }));
    }
    return Ok(()); // 不 emit ai-done，等待前端 continue 调用
}
```

> **注意**：`is_tool_use_stop` 检测的是 `type == "message_delta"` 行，`is_message_stop` 检测的是 `type == "message_stop"` 行（两者是不同 SSE 事件行，不存在同行冲突）。工具调用场景下，`is_tool_use_stop` 触发 `return Ok(())` 使函数提前退出，后续到来的 `message_stop` 行不会再被处理——这是互斥的真正保证（函数已退出），而非 API 层面的保证。需确保 `is_tool_use_stop` 的判断分支在 `is_message_stop` 之前出现，避免非工具调用场景的 `message_stop` 被 `is_tool_use_stop` 误匹配（实际不会，因为两者匹配不同 SSE type 字段）。

#### T-3/T-4 详情：execute_tool 命令框架

**新文件**：`workbench/src-tauri/src/commands/execute_tool.rs`

```rust
use tauri::command;

#[command]
pub async fn execute_tool(
    tool_name: String,
    tool_input: serde_json::Value,
    vault_path: String,
) -> Result<String, String> {
    match tool_name.as_str() {
        "read_file" => tool_read_file(tool_input, &vault_path),
        "search_vault" => tool_search_vault(tool_input, &vault_path),
        "run_shell" => Err("run_shell 工具在当前版本中已禁用".to_string()),
        other => Err(format!("未知工具: {}", other)),
    }
}
```

**文件**：`workbench/src-tauri/src/commands/mod.rs`

追加：`pub mod execute_tool;`

**文件**：`workbench/src-tauri/src/lib.rs`

```diff
  use commands::{ai_stream, backend_client, event_log, projects, qa_atoms, sse_client, vault};
+ use commands::execute_tool;

  // 在 invoke_handler 中追加：
  execute_tool::execute_tool,
```

#### T-5 详情：ChatView 传入 tools 参数 + pendingMessagesRef

**文件**：`workbench/src/components/ChatView/ChatView.tsx`

在组件顶部（现有 ref 定义之后）新增：

```typescript
// 工具调用：存储发送时的完整消息数组，供 ai-tool-call handler 构造续请求
const pendingMessagesRef = useRef<Array<{ role: string; content: unknown }>>([])
```

**`TOOL_SCHEMAS` 为组件外常量**，放在 `export function ChatView()` 函数外（文件顶部或 imports 区域后），避免每次渲染重新分配：

```typescript
// ↓ 放在 export function ChatView() 之外（组件外、文件顶部）
const TOOL_SCHEMAS = [
  {
    name: 'read_file',
    description: '读取本地文件内容，返回文本（超 50KB 截断）',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对路径' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_vault',
    description: '在 Obsidian vault 中全文搜索，返回匹配路径和摘要',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        max_results: { type: 'number', description: '最多返回条数，默认 5' },
      },
      required: ['query'],
    },
  },
]
```

在 `handleSend` 中捕获完整 messages 数组（在 `invoke('stream_ai', ...)` 之前）：

```typescript
// ↓ 在 handleSend 函数内部，invoke('stream_ai') 之前
const fullMessages = [...historyMessages, { role: 'user', content: input }]
pendingMessagesRef.current = fullMessages

// 捕获 system prompt，供 ai-tool-call 续请求与原始请求保持一致的系统提示
systemPromptRef.current = systemPrompt  // systemPrompt 来自 await buildSystemPrompt()
```

`invoke('stream_ai', ...)` 调用追加 `tools` 参数：

```diff
  invoke('stream_ai', {
-   messages: [...historyMessages, { role: 'user', content: input }],
+   messages: fullMessages,
    model,
    atomId: newAtomId,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(apiBaseUrl ? { baseUrl: apiBaseUrl } : {}),
+   tools: TOOL_SCHEMAS,
  }),
```

#### T-6/T-7 详情：ai-tool-call 监听器

**文件**：`workbench/src/components/ChatView/ChatView.tsx`

在现有 refs 中追加：

```typescript
const apiKeysRef = useRef(apiKeys)
useEffect(() => { apiKeysRef.current = apiKeys }, [apiKeys])
// systemPromptRef：捕获 handleSend 中生成的 system prompt，供 ai-tool-call 续请求使用
const systemPromptRef = useRef<string | undefined>(undefined)
```

在 `useEffect`（注册 ai-token / ai-done 等监听器的那个）中追加注册 `ai-tool-call`。**依赖数组维持原有四项不变**（`[appendAtom, selectAtom, setStreamingState, updateAtomTokens]`）——handler 内部使用的 `setToolCallStatuses` 是 `useState` setter，React 保证其引用稳定，无需加入依赖数组；`pendingMessagesRef`、`modelRef`、`apiKeysRef` 均为 ref，不触发重注册：

```typescript
listen<{
  atom_id: string
  tool_use_id: string
  tool_name: string
  tool_input: Record<string, unknown>
}>('ai-tool-call', async (e) => {
  const { atom_id, tool_use_id, tool_name, tool_input } = e.payload
  const startTime = Date.now()

  // 显示工具执行状态
  const inputSummary = summarizeToolInput(tool_name, tool_input)
  setToolCallStatuses((prev) => [
    ...prev,
    { toolUseId: tool_use_id, toolName: tool_name, inputSummary, status: 'running' as const },
  ])

  // 执行工具
  const vaultPath = VAULT_PATH   // 定义于 paths.ts（T-5 新增），vault 根目录
  let toolResult: string
  try {
    toolResult = await invoke<string>('execute_tool', {
      toolName: tool_name,
      toolInput: tool_input,
      vaultPath,
    })
    setToolCallStatuses((prev) =>
      prev.map((t) =>
        t.toolUseId === tool_use_id
          ? { ...t, status: 'done' as const, durationMs: Date.now() - startTime }
          : t
      )
    )
  } catch (err) {
    toolResult = JSON.stringify({ error: String(err) })
    setToolCallStatuses((prev) =>
      prev.map((t) =>
        t.toolUseId === tool_use_id
          ? { ...t, status: 'error' as const, errorMessage: String(err) }
          : t
      )
    )
  }

  // 构造续请求 messages
  const continuationMessages = [
    ...pendingMessagesRef.current,
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: tool_use_id, name: tool_name, input: tool_input }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id, content: toolResult }],
    },
  ]

  // 继续 stream_ai（使用相同 atom_id，最终 ai-done 写入同一 atom）
  const matchedKey = findKeyForModel(apiKeysRef.current, modelRef.current)
  await invoke('stream_ai', {
    messages: continuationMessages,
    model: modelRef.current,
    atomId: atom_id,
    tools: TOOL_SCHEMAS,
    ...(systemPromptRef.current ? { system: systemPromptRef.current } : {}),
    ...(matchedKey?.key ? { apiKey: matchedKey.key } : {}),
    ...(matchedKey?.baseUrl ? { baseUrl: matchedKey.baseUrl } : {}),
  }).catch((err: unknown) => {
    console.error('[ChatView] tool continuation stream_ai failed:', err)
    setStreamingState('error')
  })
}).then((u) => unlisteners.push(u))
```

辅助函数（放在组件外）：

```typescript
function summarizeToolInput(
  toolName: string,
  toolInput: Record<string, unknown>
): string {
  if (toolName === 'read_file') return String(toolInput.path ?? '').slice(0, 50)
  if (toolName === 'search_vault') return String(toolInput.query ?? '').slice(0, 40)
  if (toolName === 'run_shell') return String(toolInput.command ?? '').slice(0, 40)
  return JSON.stringify(toolInput).slice(0, 40)
}
```

---

### req-042 · 内置工具集

**负责角色**：Rust 后端（execute_tool.rs）

#### 实现节点 Checklist

- [x] T-8 `execute_tool.rs`：实现 `tool_read_file`（路径校验 + 文件读取 + 50KB 截断）
- [x] T-9 `execute_tool.rs`：实现 `tool_run_shell`（函数体只返回 Err，占位）
- [x] T-10 `execute_tool.rs`：实现 `tool_search_vault`（调用 `crate::commands::vault::search_vault` 复用已有实现，不重写搜索逻辑）

#### T-8 详情：tool_read_file

```rust
fn tool_read_file(
    input: serde_json::Value,
    vault_path: &str,
) -> Result<String, String> {
    use std::fs;
    use std::path::Path;

    let path_str = input["path"]
        .as_str()
        .ok_or_else(|| "read_file: 缺少 path 参数".to_string())?;
    let path = Path::new(path_str);

    // 路径白名单：必须在 vault_path 下
    let canonical_path = path
        .canonicalize()
        .map_err(|_| format!("路径不存在或无法访问: {}", path_str))?;
    let canonical_vault = Path::new(vault_path)
        .canonicalize()
        .map_err(|_| "vault 路径无效".to_string())?;
    if !canonical_path.starts_with(&canonical_vault) {
        return Err(format!("路径 {} 超出允许范围（vault 目录外）", path_str));
    }

    // 系统路径拒绝（额外保护）
    for prefix in &["/etc/", "/usr/", "/bin/", "/sbin/", "/System/"] {
        if path_str.starts_with(prefix) {
            return Err(format!("拒绝访问系统路径: {}", path_str));
        }
    }

    let content = fs::read_to_string(&canonical_path)
        .map_err(|e| format!("读取文件失败: {}", e))?;

    const MAX_CHARS: usize = 50 * 1024; // ~50KB（按字符数截断，避免多字节字符边界 panic）
    let char_count = content.chars().count();
    if char_count > MAX_CHARS {
        // 按字符边界安全截断（含中文等多字节字符）
        let truncated: String = content.chars().take(MAX_CHARS).collect();
        Ok(format!(
            "{}（内容已截断，共 {} 字符）",
            truncated,
            char_count
        ))
    } else {
        Ok(content)
    }
}
```

#### T-9 详情：tool_run_shell（占位）

```rust
fn tool_run_shell(
    _input: serde_json::Value,
    _vault_path: &str,
) -> Result<String, String> {
    Err("run_shell 工具在当前版本中已禁用，需在设置中手动开启".to_string())
}
```

#### T-10 详情：tool_search_vault

复用 `vault.rs` 中已有的 `pub fn search_vault` 实现（包含 `extract_excerpt` 等内部逻辑），不重写搜索逻辑：

```rust
fn tool_search_vault(
    input: serde_json::Value,
    vault_path: &str,
) -> Result<String, String> {
    use crate::commands::vault;

    let query = input["query"]
        .as_str()
        .ok_or_else(|| "search_vault: 缺少 query 参数".to_string())?;
    let max_results = input["max_results"].as_u64().unwrap_or(5) as usize;

    // 调用已有实现：vault::search_vault 是 pub fn，可直接调用
    let all_results = vault::search_vault(vault_path.to_string(), query.to_string())?;

    let json_results: Vec<serde_json::Value> = all_results
        .into_iter()
        .take(max_results)
        .map(|r| serde_json::json!({ "path": r.path, "snippet": r.excerpt }))
        .collect();

    serde_json::to_string_pretty(&json_results)
        .map_err(|e| format!("序列化结果失败: {}", e))
}
```

> **注意**：`vault::search_vault` 在 `vault.rs` 中是 `pub fn`，`#[command]` macro 不影响其可调用性，可以正常作为普通 Rust 函数调用。`execute_tool.rs` 文件顶部需引入 `use crate::commands::vault;`。

---

### req-043 · 工具调用状态 UI 反馈

**负责角色**：frontend-ui

#### 实现节点 Checklist

- [x] T-11 `ChatView.tsx`：新增 `ToolCallStatus` interface 和 `toolCallStatuses` state；`handleSend` 时清空 `toolCallStatuses`
- [x] T-12 `ChatView.tsx`（JSX）：在 streaming 气泡下方渲染 `toolCallStatuses` 状态行
- [x] T-13 `ChatView.css`：新增工具状态行样式

#### T-11 详情：状态定义与清理

**文件**：`workbench/src/components/ChatView/ChatView.tsx`

在组件内 `useState` 定义区追加：

```typescript
interface ToolCallStatus {
  toolUseId: string
  toolName: string
  inputSummary: string
  status: 'running' | 'done' | 'error'
  durationMs?: number
  errorMessage?: string
}
const [toolCallStatuses, setToolCallStatuses] = useState<ToolCallStatus[]>([])
```

在 `handleSend` 中（`setStreamingState('streaming')` 之后）追加清空：

```typescript
setToolCallStatuses([])
```

#### T-12 详情：工具状态行 JSX

**文件**：`workbench/src/components/ChatView/ChatView.tsx`

在 streaming 气泡（`streamingText` 部分）之后、发送按钮之前，插入：

```tsx
{/* 工具调用状态行（仅当前 streaming session，内存展示） */}
{toolCallStatuses.map((t) => (
  <div key={t.toolUseId} className={`tool-status tool-status--${t.status}`}>
    {t.status === 'running' && (
      <>
        <span className="tool-status__spinner" />
        <span>正在执行工具：{t.toolName}（"{t.inputSummary}"）...</span>
      </>
    )}
    {t.status === 'done' && (
      <span>✓ 工具执行完成{t.durationMs !== undefined ? `（${(t.durationMs / 1000).toFixed(1)}s）` : ''}</span>
    )}
    {t.status === 'error' && (
      <span>✗ 工具执行失败：{t.errorMessage}</span>
    )}
  </div>
))}
```

> **位置**：状态行渲染在 streaming bubble 之后（在 `{streamingState === 'streaming' && (...)}` 块的末尾），而非气泡内部，确保视觉层次清晰。

#### T-13 详情：工具状态行 CSS

**文件**：`workbench/src/components/ChatView/ChatView.css`

追加：

```css
/* v0.11 req-043: 工具调用状态行 */
.tool-status {
  font-size: 12px;
  font-family: 'Inter', sans-serif;
  padding: 4px 12px;
  margin: 4px 0;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.4;
}

.tool-status--running {
  color: var(--color-muted, #6b7280);
  background: rgba(37, 99, 235, 0.05);
  border: 1px solid rgba(37, 99, 235, 0.15);
}

.tool-status--done {
  color: #16a34a;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
}

.tool-status--error {
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fbbf24;
}

.tool-status__spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(37, 99, 235, 0.3);
  border-top-color: var(--accent, #2563eb);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

---

## 测试清单

### req-036~040（已实现 bug 修复）

| 编号 | 测试项 | 操作 | 期望结果 |
|------|--------|------|---------|
| TC-A01 | race condition 验证 | 正常发送消息并等待 AI 回复 | 30s 内收到 AI 回复，无「请检查网络或 API Key」错误横幅 |
| TC-A02 | 根节点结构验证 | 新建对话，发送第一条消息 | BranchTree 中只有一个节点（Q&A 本身），无额外「新对话」占位节点 |
| TC-A03 | 重启后画布不空 | 发送消息，重启应用，选中该项目 | BranchTree 正确显示历史对话节点，不为空 |
| TC-A04 | 发送后输入框即清空 | 发送消息 | 点击发送后输入框立即清空，不等 AI 回复 |
| TC-A05 | BranchTree 响应节点可见 | AI 回复完成后查看 BranchTree | BranchTree 中出现新节点，不需要刷新 |

### req-041 · Tool Calling 基础框架

| 编号 | 测试项 | 操作 | 期望结果 |
|------|--------|------|---------|
| TC-041-01 | tool_call 被检测到 | 发消息「请读取 /path/to/file.md 的内容」 | ChatView 出现工具执行状态行（「正在执行工具：read_file」），不直接返回文字 |
| TC-041-02 | 工具执行并回传 | 同上（文件存在） | 工具执行完成后 AI 继续给出最终文字回答，引用文件内容 |
| TC-041-03 | 闭环完成 | 完整执行一次工具调用 | 用户看到 AI 使用工具后的最终回答，ChatView 恢复 idle 状态 |
| TC-041-04 | 执行失败降级 | 请求读取不存在的文件 | ChatView 显示「✗ 工具执行失败」状态行，AI 仍能继续回答（收到错误信息后的降级回答） |
| TC-041-05 | 非工具对话不受影响 | 正常发送纯聊天消息 | 无工具调用行为，对话流程与 v0.10 完全相同 |

### req-042 · 内置工具集

| 编号 | 测试项 | 操作 | 期望结果 |
|------|--------|------|---------|
| TC-042-01 | read_file 读取 vault 内文件 | 指定一个 vault 目录内的 .md 文件路径 | 返回文件内容，AI 引用内容作出回答 |
| TC-042-02 | read_file 路径限制生效 | 指定 `/etc/passwd` 等系统路径 | execute_tool 返回「拒绝访问系统路径」错误 |
| TC-042-03 | read_file 路径限制生效 | 指定 vault 目录外的用户文件 | execute_tool 返回「超出允许范围（vault 目录外）」错误 |
| TC-042-04 | run_shell 被拒绝 | 如果 AI 尝试调用 run_shell | execute_tool 返回「已禁用」错误；由于 run_shell 不在 TOOL_SCHEMAS 中，AI 不应主动调用此工具 |
| TC-042-05 | search_vault 返回结果 | 发消息「帮我在知识库里搜索'tool calling'」 | 返回包含路径和摘要的列表，AI 基于结果回答 |
| TC-042-06 | tool schema 正确传递 | 使用开发者工具查看 stream_ai 请求 payload（或 console.log） | request body 含 tools 数组，有 read_file 和 search_vault 两个工具定义 |

### req-043 · 工具调用状态 UI 反馈

| 编号 | 测试项 | 操作 | 期望结果 |
|------|--------|------|---------|
| TC-043-01 | 工具执行中有可见反馈 | 触发工具调用 | 显示「⚙ 正在执行工具：xxx（"..."）...」行，有旋转动效 |
| TC-043-02 | 执行完成状态更新 | 工具正常完成 | 状态行变为「✓ 工具执行完成（Xs）」，绿色样式 |
| TC-043-03 | 执行失败有提示 | 工具执行返回错误 | 状态行变为「✗ 工具执行失败：[原因]」，黄色样式 |
| TC-043-04 | 新对话工具状态清空 | 发第二条消息触发工具调用 | 第一条消息的工具状态不显示，只显示当前消息的工具状态 |
| TC-043-05 | 样式与设计系统一致 | 观察工具状态行视觉 | 字体 Inter，颜色与 ChatView 其他元素协调，不突兀 |

---

## 风险与注意事项

### 风险 1：messages 类型变更（Vec<Message> → Vec<serde_json::Value>）

**风险**：Tauri 命令参数类型从 `Vec<Message>` 改为 `Vec<serde_json::Value>`，序列化/反序列化行为变化可能导致现有调用路径出现 runtime 错误。

**缓解**：`serde_json::Value` 是 JSON 值的超集，`{ role: "user", content: "text" }` 完全是合法 Value。Tauri 的 serde 反序列化接受任意 JSON——旧调用格式（字符串 content）和新调用格式（数组 content）均能反序列化为 `serde_json::Value`。TypeScript 调用侧需确认编译通过（`cargo build` 和 `npx tsc --noEmit` 均通过后才部署）。

**注意**：`lib.rs` 中的 `use crate::models::Message;` import 在 `ai_stream.rs` 中可能不再需要（若 Message struct 已无其他引用）。需检查是否有 unused import 警告并清理。

### 风险 2：ai-tool-call handler 中续请求使用的 messages 与原始 historyMessages 不一致

**风险**：`pendingMessagesRef.current` 捕获的是 `handleSend` 中的 `fullMessages`（含 filter + map 处理后的历史）。若对话历史含「分支节点」标记消息（`— 分支节点 xxx —`），这些被 filter 掉的消息不在 `historyMessages` 中。工具调用续请求用 `pendingMessagesRef` 是正确的——与第一次调用 `stream_ai` 传入的 messages 完全一致。

**缓解**：确认 `pendingMessagesRef.current = fullMessages` 在 `invoke('stream_ai', { messages: fullMessages, ... })` 的同一行（或前一行）赋值，保证两者完全一致。

### 风险 3：工具调用期间用户触发 cancel

**风险**：`handleStop` 调用 `cancel_stream`，但工具调用期间正在执行 `execute_tool`（本地 Tauri command）。取消只会停止 SSE stream，不会中断 `execute_tool` 的 Rust 执行（如 search_vault 遍历大目录）。

**缓解**：v0.11 Out of Scope 明确不支持工具调用中途取消（输入框禁用期间 Stop 按钮是否显示需确认）。临时缓解：在续请求 `invoke('stream_ai', ...)` 之前检查 `streamingState`，若已变为非 streaming 则放弃续请求。这防止了「用户在工具执行完成前已 cancel，但续请求仍被发出」的情况。

### 注意事项：同步 I/O 在 async 命令中的影响

`execute_tool` 是 `pub async fn`，但内部的 `tool_read_file`、`tool_search_vault` 使用同步 I/O（`std::fs::read_to_string`、同步 `WalkDir`）。在 Tokio runtime 的 async 线程中直接调用同步阻塞 I/O 会占用 async worker 线程，对大文件或大目录遍历可能影响其他并发任务。

**v0.11 接受此现状**：vault 文件通常为 KB 级，遍历目录数量有限，实际影响可忽略。若未来遇到性能问题，可改用 `tokio::fs::read_to_string` 和 `tokio::task::spawn_blocking`，作为 v0.12+ 的技术债务项。

### 注意事项：search_vault 的 vault_path

T-7 中 `vault_path` 通过 `BASE_PATH.replace('/QA', '')` 推导，这是 hardcoded 字符串操作，假设 BASE_PATH 以 `/QA` 结尾。若路径结构变化，推导会静默失败（返回原路径）。

更稳健的方案：在 `paths.ts` 中直接定义 `VAULT_PATH` 常量（`BASE_PATH` 的父目录）。这只需在 paths.ts 中追加一行，不引入其他变动。推荐在实现 T-5 时同步修改 paths.ts，并在 ChatView 中 `import { VAULT_PATH } from '../../utils/paths'`。

---

## 修订记录

| 版本 | 日期 | 修改内容 |
|------|------|---------|
| doc_revision 1 | 2026-05-21 | 初稿，基于 v0.11 product.md 和代码现状分析创建 |
| doc_revision 2 | 2026-05-21 | workbench-review 修复：① T-2 注释修正互斥保证的真正机制（is_tool_use_stop 的 return 提前退出）；② T-6/T-7 补充 useEffect 依赖数组说明（setToolCallStatuses 稳定，不加入依赖）；③ T-5 拆分出 T-5/T-5b，新增 paths.ts VAULT_PATH 常量 checklist 项；④ T-10 改为调用 vault::search_vault 复用实现，不重写搜索逻辑；⑤ 新增「同步 I/O 技术债务」注意事项 |
| doc_revision 3 | 2026-05-21 | workbench-review 第3轮修复：① T-7 代码示例中 vaultPath 改为使用 VAULT_PATH（消除脆弱 replace 推导）；② T-8 截断改为按字符数截断（`chars().take(MAX_CHARS)`），避免多字节字符边界 panic；③ TOOL_SCHEMAS 代码示例明确标注「放在组件外」与「handleSend 内」的代码块分离，消除歧义 |
| doc_revision 4 | 2026-05-21 | workbench-review 第4轮修复：① 新增 `systemPromptRef`（在 handleSend 中捕获 system prompt）；② ai-tool-call 续请求加入 `system: systemPromptRef.current`，与原始 stream_ai 请求保持 system prompt 一致性 |
