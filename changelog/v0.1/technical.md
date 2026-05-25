---
project: 工作台
product_version: v0.1
doc_revision: 10
status: approved
product_doc: changelog/v0.1/product.md
created: 2026-05-17
updated: 2026-05-18
---

# 技术执行文档 · 工作台 v0.1

关联产品规划：[[changelog/v0.1/product]]

---

## 技术方案概述

工作台 v0.1 是一个 Tauri v2 桌面应用，React 前端通过两条通道与外部交互：

- **Tauri Commands（Rust）**：读写本地 QA 原子文件和埋点日志，不经网络
- **Tauri HTTP Plugin（Rust）**：向远端 sub2api 发起 SSE 流式请求，Rust 层逐 token 通过 Tauri Event 推送前端

所有 Panel 通信经由 Zustand store，不直接调用彼此。

### 关键决策

| 决策 | 选择 | 放弃的方案及理由 |
|------|------|----------------|
| AI streaming 实现 | Tauri HTTP Plugin（Rust 层读 SSE） | 前端 fetch SSE：Tauri WebView 的 EventSource 有兼容性问题，已验证不可靠 |
| QA 原子存储 | 本地 .md 文件，复用无限画布 persistence 格式 | 独立数据库：破坏 Obsidian 知识库集成，增加迁移成本 |
| 启动数据加载 | 全量加载 BASE_PATH 下所有 QA 原子，无过滤 | 按项目过滤：目标是替代无限画布，需全局视图 |
| 本地服务器 | 不启动本地 Node.js 服务器 | 复用无限画布 WS 服务器：Tauri Rust 层直接处理文件和 HTTP，不需要中间层 |
| API key 存储 | Tauri 配置/环境变量，运行时读取 | 硬编码源码：安全风险，不可配置 |

---

## 技术栈与版本锁定

| 层 | 技术 | 版本 |
|----|------|------|
| 桌面框架 | Tauri | v2（latest stable） |
| 前端框架 | React | 18 |
| 类型系统 | TypeScript | 5（strict mode） |
| 构建工具 | Vite | latest |
| 状态管理 | Zustand + immer | latest |
| HTTP + SSE（Rust） | reqwest + eventsource-stream | via tauri-plugin-http |
| YAML 解析（Rust） | serde_yaml | latest |
| SVG 树布局 | 自实现 Reingold-Tilford | — |
| 包管理 | pnpm | latest |

---

## 环境变量

| 变量名 | 开发默认值 | 说明 |
|--------|-----------|------|
| `SUB2API_KEY` | 见 `.env.local`（不提交 git） | sub2api 鉴权 key，Rust 层 `std::env::var("SUB2API_KEY")` 读取 |

`.env.local` 放在项目根目录，`.gitignore` 中已排除。生产打包时通过构建环境注入。

---

## 目录结构

```
workbench/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── models.rs              # QAAtomMeta, QAAtom, EventLog, Message
│   │   ├── stream_state.rs        # StreamState, CancellationToken 共享状态
│   │   └── commands/
│   │       ├── qa_atoms.rs        # list_qa_atoms, read_qa_atom, write_qa_atom
│   │       ├── vault.rs           # search_vault
│   │       ├── ai_stream.rs       # stream_ai, cancel_stream
│   │       └── event_log.rs       # write_event_log
│   ├── capabilities/
│   │   └── default.json           # 最小权限声明
│   └── tauri.conf.json
├── src/
│   ├── styles/
│   │   └── tokens.css             # CSS Variables 设计 token
│   ├── store/
│   │   ├── layoutSlice.ts
│   │   └── conversationSlice.ts
│   ├── components/
│   │   ├── Layout/                # P1~P4 容器与折叠逻辑
│   │   ├── BranchTree/            # P2 SVG 树
│   │   ├── ChatView/              # P3 线性对话 + 输入框
│   │   └── DetailPanel/           # P4 只读详情
│   └── main.tsx
└── package.json
```

---

## 实现阶段

> 进度：13/13 节点完成（9 原计划 + 4 超出 scope 补录）
>
> ⚠️ **实现偏差说明（2026-05-18 CEO 补录）**：实现过程中工程 Agent 在未经正式审批的情况下进行了以下偏差，已事后补录为额外节点（节点 10-12）：
> - 节点 4（四面板布局）：实际在 P1 增加了 200px 可折叠 NavList，顶部增加了 36px TopBar，与原规格（P1 固定 48px）不符
> - 节点 6（对话分支树）：实际实现为 HTML div 卡片 + 鼠标拖拽无限画布，而非规格中的 SVG Reingold-Tilford 纯矢量树
> - models.rs ProjectMeta 序列化 bug（atom_ids → atomIds camelCase）已修复（2026-05-18）

---

### 节点 1：Tauri 应用骨架（req-001）

**工作量**：0.5 天

**技术细节**：

用 `pnpm create tauri-app` 初始化，选 React + TypeScript 模板。

`tauri.conf.json` 窗口配置：
```json
{
  "app": {
    "windows": [{
      "title": "工作台",
      "width": 1440,
      "height": 900,
      "minWidth": 1024,
      "minHeight": 768,
      "resizable": true
    }]
  }
}
```

`src/styles/tokens.css`：
```css
:root {
  --color-bg: #f5f5f5;
  --color-surface: #ffffff;
  --color-accent: #2563eb;
  --color-text-primary: #111827;
  --color-text-secondary: #6b7280;
  --color-border: #e5e7eb;
  --font-ui: 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --ease-panel: cubic-bezier(0.4, 0, 0.2, 1);
}
```

在 `main.tsx` 中引入 `tokens.css`，`tsconfig.json` 开启 `strict: true`。

**完成标志**：
- `pnpm tauri dev` 启动原生 macOS 窗口，标题「工作台」，尺寸 1440×900
- `tsc --noEmit` 无报错

---

### 节点 2：Tauri 本地文件命令（req-008）

**工作量**：1.5 天

**技术细节**：

Rust 数据模型（`src-tauri/src/models.rs`）：
```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QAAtomMeta {
    pub id: String,
    pub prev: Option<String>,  // None = 根节点；YAML "" 解析后转为 None
    pub children: Vec<String>, // ["[[0001-002]]", ...]
    pub summary: String,       // question 区块首 50 字
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QAAtom {
    pub meta: QAAtomMeta,
    pub question: String,
    pub answer: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EventLog {
    pub event: String,
    pub timestamp: String,
    pub payload: serde_json::Value,
}
```

`list_qa_atoms` 实现要点：
- 遍历目录所有 `.md` 文件（`fs::read_dir` 递归或 `walkdir`）
- 解析 YAML frontmatter（`---` 区块）提取字段
- `prev` 字段为空字符串时 → `Option::None`（序列化给前端为 JSON `null`）
- `summary` 截取 `# 问题` 区块正文首 50 字（含 CJK 字符按字符计）

`write_qa_atom` 写入格式（严格对齐无限画布 persistence.ts）：
```
---
id: "0001-002"
prev: "[[0001-001]]"
children: []
timestamp: "2026-05-17T10:30:00Z"
status: done
projects:
  - "[[Canvas]]"
executor: Local
---

# 问题

{question}

# 回答

{answer}
```

`write_event_log`：追加一行 JSON 到 `~/Library/Logs/Workbench/events.jsonl`，目录不存在时 `fs::create_dir_all`。

capability 最小权限（`capabilities/default.json`）：
```json
{
  "permissions": [
    "fs:allow-read-file",
    "fs:allow-write-file",
    "fs:allow-read-dir",
    "fs:allow-create-dir",
    "fs:allow-exists"
  ],
  "scope": {
    "allow": [
      "$HOME/Desktop/Morgan工作仓库/Morgan工作仓库/07-AI知识库/**",
      "$HOME/Library/Logs/Workbench/**"
    ]
  }
}
```

> 注：QA 原子目录实际位于 `~/Desktop/Morgan工作仓库/...`，不在 macOS 标准 `$DOCUMENT`（`~/Documents/`）下，capability scope 使用 `$HOME/Desktop/...` 绝对定位；v0.2 设置界面建立后改为用户可配置路径。

⚠️ `BASE_PATH` 在代码中硬编码为完整绝对路径，v0.2 设置界面建立后改为可配置。

✅ `write_qa_atom` 采用原子写入：先写同目录临时文件（`.{id}.md.tmp`），flush 后 `rename` 到目标路径。rename 是 APFS/ext4 保证的原子操作，消除写入中途崩溃导致文件损坏的风险。（董事长 2026-05-18 决策 A2，已实现）

⚠️ Rust 依赖版本通过 `Cargo.lock` 锁定，首次 `cargo build` 后将 `Cargo.lock` 提交 git，不手动 pin Cargo.toml 中的版本号。

**完成标志**：
- `list_qa_atoms` 读取真实 QA 目录，返回含正确 `prev`（null/wikilink）的元数据列表，终端 console 可验证
- `write_qa_atom` 写出文件，`cat` 验证 frontmatter 包含 `status: done`、`projects: ["[[Canvas]]"]`、`executor: Local`
- `write_event_log` 追加一行到 `events.jsonl`，文件不存在时自动创建

---

### 节点 3：Zustand 状态管理层（req-007）

**工作量**：0.5 天

**技术细节**：

```typescript
// src/store/conversationSlice.ts
interface QAAtomMeta {
  id: string
  prev: string | null    // null = 根节点（对应磁盘 ""，由 Rust 层转换）
  children: string[]     // ["[[0001-002]]", "[[0001-01-001]]"]
  summary: string
  timestamp: string
}

interface ConversationSlice {
  atoms: Record<string, QAAtomMeta>
  selectedAtomId: string | null
  currentPath: QAAtomMeta[]
  streamingState: 'idle' | 'streaming' | 'cancelled' | 'error'
  loadAtoms: () => Promise<void>
  selectAtom: (id: string) => void
  appendAtom: (atom: QAAtomMeta) => void
}
```

`selectAtom` 路径计算（沿 `prev` wikilink 向上回溯）：
```typescript
selectAtom: (id) => set(produce(draft => {
  draft.selectedAtomId = id
  const path: QAAtomMeta[] = []
  let cur: QAAtomMeta | undefined = draft.atoms[id]
  while (cur) {
    path.unshift(cur)
    const prevId = cur.prev
      ? cur.prev.replace(/^\[\[|\]\]$/g, '')  // "[[0001-001]]" → "0001-001"
      : null
    cur = prevId ? draft.atoms[prevId] : undefined
  }
  draft.currentPath = path
}))
// ⚠️ 节点 13 已将此函数改为块形式并引入 get()，实际代码见节点 13
```

`loadAtoms` 调用 `invoke('list_qa_atoms', { conversationDir: BASE_PATH })`，将数组转换为以 `id` 为键的 Record。

`toFilePath` 工具函数（`src/utils/paths.ts`）——节点 8、9 均依赖此规则：
```typescript
const BASE_PATH = '/Users/morgan/Desktop/Morgan工作仓库/Morgan工作仓库/07-AI知识库/L1-原始对话/QA'
// id 即文件名（不含 .md），直接拼接
export const toFilePath = (id: string): string => `${BASE_PATH}/${id}.md`
// 示例：toFilePath("0001-001") → ".../QA/0001-001.md"
```

```typescript
// src/store/layoutSlice.ts
interface LayoutSlice {
  p2Visible: boolean
  p4Visible: boolean
  currentMode: 'chat' | 'tools' | 'console'
  toggleP2: () => void
  toggleP4: () => void
  setMode: (mode: 'chat' | 'tools' | 'console') => void
}
```

**完成标志**：
- `loadAtoms()` 执行后 `atoms` 填充真实 QA 原子数据（React DevTools 可验证）
- `selectAtom('0001-003')` 后 `currentPath` 正确返回 `[根节点, 中间节点, 0001-003]`（含多层分叉测试）
- `streamingState` 四个值均可从 `'idle'` 转入

---

### 节点 4：四面板布局与折叠（req-002）

> ⚠️ **实现偏差（2026-05-18 补录）**：实际 DOM 结构增加了 TopBar（节点 10）和 P1 NavList 分栏（节点 11），DOM 从原规格的单层 flex row 变为 flex column（topBar + workspace）。DEFAULT_LAYOUT 中 P1 宽度由 48px 变为 52px（图标栏）+ 200px（列表栏）。详见节点 10、11。

**工作量**：0.5 天

**技术细节**：

```typescript
// DEFAULT_LAYOUT 配置对象（挂载在 layoutSlice）
const DEFAULT_LAYOUT = {
  p1: { width: 48,  collapsible: false },
  p2: { width: 260, collapsible: true  },
  p3: { flex: 1,    collapsible: false },
  p4: { width: 320, collapsible: true  },
}
```

布局 CSS：
```css
.workspace {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--color-bg);
}
.panel {
  flex-shrink: 0;
  overflow: hidden;
  transition: width var(--duration-normal) var(--ease-panel);
}
.panel--p3 { flex: 1; min-width: 0; }
.panel--collapsed { width: 20px !important; cursor: pointer; }
.panel-strip { /* 薄条展开指示器 › */ }
```

P4 折叠时不卸载组件——使用 `visibility: hidden` + `overflow: hidden` 保留 DOM，展开后内容无需重新 fetch。

**完成标志**：
- P2/P4 点击折叠后宽度精确为 20px，展开动画 250ms 内完成
- P3 在任何状态下均填充剩余宽度，无溢出
- 窗口拖至 1024×768 时各 Panel 不溢出

---

### 节点 5：模式切换导航（req-003）

**工作量**：0.5 天

**技术细节**：

P1 图标栏（NavIcons）固定 52px，包含三个模式切换图标按钮和 NavList 折叠按钮，垂直居中排列：

```typescript
const MODES = [
  { id: 'chat',    label: '对话',  icon: ChatIcon,    active: true  },
  { id: 'tools',   label: '工具',  icon: ToolsIcon,   active: false },
  { id: 'console', label: '控制台',icon: ConsoleIcon, active: false },
] as const
```

禁用态样式：`opacity: 0.35; pointer-events: none;`，hover tooltip 文字「v0.2 即将支持」。

`setMode` 是纯 Zustand 同步更新，无异步操作，<200ms 天然满足。

**完成标志**：
- 点击对话图标，active 态高亮切换；Chrome DevTools Performance 标注 < 200ms
- 工具/控制台图标点击无响应，hover 显示 tooltip

---

### 节点 6：对话分支树（req-004）

**工作量**：2 天

> ⚠️ **实现偏差（2026-05-18 补录）**：实际实现为 HTML div 卡片 + 鼠标拖拽无限画布，与原规格（SVG Reingold-Tilford）不同。以下为实际实现描述。

**实际技术细节**：

树布局采用自实现宽度优先算法（非 SVG，HTML div 绝对定位）：

```typescript
interface LayoutNode {
  atom: QAAtomMeta
  x: number   // center x（px）
  y: number   // top y（px），depth * (NODE_H + GAP_Y)
  children: LayoutNode[]
}

const NODE_W = 140, NODE_H = 60, GAP_X = 20, GAP_Y = 100
// buildLayoutTree：prev===null 为根节点；DFS 构建，assignX 递归分配中心 x
```

无限画布（pan + zoom）：
- 外层容器捕获 `onMouseDown/Move/Up/Leave` 实现拖拽平移
- `onWheel` 实现 scale-at-mouse 缩放（范围 0.3–2.5）
- 内层 `.bt-canvas` 应用 `transform: translate(x,y) scale(s)`

节点卡片（HTML div）结构：
```
[ID badge top-right]
U: 摘要文字（2行clamp）
───────────────
AI: 摘要文字（2行clamp）
```

SVG overlay 只用于绘制贝塞尔连线，节点本身是 positioned div。

项目过滤：当 `selectedProjectId !== null` 时，`filteredAtoms` useMemo 只保留 `project.atomIds` 中的节点。项目数据（包含 `atomIds`）由节点 12 `list_projects` Command 提供，见节点 12。

**完成标志**：
- P2 渲染真实 QA 原子树（div 卡片），支持鼠标拖拽平移和滚轮缩放
- 点击节点高亮（border accent 色），`store.selectedAtomId` 正确更新
- NavList 切换项目后 P2 树按该项目 atomIds 过滤节点
- 无节点时显示「暂无对话节点」空状态

---

### 节点 7：SSE AI 客户端（req-009）

**工作量**：1.5 天

**技术细节**：

取消机制的共享状态（`src-tauri/src/stream_state.rs`）：
```rust
pub struct StreamState {
    pub token: Mutex<Option<CancellationToken>>,
}
// lib.rs：.manage(StreamState::default())
```

`stream_ai` 实现要点（`src-tauri/src/commands/ai_stream.rs`）：
```rust
#[command]
pub async fn stream_ai(app: AppHandle, messages: Vec<Message>, model: String, atom_id: String)
    -> Result<(), String>
{
    // 1. 创建 CancellationToken，注册到 AppState
    let cancel = CancellationToken::new();
    *app.state::<StreamState>().token.lock().unwrap() = Some(cancel.clone());

    // 2. 发起 HTTP 请求
    let response = reqwest::Client::new()
        .post("http://43.135.174.27:8080/v1/messages")
        .header("x-api-key", std::env::var("SUB2API_KEY").unwrap_or_default())
        .header("anthropic-version", "2023-06-01")
        .json(&serde_json::json!({
            "model": model, "max_tokens": 4096, "stream": true, "messages": messages
        }))
        .send().await.map_err(|e| e.to_string())?;

    // 非 2xx 直接 emit ai-error
    if !response.status().is_success() {
        let _ = app.emit("ai-error", ...);
        return Err(...);
    }

    // 3. tokio::select! 监听取消 vs 流数据
    let mut stream = response.bytes_stream();
    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                let _ = app.emit("ai-cancelled", ...);
                return Ok(());
            }
            chunk = stream.next() => {
                // 解析 SSE 行，emit ai-token；检测 message_stop emit ai-done
            }
        }
    }
}

// cancel_stream：从 AppState 取出 token 调用 .cancel()
#[command]
pub async fn cancel_stream(app: AppHandle) -> Result<(), String> {
    if let Some(token) = app.state::<StreamState>().token.lock().unwrap().take() {
        token.cancel();
    }
    Ok(())
}
```

前端事件监听（P3 挂载时注册，卸载时解除）：
```typescript
const unlisten = await listen('ai-token', (e) => appendToken(e.payload.text))
await listen('ai-done',      (e) => onStreamDone(e.payload))
await listen('ai-error',     ()  => setStreamingState('error'))
await listen('ai-cancelled', ()  => setStreamingState('cancelled'))
```

API key 从环境变量 `SUB2API_KEY` 读取；开发环境写入 `.env.local`，不提交 git。

**完成标志**：
- 调用 `stream_ai` 后 P3 逐字追加 token，Network（Tauri IPC）可见 `ai-token` 事件流
- 点击停止后 streaming 中止，`streamingState` 变为 `cancelled`
- 模拟断网后 `ai-error` 触发，P3 显示错误提示 + 重试按钮

---

### 节点 8：线性对话视图（req-005）

**工作量**：1 天

**技术细节**：

P3 订阅 `currentPath` 和 `streamingState`：
```typescript
const currentPath  = useConversationStore(s => s.currentPath)
const streamingState = useConversationStore(s => s.streamingState)

// currentPath 变化时，批量读取完整 QA 原子
useEffect(() => {
  if (!currentPath.length) return
  Promise.all(
    currentPath.map(m => invoke<QAAtom>('read_qa_atom', { filePath: toFilePath(m.id) }))
  ).then(atoms => setMessages(flattenToMessages(atoms)))
}, [currentPath])
```

`flattenToMessages`：将每个 QAAtom 展开为 `[{role:'user', content: q}, {role:'ai', content: a}]` 数组，顺序拼接，节点间插入 branch-marker 分隔线。

消息气泡：
```css
.bubble--user { align-self: flex-end; background: var(--color-accent); color: #fff; }
.bubble--ai   { align-self: flex-start; background: var(--color-surface); }
```

Streaming 区域：在列表末尾追加 `streamingBubble`，监听 `ai-token` 事件追加文本；`streaming` 状态显示打字光标动画（CSS `@keyframes blink`）。

面包屑：取 `currentPath` 首尾最多 3 项，中间显示 `…`。

发送消息流程：
1. 构造 `messages` 数组（从 `currentPath` 读取历史 + 新用户输入）
2. 生成 `newAtomId`：取末节点 id 的序号部分递增，循环调用 `invoke('exists', { path: toFilePath(candidate) })` 检测文件是否已存在（工作台与无限画布共存期间可能碰撞），直到找到空位再使用；**最多循环 100 次**，超限时抛出错误触发 `streamingState = 'error'`，防止无限等待
3. `invoke('stream_ai', { messages, model: 'gemini-2.5-pro', atomId: newAtomId })`
4. `ai-done` 触发后：`invoke('write_qa_atom', ...)` → `store.appendAtom(...)`

**完成标志**：
- 点击 P2 不同节点，P3 切换对应真实历史（`read_qa_atom` IPC 调用可在 Tauri DevTools 验证）
- 发送消息 → P3 逐字显示流式回复 → 完成后 `07-AI知识库/L1-原始对话/QA` 目录生成新 .md 文件
- AI 请求失败时 P3 显示错误提示 + 重试按钮，`streamingState` 为 `error`

---

### 节点 9：节点详情面板（req-006）

**工作量**：0.5 天

**技术细节**：

P4 订阅 `selectedAtomId`，变化时调用 `read_qa_atom`：
```typescript
const selectedAtomId = useConversationStore(s => s.selectedAtomId)
const [atom, setAtom] = useState<QAAtom | null>(null)

useEffect(() => {
  if (!selectedAtomId) return
  invoke<QAAtom>('read_qa_atom', { filePath: toFilePath(selectedAtomId) })
    .then(setAtom)
}, [selectedAtomId])
```

展示布局（上→下）：
```
节点 ID  ·  时间戳  ·  状态（done）
─────────────────────────
完整问题正文
─────────────────────────
AI 回答全文
─────────────────────────
子节点数量：N 个
```

预留 `p4Mode: 'detail' | 'markdown' | 'editor'` 字段在 layoutSlice，v0.1 固定渲染 `detail` 分支，其余分支不实现但条件判断结构已到位。

P4 折叠时不卸载组件（节点 4 已处理），`atom` state 保留，展开后无 IPC 重复调用。

**完成标志**：
- 点击 P2 节点，P4 展示该节点完整问题和 AI 回答全文
- P4 折叠再展开，Tauri DevTools 无重复 `read_qa_atom` IPC 调用

---

────────────── 实现完成后解锁 ──────────────

## 测试阶段

> 状态：实现阶段 13/13 完成，待 qa-agent 执行验收（CEO 已授权）

### AI 测试（自动运行）

- [ ] `list_qa_atoms(BASE_PATH)` 返回非空数组，每项含 `id`、`prev`（根节点为 `null`）、`summary`、`timestamp`
- [ ] `read_qa_atom(path)` 返回 `QAAtom`，含非空 `question`、`answer`，frontmatter 字段 `status/projects/executor` 齐全
- [ ] `write_qa_atom` 写出后，`read_qa_atom` 读回内容与写入一致（往返序列化验证）
- [ ] `write_qa_atom` 写出文件，`cat` 验证：frontmatter 包含 `status: done`、`projects: ["[[Canvas]]"]`、`executor: Local`
- [ ] `selectAtom` 对 3 层分叉路径（A→B→C）返回有序 `currentPath: [A, B, C]`
- [ ] `selectAtom` 对根节点（`prev: null`）返回长度为 1 的 `currentPath`
- [ ] `streamingState` 转换：`idle` → `streaming`（发送时）→ `idle`（完成）
- [ ] `streamingState` 转换：`streaming` → `cancelled`（用户停止）
- [ ] `streamingState` 转换：`streaming` → `error`（网络失败）
- [ ] `write_event_log` 执行后 `events.jsonl` 行数 +1，新行为合法 JSON
- [ ] `list_qa_atoms` 传入不存在的路径时，Command 返回 `Err`（不 panic），前端收到错误字符串而非崩溃
- [ ] `read_qa_atom` 传入 frontmatter 格式错误的 .md 文件时，Command 返回 `Err`，前端收到错误字符串而非崩溃
- [ ] `list_projects(PROJECTS_PATH)` 返回数组，每项含 `id`、`name`、`atomIds`（camelCase，非 snake_case）；atomIds 为字符串数组
- [ ] NavList 展示项目列表，点击某项目后 `selectedProjectId` 更新，BranchTree 只显示该项目的 atomIds 对应节点
- [ ] TopBar 正常渲染，三个服务状态指示灯显示（sub2api 绿、n8n 绿、API Layer 黄）
- [ ] P1 图标栏折叠按钮点击后 NavList 宽度收为 0，再次点击展开至 200px
- [ ] 应用启动后 `events.jsonl` 新增一行，`event` 字段为 `app_launch`，`payload` 含 `qa_atom_count`（整数，与 atoms 实际数量一致）
- [ ] 发送消息后流式完成，`events.jsonl` 新增一行，`event` 字段为 `streaming_complete`，`payload.duration_ms` 为正整数，`payload.token_count` 为正整数
- [ ] 埋点写入失败（模拟 events.jsonl 不可写）时，主流程（对话发送、消息渲染）不受影响，无异常抛出

### 人工验收（用户确认）

- [ ] 点击 P1 导航图标切换模式，Chrome DevTools Performance 录制确认从点击到高亮完成 < 200ms
- [ ] 启动应用，P2 自动显示真实历史分支树（含现有 QA 原子节点）
- [ ] 点击 P2 节点 → P3 切换到该路径的真实对话历史，P4 同时展示该节点完整内容
- [ ] 在 P3 输入消息发送 → 逐字流式显示 AI 回复 → 完成后 P2 追加新节点，QA 目录生成新文件
- [ ] 流式过程中点击停止 → P3 显示已中止状态，流终止
- [ ] P2 折叠 → 20px 薄条，展开恢复，动画流畅；P4 同理，折叠后展开内容不丢失
- [ ] 窗口拖拽缩小至 1024×768，布局不溢出
- [ ] `pnpm tauri build` 产出 .app，双击可正常启动

---

## 关联信息

| 字段 | 内容 |
|------|------|
| 代码目录 | `01-Vibe项目区/工作台/workbench/`（待创建） |
| 开发启动 | `pnpm tauri dev` |
| 构建命令 | `pnpm tauri build` |
| QA 原子路径 | `/Users/morgan/Desktop/Morgan工作仓库/Morgan工作仓库/07-AI知识库/L1-原始对话/QA` |
| sub2api 端点 | `http://43.135.174.27:8080/v1/messages` |
| 关联产品文档 | [[changelog/v0.1/product]] |
| 关联需求 | req-001 ~ req-009 |

---

---

### 节点 10：全局顶栏 TopBar（req-010，超出 v0.1 scope）

**状态**：已实现（事后补录）

**实现内容**：
- `src/components/TopBar/TopBar.tsx` + `TopBar.css`
- 36px 高全局顶部栏，flex 布局（left / center / right 三区）
- left：侧栏折叠/展开按钮（toggleP1List）
- center：「工作台」标题文字
- right：服务状态指示灯（sub2api / n8n / API Layer，颜色编码 ok/warn/error）
- 状态数据 v0.1 写死（sub2api ok, n8n ok, API Layer warn），v0.2 接真实健康检查端点

**对原规格的影响**：
- `.workspace-root` 变为 flex column：topBar + workspace
- `.workspace` 高度从 100vh 变为 100vh - 36px（flex: 1）

---

### 节点 11：P1 导航列表 NavList + NavIcons（req-011，超出 v0.1 scope）

**状态**：已实现（事后补录）

**实现内容**：
- P1 分裂为两栏：
  - `NavIcons`（52px 固定）：模式切换图标 + 折叠按钮
  - `NavList`（200px 可折叠，`p1ListVisible` 控制）：最近 / 对话 / 项目三个 section
- `p1ListVisible: boolean` 和 `toggleP1List()` 追加到 `layoutSlice`
- NavList 消费 `projects` 列表，点击项目调用 `selectProject(id)` 切换激活项目

**文件**：
- `src/components/NavIcons/NavIcons.tsx` + `NavIcons.css`
- `src/components/NavList/NavList.tsx` + `NavList.css`
- `src/store/layoutSlice.ts`（追加 p1ListVisible / toggleP1List）

---

### 节点 12：项目切换后端命令（req-012，超出 v0.1 scope）

**状态**：已实现（事后补录）；含 bug 修复

**实现内容**：
- `src-tauri/src/commands/projects.rs`：`list_projects(projects_dir)` Rust Command
- 遍历 `07-AI知识库/L1-原始对话/Projects/` 目录，解析每个 .md 文件的 YAML frontmatter + `## 对话索引` 段的 `[[wikilink]]` 提取 atomIds
- `src-tauri/src/models.rs`：新增 `ProjectMeta` 结构体（id / name / rootBranchId / createdAt / atomIds）
- `src/store/conversationSlice.ts`：新增 `projects: ProjectMeta[]`、`selectedProjectId`、`loadProjects()`、`selectProject()`
- BranchTree 按 `selectedProjectId` 过滤 `filteredAtoms`
- `src/utils/paths.ts`：新增 `PROJECTS_PATH` 常量

**字段语义说明**：
- `rootBranchId`：来自项目 .md 文件 frontmatter 的 `rootBranchId` 字段（手工维护的字符串，指向该项目的主干分支 ID）；若 frontmatter 中缺失则默认空字符串，不影响 atomIds 过滤功能（v0.1 仅用 atomIds 过滤）
- `atomIds`：从 `## 对话索引` 节的 `[[wikilink]]` 提取，顺序即文件中的排列顺序

**Bug 修复（2026-05-18）**：
- `ProjectMeta` Rust 结构体缺少 `#[serde(rename_all = "camelCase")]` 导致 `atom_ids` 序列化为 snake_case，前端读到 `undefined` 造成渲染崩溃；修复后前端正常接收 `atomIds`

---

### 节点 13：数据埋点调用（product.md §埋点计划，超出原 v0.1 scope，board 追认）

**状态**：已实现（review-agent 第 3 轮 R-3-1 要求，2026-05-18）

**背景**：`write_event_log` Tauri Command 在节点 2 实现，但前端从未调用；product.md 埋点计划定义了 6 个必须触发的事件。review-agent 将此判定为 🔴 合规缺口。

**实现内容**：

| 事件 | 触发位置 | payload 关键字段 |
|------|---------|----------------|
| `app_launch` | `App.tsx` useEffect，loadAtoms 成功后 | `version: "0.1.0"`, `qa_atom_count` |
| `mode_switch` | `NavIcons.tsx` onClick | `to_mode`, `latency_ms`（performance.now() 差值） |
| `node_selected` | `conversationSlice.ts` selectAtom，set 后读 currentPath | `atom_id`, `depth`（= currentPath.length-1，根节点=0）, `path_length` |
| `panel_toggle` | `layoutSlice.ts` toggleP2 / toggleP4 | `panel_id`, `action: "collapse"\|"expand"` |
| `message_sent` | `ChatView.tsx` handleSend，invoke stream_ai 前 | `path_length`, `model` |
| `streaming_complete` | `ChatView.tsx` ai-done 监听器 | `duration_ms`（Date.now() - streamStartRef），`token_count`（content.length/4 估算） |

**技术要点**：
- 所有埋点 `invoke('write_event_log', ...)` 均以 `.catch(() => {})` 静默处理，不影响主流程
- `streamStartRef = useRef<number>(0)`：在 handleSend 中 `streamStartRef.current = Date.now()`，在 ai-done 中读取差值，跨 closure 传递无需额外 state
- `selectAtom` 改为块函数，`get` 作为 StateCreator 第二参数，`set(produce(...))` 后调用 `get()` 读取最新 currentPath 计算 depth

**文件变更**：`App.tsx`, `NavIcons.tsx`, `conversationSlice.ts`, `layoutSlice.ts`, `ChatView.tsx`

---

## 修订记录

| 稿次 | 日期 | 主要变化 |
|------|------|---------|
| r1 | 2026-05-17 | 初稿 |
| r2 | 2026-05-17 | 补环境变量表；定义 toFilePath 规则；补 write_qa_atom 写入策略说明；补 Cargo.lock 锁定说明；补 AI 测试异常路径 2 条；补人工验收切换 <200ms 项 |
| r3 | 2026-05-17 | 节点 8 newAtomId 生成补碰撞检测逻辑（文件存在时序号继续递增） |
| r4 | 2026-05-17 | 节点 2 capability 补 fs:allow-exists（节点 8 exists() 调用所需） |
| r5 | 2026-05-18 | CEO 补录实际实现偏差（TopBar / NavList / Projects 节点 10-12）；doc_revision 升为 5；补 bug 修复记录 |
| r6 | 2026-05-18 | review-agent 第 1 轮反馈处理：R1 status 改为英文 draft；R2 节点 7 补 StreamState 共享机制；Y1 节点 6 改写为实际实现；Y2 节点 4 补偏差交叉引用；Y3 节点 8 补 100 次熔断说明；Y4 测试清单追加节点 10-12 测试项；Y5 节点 12 补 rootBranchId 字段语义；B1 董事长追认 req-010/011/012 纳入 v0.1，product.md 同步更新 |
| r7 | 2026-05-18 | R3 董事长决策 A2：write_qa_atom 升级为原子写入（tmp → rename），代码已实现 |
| r8 | 2026-05-18 | review-agent 第 2 轮反馈：R-新1 product.md doc_revision+updated 补同步；R-新2 测试阶段状态改为「待 qa-agent 执行」；Y-新1 capability scope 路径从 $DOCUMENT 改为 $HOME/Desktop；Y-新2 节点 6 补节点 12 交叉引用 |
| r9 | 2026-05-18 | review-agent 第 3 轮反馈：R-3-1 添加节点 13 记录 6 个埋点调用实现（frontend-ui agent 实现）；Y-3-1 节点 5 P1 宽度从 48px 改为 52px（NavIcons 实际值）；Y-3-2 目录结构补 stream_state.rs |
| r10 | 2026-05-18 | review-agent 第 4 轮反馈：R-4-1 测试阶段进度改为 13/13；R-4-2 测试清单追加 3 条埋点端到端验证项；Y-4-1 节点 3 selectAtom 代码补 ⚠️ 注记指向节点 13；Y-4-2 product.md §req-003 宽度同步为 52px；Y-4-3 node_selected depth 语义明确（currentPath.length-1，根=0） |
