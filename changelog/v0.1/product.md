---
project: 工作台
version: v0.1
status: draft
doc_revision: 8
created: 2026-05-17
updated: 2026-05-18
author: workbench-product
---

# product.md · 工作台 v0.1

---

## 版本背景与目标

### 版本方向

**v0.1 的目标是让「看」和「选」两个核心动作在真实数据上运转。**

工作台是三个已有项目（无限画布交互 / 控制平面 / 执行层调度器）的统一前端入口，不重新发明 AI 能力，而是把现有能力重新组织进一个四面板桌面应用。v0.1 专注对话模式：用户能在 Panel 2 看到真实对话树，点击节点后 Panel 3 切换到对应路径的真实对话历史，并且能发起新的对话请求获得真实 AI 回复。

### 选取理由

- 无限画布交互 v1.4.0 的对话能力（WebSocket streaming、QA 原子持久化、分叉树）已经稳定，工作台直接复用，不重建
- QA 原子是 Obsidian 知识库的一部分，本地 .md 文件是真相源，通过 Tauri Commands 读写，不经服务器中转
- AI streaming 走远程服务器（sub2api），Tauri 前端作为纯消费端

### 版本边界

**本版本做**：
- Tauri 应用骨架（macOS 原生窗口）
- 四面板布局（P1/P2/P3/P4，P2/P4 可折叠）
- 对话模式完整闭环：看真实树 → 选节点 → 看真实历史 → 发送消息 → 收到真实 AI 回复 → 本地持久化
- Tauri Commands：读写 QA 原子 .md 文件、搜索 Obsidian vault
- SSE AI 客户端（Tauri HTTP Plugin）：连接 sub2api 获取流式回复
- P4 节点详情（只读，展示 QA 原子内容）
- Zustand 状态管理层

**本版本不做**：
- 工具管理模式（v0.2，接控制平面 API）
- 控制台模式（v0.3）
- 多工作区 Tab（v0.3）
- AI 工具调用（search_vault 等工具先注册 Tauri Command，AI 调用能力留 v0.2）
- P4 编辑模式（v0.2+）
- 对话分叉操作（P2 只读，v0.2 加交互）
- 跨工作区拖拽（v0.3+）

---

## 版本需求范围

| ID | 需求 | 优先级 | 说明 |
|----|------|--------|------|
| [req-001](../../requirements/req-001-tauri-app-skeleton.md) | Tauri 应用骨架 | high | 技术基础 |
| [req-002](../../requirements/req-002-four-panel-layout.md) | 四面板布局与折叠 | high | P2/P4 折叠交互 |
| [req-003](../../requirements/req-003-navigation-mode-switch.md) | 模式切换导航（P1） | high | 「切」动作基础 |
| [req-004](../../requirements/req-004-conversation-branch-tree.md) | 对话分支树（P2）| high | 读真实 QA 原子树 |
| [req-005](../../requirements/req-005-linear-conversation-view.md) | 线性对话视图（P3）| high | 真实对话 + AI streaming |
| [req-006](../../requirements/req-006-node-detail-panel.md) | 节点详情面板（P4 只读）| medium | 展示真实 QA 原子内容 |
| [req-007](../../requirements/req-007-zustand-state-management.md) | Zustand 状态管理层 | high | 面板通信总线 |
| [req-008](../../requirements/req-008-tauri-file-commands.md) | Tauri 本地文件命令 | high | QA 原子读写 + vault 搜索 |
| [req-009](../../requirements/req-009-websocket-ai-client.md) | AI 流式对话客户端（SSE） | high | sub2api SSE，Tauri HTTP Plugin 处理 |
| [req-010](../../requirements/req-010-topbar-global-header.md) | 全局顶栏 TopBar | medium | 36px 顶栏，侧栏折叠 + 服务状态灯；实现先于文档，董事长 2026-05-18 追认 |
| [req-011](../../requirements/req-011-p1-navlist-panel.md) | P1 导航列表 NavList | medium | P1 图标栏 + 可折叠列表栏，项目切换入口；实现先于文档，董事长 2026-05-18 追认 |
| [req-012](../../requirements/req-012-list-projects-command.md) | 项目加载命令 list_projects | medium | 扫描 Projects/ 目录，P2 按项目过滤；实现先于文档，董事长 2026-05-18 追认 |

---

## 需求冲突与衍生

### 冲突

- **req-008 与 req-009 的时序依赖**：req-009 的 `done` 事件触发 req-008 的 `write_qa_atom`，两者实现时需协调接口——裁决：req-008 先完成，req-009 开发时复用已有 Command。
- 其余需求无阻断性冲突。

### 衍生需求（处置）

1. **对话目录配置**：用户需要能设置 QA 原子存储目录（指向 Obsidian vault 内的某个子目录）。v0.1 硬编码默认路径 `07-AI知识库/L1-原始对话/QA`（与无限画布共享同一目录），设置界面留 v0.2。**补入 backlog。**

2. **分叉操作（从某节点新开分支）**：P2 分支树 v0.1 只读，无分叉按钮。分叉交互留 v0.2 规划。**补入 backlog。**

3. **Panel 宽度拖拽**：固定宽度 + 折叠足够验证，用户反馈后决定。**补入 backlog。**

---

## 功能设计

### req-001 · Tauri 应用骨架

Tauri v2 + React 18 + TypeScript 5 + Vite。窗口：1440×900 初始，最小 1024×768，标题「工作台」。

CSS Variables 设计 token（`src/styles/tokens.css`）：

```css
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
```

**与其他功能的接口**：提供 CSS Variables；注册 Tauri Commands；配置 Zustand store providers。

---

### req-002 · 四面板布局与折叠

面板宽度配置对象（不硬编码 CSS）：

```typescript
const DEFAULT_LAYOUT = {
  p1: { width: 48,  visible: true, collapsible: false },
  p2: { width: 260, visible: true, collapsible: true  },
  p3: { flex: 1,   visible: true, collapsible: false },
  p4: { width: 320, visible: true, collapsible: true  },
}
```

P2/P4 折叠后缩为 20px 薄条，薄条内显示展开指示器（`›`），点击展开。过渡：`transition: width var(--duration-normal) var(--ease-panel)`。

**提供给子模块的挂载点**：`<div id="p2-mount">`（给分支树）/ `<div id="p4-mount">`（给详情面板）/ P2 宽度变化事件（via Zustand）。

---

### req-003 · 模式切换导航（P1）

P1 图标栏（NavIcons）固定 52px，三个模式图标 + 折叠按钮垂直排列；实际实现增加了 200px 可折叠 NavList（见 req-011）：

| 模式 | v0.1 状态 | 说明 |
|------|-----------|------|
| 对话 | ✅ 激活 | 完整功能 |
| 工具 | ⬜ 禁用 | 接控制平面 API，v0.2 |
| 控制台 | ⬜ 禁用 | 执行层调度器，v0.3 |

禁用态图标降低 opacity，hover 显示「即将支持」tooltip。模式切换通过 Zustand `currentMode` 字段，<200ms 完成（纯状态更新，无网络请求）。

---

### req-004 · 对话分支树（P2）

**数据来源**：`list_qa_atoms(conversationDir)` Tauri Command，读取本地 QA 原子目录，返回所有节点元数据。

**数据模型（对齐无限画布 QA 原子格式）**：

```typescript
interface QAAtomMeta {
  id: string          // "0001-001"，文件名（不含 .md）
  prev: string | null // "[[0001-001]]" Obsidian wikilink；根节点为 null
  children: string[]  // ["[[0001-002]]", "[[0001-01-001]]"]
  summary: string     // question 前 50 字（渲染用）
  timestamp: string
}
```

**树渲染**：SVG，Reingold-Tilford 布局算法，节点 140×60px，层间距 100px，cubic-bezier 连线。点击节点 → `store.selectAtom(id)` → P3/P4 响应。

**初始化**：应用启动时自动调用 `list_qa_atoms(BASE_PATH)`，全量加载 `07-AI知识库/L1-原始对话/QA` 下所有 QA 原子，无项目过滤——目标是逐步替代无限画布成为唯一交互入口。新消息完成持久化后，追加节点到树（不重新全量加载）。

**ID 冲突风险**：工作台与无限画布在 v0.1 共存期间同时读写同一目录。工作台写入的新原子沿用现有 branchId 前缀体系，不另建前缀；如检测到同 id 文件已存在则序号递增，后续 v0.2 的分叉操作再统一评估冲突策略。

---

### req-005 · 线性对话视图（P3）

**读取历史**：`selectAtom(id)` 触发后，Zustand 计算从根到该节点的路径，再逐个调用 `read_qa_atom` 读取完整 question/answer，渲染为线性对话列表。

**发送消息流程**：
```
用户输入 → P3 发送 → req-009 SSE 客户端（Tauri HTTP Plugin）
  → sub2api streaming → token 逐字渲染
  → done 事件 → req-008 write_qa_atom 写本地
  → P2 树追加新节点
```

**UI 细节**：用户消息气泡（右，accent 背景）/ AI 消息（左，surface 背景）/ 流式状态显示打字动画 / 切换节点后自动滚底。

顶部面包屑：`根节点摘要 › ... › 当前节点摘要`（最多 3 级，多余折叠）。

---

### req-006 · 节点详情面板（P4 只读）

响应 `selectAtom(id)`，调用 `read_qa_atom` 读取完整内容展示：

```
┌────────────────────────┐
│ 节点 ID  时间戳  状态   │
├────────────────────────┤
│ 完整问题               │
├────────────────────────┤
│ AI 回答（全文）         │
├────────────────────────┤
│ 子节点数量 / 分支情况   │
└────────────────────────┘
```

P4 折叠时内容不销毁（展开后恢复）。预留 `p4Mode: 'detail' | 'markdown' | 'editor'` store 字段，v0.1 固定 `detail`。

---

### req-007 · Zustand 状态管理层

```typescript
// layoutSlice
{
  p2Visible: boolean
  p4Visible: boolean
  currentMode: 'chat' | 'tools' | 'console'
}

// conversationSlice
{
  atoms: Record<string, QAAtomMeta>   // 全量节点元数据（from list_qa_atoms）
  selectedAtomId: string | null
  currentPath: QAAtomMeta[]           // 根→selected 路径（派生计算）
  streamingState: 'idle' | 'streaming' | 'cancelled' | 'error'

  // actions
  loadAtoms: () => Promise<void>       // 调用 list_qa_atoms，初始化 atoms
  selectAtom: (id: string) => void     // 更新 selectedAtomId + 重算 currentPath
  appendAtom: (atom: QAAtomMeta) => void  // streaming done 后追加新节点
}
```

所有 Panel 只读写 store，禁止组件间直接 prop 传递跨面板状态。

---

### req-008 · Tauri 本地文件命令

五个 Rust Command，capability 声明最小权限（只允许访问配置的对话目录和 vault 目录）：

| Command | 作用 |
|---------|------|
| `list_qa_atoms(dir)` | 读取目录，解析所有 QA 原子 frontmatter，返回元数据列表 |
| `read_qa_atom(path)` | 读取单个文件，返回完整 QA 原子（含 question/answer） |
| `write_qa_atom(path, atom)` | 写入新 QA 原子文件，格式对齐无限画布格式 |
| `search_vault(vault, keyword)` | 全文搜索 vault 目录下 .md 文件，返回匹配文件列表 |
| `write_event_log(event)` | 追加埋点事件到 `~/Library/Logs/Workbench/events.jsonl` |

v0.1 目录路径硬编码默认值（`BASE_PATH = 07-AI知识库/L1-原始对话/QA`，与无限画布共享同一目录），设置界面 v0.2 再建。

---

### req-009 · AI 流式对话客户端

**已验证**：`43.135.174.27:8080/v1/messages` 支持 Anthropic SSE 格式流式，`content_block_delta` 事件逐 token 推送。

实现方式：Tauri Command（`stream_ai`）在 Rust 层发起 HTTP 请求并读 SSE 流，每个 token 通过 Tauri Event（`ai-token`）推送给前端，不经过 WebSocket。

流程：`message_stop` → 写本地 QA 原子（`write_qa_atom`）→ 通知 P2 追加节点（`ai-atom-saved`）。

用户停止：Rust 中止 HTTP 请求，不需要向服务端发取消信令。

---

## 架构方向

### 整体分层

```
Tauri 前端（React）
    ├── Tauri Commands（Rust）── 本地文件系统
    │       QA 原子读写 / Obsidian vault 搜索
    │
    └── Tauri HTTP Plugin ─── 远程服务器（43.135.174.27）
            POST /v1/messages，stream: true
            SSE → Anthropic content_block_delta
            sub2api → Gemini 2.5 Pro（已验证）
            [v0.2] 控制平面 API
            [v0.3] 执行层调度器
```

### 实现顺序

```
req-001（Tauri 骨架）
  └── req-008（Tauri Commands，地基）
        └── req-007（Zustand store）
              ├── req-002（四面板布局）
              │     └── req-003（P1 导航）
              ├── req-004（P2 树，先用 read_qa_atoms 展示历史）
              ├── req-009（SSE 客户端，Tauri HTTP Plugin）
              │     └── req-005（P3，历史 + streaming）
              └── req-006（P4 只读详情）
```

### 长期一致性

对照 `产品方向.md` 架构原则：

| 原则 | v0.1 实现 | 对齐 |
|------|-----------|------|
| Panel 只通过选中状态事件通信 | 跨 Panel 状态走 Zustand store | ✅ |
| 路径计算在状态层，P3 只渲染 | `currentPath` 在 conversationSlice 派生 | ✅ |
| 内容单元可序列化 | QAAtomMeta 纯数据结构 | ✅ |
| Panel 配置不硬编码 | DEFAULT_LAYOUT 配置对象 | ✅ |
| Obsidian 调本地，服务器逻辑调服务器 | Tauri Commands vs Tauri HTTP Plugin SSE | ✅ |
| 配置内核不变（agent-registry YAML）| 控制平面 API v0.2 再接，v0.1 不触碰 | ✅ |

---

## 版本验收标准

### 核心动作验收

- [ ] **切**：点击 P1 对话模式图标，<200ms 高亮切换
- [ ] **看**：P2 树和 P3 对话同时可见，一屏展示结构和内容
- [ ] **选**：点击 P2 任意节点 → P3 切换到对应路径的真实对话历史（从本地 QA 原子文件读取）

### 真实数据验收

- [ ] 启动应用后 P2 自动加载本地 QA 原子目录，树结构正确反映历史分叉
- [ ] 发送消息 → 服务器返回真实 AI 流式回复 → P3 逐字显示
- [ ] 对话完成后本地生成新 QA 原子 .md 文件，格式符合无限画布规范
- [ ] 新节点追加到 P2 树（无需重新加载全部）

### P4 验收

- [ ] 点击 P2 任意节点 → P4 调用 `read_qa_atom` 展示该节点完整 QA 原子内容（节点 ID / 时间戳 / 完整问题 / AI 回答全文 / 子节点数量）
- [ ] P4 折叠后展开，内容不重新加载

### 布局验收

- [ ] P2 折叠 → 20px 薄条，展开恢复，过渡动画 250ms 内完成（cubic-bezier(0.4,0,0.2,1)）
- [ ] P4 折叠 → 20px 薄条，P4 内容不丢失
- [ ] 窗口缩小至 1024×768 时布局不溢出

### 技术验收

- [ ] `tsc --noEmit` 无报错
- [ ] AI 请求失败时 P3 显示错误 + 重试按钮
- [ ] Tauri Commands 的 capability 权限最小化（不申请全盘读写）
- [ ] `pnpm tauri build` 产出可运行 .app

---

## 数据埋点计划

埋点事件写入本地 `~/Library/Logs/Workbench/events.jsonl`（via Tauri Command），不上报外部服务。

| 事件名 | 触发时机 | 携带字段 | 衡量目标 |
|--------|---------|---------|---------|
| `app_launch` | 应用启动 | `version`, `qa_atom_count` | 确认本地数据加载正常 |
| `mode_switch` | P1 模式切换 | `to_mode`, `latency_ms` | 验证「切」<200ms |
| `node_selected` | P2 节点点击 | `atom_id`, `depth`, `path_length` | 了解用户在树的哪个深度探索 |
| `panel_toggle` | P2/P4 折叠/展开 | `panel_id`, `action` | 了解折叠使用频率 |
| `message_sent` | P3 发送消息 | `path_length`, `model` | 了解用户在哪个深度继续对话 |
| `streaming_complete` | AI 回复完成 | `duration_ms`, `token_count` | AI 响应速度基准 |

---

## Out-of-scope 说明

| 功能 | 原因 | 计划版本 |
|------|------|---------|
| 工具管理模式 | 接控制平面 API，独立规划 | v0.2 |
| 控制台模式 | 执行层调度器尚未实现 | v0.3 |
| 多工作区 Tab | 先验证单工作区体验 | v0.3 |
| AI 工具调用（search_vault 等）| Tauri Command 先建，AI 调用能力 v0.2 | v0.2 |
| P4 编辑模式 | 从只读起步渐进演化 | v0.2 |
| 对话分叉操作 | P2 先只读，交互设计 v0.2 决策 | v0.2 |
| 对话目录配置 UI | 先硬编码默认路径 | v0.2 |
| 跨工作区拖拽 | 多工作区前置 | v0.3+ |
