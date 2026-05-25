---
project: 工作台
version: v0.10
status: draft
doc_revision: 2
created: 2026-05-21
updated: 2026-05-21
author: frontend-ui
tags:
  - 类型/技术文档
  - 主题/技术/工作台
  - 状态/草稿
---

# technical.md · 工作台 v0.10 · NavList 基础交互修复

---

## 版本概述

v0.10 专注于还清三笔「可用性欠债」：① 修复 `handleNewConversation` 的磁盘写入优先策略导致 textarea 永久禁用的问题，改为内存优先策略并补全 `handleSend` 的错误边界；② 在 NavList「项目」section 新增内联创建入口，前端调用 Tauri `create_project` 命令（本版本需新增该后端命令）；③ 修正「对话」section 错误渲染 `projects.map(...)` 的问题，改为渲染当前项目内 `prev === null` 的 root atoms。三个修复均集中在 `NavList.tsx` 和 `ChatView.tsx` 两个前端文件，以及 Tauri Rust 后端的 `projects.rs` 一个文件，无数据模型变更，无跨面板逻辑改动。

---

## 后端命令确认（req-034 关键前置）

### 现状检查结果

经检查 `workbench/src-tauri/src/commands/projects.rs` 和 `workbench/src-tauri/src/lib.rs`：

- `list_projects` 命令：**已存在**，注册于 `invoke_handler`
- `create_project` 命令：**不存在**，`projects.rs` 中仅有 `list_projects`，`lib.rs` 中亦无注册

### 处理方案

req-034 需要在本版本**新增** `create_project` Tauri 命令。工作量属于纯 Rust 文件系统操作，范围明确，预估 0.5 天。

**期望的命令 Signature**：

```rust
// workbench/src-tauri/src/commands/projects.rs
#[tauri::command]
pub fn create_project(
    projects_dir: String,
    name: String,
) -> Result<ProjectMeta, String>
```

**期望行为**：

1. 生成 project id（如 `uuid v4` 或基于时间戳的短 id）
2. 在 `projects_dir` 下创建 `{name}.md` 文件，写入如下 frontmatter：
   ```markdown
   ---
   id: {生成的 id}
   name: {name}
   rootBranchId: ""
   createdAt: {ISO 8601 时间戳}
   ---

   ## 对话索引

   ```
3. 返回 `ProjectMeta { id, name, root_branch_id: "", created_at, atom_ids: [] }`
4. 若同名文件已存在或路径非法，返回可读错误字符串（前端可捕获）

**注册**：需在 `lib.rs` 的 `invoke_handler` 中追加 `projects::create_project`。

---

## 实现节点

### req-033 · 新建对话后发送内容无响应修复

**负责角色**：frontend-ui

#### 技术分析

当前 `NavList.tsx`（第 18–34 行）`handleNewConversation` 采用「磁盘优先」策略：`await invoke('write_qa_atom', ...)` 失败后直接 `return`，导致 `appendAtom` 和 `selectAtom` 不执行，`currentPath` 保持空数组，`ChatView.tsx` 第 377 行 `disabled={streamingState === 'streaming' || !currentPath.length}` 使 textarea 永久禁用。

`ChatView.tsx` 的 `handleSend`（第 224–268 行）对 `generateNewAtomId(parentMeta.id)` 未加 try/catch，若函数抛出（ID 空间耗尽，或 parentId 格式不符合正则），`handleSend` 静默退出，用户无任何反馈。此外，`stream_ai` 调用目前无超时机制，后端无响应时 UI 永久卡在 streaming 状态。

#### 实现节点 Checklist

- [x] T-1 `NavList.tsx`：`handleNewConversation` 改为内存优先策略
- [x] T-2 `NavList.tsx`：磁盘写入失败时展示持久化失败提示（transient 错误提示 state）
- [x] T-3 `ChatView.tsx`：`handleSend` 对 `generateNewAtomId()` 加 try/catch，失败时 `setStreamingState('error')` 并展示用户可读错误
- [x] T-4 `ChatView.tsx`：`stream_ai` 调用添加 30s 超时，超时后 `setStreamingState('error')` 并展示超时提示

#### T-1 详情：`handleNewConversation` 内存优先策略

**文件**：`workbench/src/components/NavList/NavList.tsx`

将现有逻辑从「先磁盘后内存」改为「先内存后磁盘（异步）」：

```diff
- try {
-   await invoke('write_qa_atom', {
-     filePath: toFilePath(rootId),
-     atom: { meta: {...}, question: '', answer: '' },
-   })
- } catch (e) {
-   console.error('[NavList] write_qa_atom failed:', e)
-   return           // ← 这行阻断了后续内存操作
- }
-
- appendAtom({ id: rootId, prev: null, children: [], summary: '新对话', timestamp })
- selectAtom(rootId)
- setMode('chat')

+ // 先更新内存状态（立即解锁 textarea）
+ appendAtom({ id: rootId, prev: null, children: [], summary: '新对话', timestamp })
+ selectAtom(rootId)
+ setMode('chat')
+
+ // 再异步写磁盘（失败不回滚内存，仅展示提示）
+ invoke('write_qa_atom', {
+   filePath: toFilePath(rootId),
+   atom: { meta: { id: rootId, prev: null, children: [], summary: '新对话', timestamp },
+           question: '', answer: '' },
+ }).catch((e) => {
+   console.error('[NavList] write_qa_atom failed:', e)
+   setPersistError('新对话创建成功，但本地持久化失败，重启后可能丢失')
+ })
```

同时在组件顶部新增 state：

```tsx
const [persistError, setPersistError] = useState<string | null>(null)
```

在 JSX 中（`nav-list__new` 按钮下方）渲染临时错误提示：

```tsx
{persistError && (
  <div className="nav-list__error" onClick={() => setPersistError(null)}>
    {persistError}
  </div>
)}
```

#### T-2 详情：持久化失败提示样式

**文件**：`workbench/src/components/NavList/NavList.css`

新增样式类（在文件末尾追加）：

```css
/* v0.10 req-033: 持久化失败提示 */
.nav-list__error {
  font-size: 11px;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fbbf24;
  border-radius: 4px;
  padding: 4px 8px;
  margin: 4px 8px;
  cursor: pointer;
  line-height: 1.4;
}
```

#### T-3 详情：`handleSend` 错误边界

**文件**：`workbench/src/components/ChatView/ChatView.tsx`

在 `handleSend`（第 224 行起）中，将 `generateNewAtomId` 调用改为带 try/catch：

```diff
- const newAtomId = await generateNewAtomId(parentMeta.id)

+ let newAtomId: string
+ try {
+   newAtomId = await generateNewAtomId(parentMeta.id)
+ } catch (e) {
+   setStreamingState('error')
+   // error 状态已有 UI 反馈（"请求失败，请检查网络或 API Key"）
+   // 若需更精确的提示，可扩展为 setErrorMessage(String(e))
+   console.error('[ChatView] generateNewAtomId failed:', e)
+   return
+ }
```

#### T-4 详情：`stream_ai` 30s 超时

**文件**：`workbench/src/components/ChatView/ChatView.tsx`

**背景**：`stream_ai` invoke 在 backend 接受请求后即 resolve（不等待 SSE 事件），实际 streaming 数据通过 `listen('ai-token' / 'ai-done')` 独立传递。因此，对「backend 完全无响应（连接建立失败）」的超时可用 `Promise.race` 处理；但更常见的「invoke 已 resolve 但 SSE 事件永不到来（ai-done 永不触发）」场景，必须在 `ai-done` 监听层增加独立超时计时器来处理。

T-4 需同时实现两层超时：

**第一层：invoke 建立连接超时**（在 `handleSend` 中）：

```diff
- await invoke('stream_ai', {
-   messages: [...historyMessages, { role: 'user', content: input }],
-   model, atomId: newAtomId,
-   ...(systemPrompt ? { system: systemPrompt } : {}),
-   ...(apiKey ? { apiKey } : {}),
-   ...(apiBaseUrl ? { baseUrl: apiBaseUrl } : {}),
- }).catch((e: unknown) => {
-   console.error(e)
-   setStreamingState('error')
- })

+ const STREAM_TIMEOUT_MS = 30_000
+ const timeoutPromise = new Promise<never>((_, reject) =>
+   setTimeout(() => reject(new Error('stream_ai timeout')), STREAM_TIMEOUT_MS)
+ )
+ await Promise.race([
+   invoke('stream_ai', {
+     messages: [...historyMessages, { role: 'user', content: input }],
+     model, atomId: newAtomId,
+     ...(systemPrompt ? { system: systemPrompt } : {}),
+     ...(apiKey ? { apiKey } : {}),
+     ...(apiBaseUrl ? { baseUrl: apiBaseUrl } : {}),
+   }),
+   timeoutPromise,
+ ]).catch((e: unknown) => {
+   console.error('[ChatView] stream_ai error/timeout:', e)
+   setStreamingState('error')
+ })
```

**第二层：SSE 事件超时**（在 `useEffect` 的 `ai-done` 监听层）：

在 `handleSend` 调用 `invoke('stream_ai', ...)` 成功后，启动一个超时计时器，若 30s 内 `ai-done` 未触发则强制退出 streaming 状态。实现方式：在 `handleSend` 中在 invoke resolve 后设置计时器引用（通过 ref），在 `ai-done` / `ai-error` / `ai-cancelled` handler 中清除计时器。

在组件顶部新增 ref：

```tsx
const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

在 `handleSend` 中 invoke resolve 之后（`.catch()` 之外）追加：

```tsx
// 第二层超时：等待 ai-done 事件，30s 未到则强制退出 streaming
if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current)
streamTimeoutRef.current = setTimeout(() => {
  console.warn('[ChatView] ai-done not received within 30s, exiting streaming state')
  setStreamingState('error')
  setStreamingText('')
}, STREAM_TIMEOUT_MS)
```

在 `listen('ai-done', ...)` handler 开头追加清除计时器：

```tsx
if (streamTimeoutRef.current) {
  clearTimeout(streamTimeoutRef.current)
  streamTimeoutRef.current = null
}
```

同理在 `listen('ai-error', ...)` 和 `listen('ai-cancelled', ...)` handler 开头各追加相同的清除逻辑。

---

### req-034 · 新建项目入口（NavList 前端 + create_project 后端）

**负责角色**：frontend-ui（前端）+ 后端命令新增

#### 技术分析

`NavList.tsx` 当前「项目」section（第 76–97 行）只渲染项目列表，无创建入口。`conversationSlice.ts` 有 `loadProjects()` action（第 114–119 行）可复用来刷新列表，但缺少 `createProject` action。

后端 `create_project` 命令不存在（见「后端命令确认」节），需在 `projects.rs` 新增并注册。

#### 实现节点 Checklist

- [x] T-5 `projects.rs`：新增 `create_project` Tauri 命令（Rust）
- [x] T-5b `lib.rs`：注册 `create_project` 命令到 `invoke_handler`（必须与 T-5 同步完成，否则前端 invoke 找不到命令）
- [x] T-6 `conversationSlice.ts`：新增 `createProject(name)` action
- [x] T-7 `NavList.tsx`：「项目」section 标题旁新增「+」按钮，管理内联输入 state
- [x] T-8 `NavList.tsx`：内联输入框交互（Enter 确认 / Esc 取消 / 空名称禁用提交）
- [x] T-9 `NavList.tsx`：创建失败时在输入框旁展示错误提示，输入框保持打开

#### T-5 详情：`create_project` Rust 命令

**文件**：`workbench/src-tauri/src/commands/projects.rs`

在文件末尾追加（注意：需确认 `projects.rs` 顶部已有 `use std::path::Path;` 和 `use std::fs;`；若无，需在函数前补充或在文件顶部导入）：

```rust
#[tauri::command]
pub fn create_project(
    projects_dir: String,
    name: String,
) -> Result<ProjectMeta, String> {
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    if name.trim().is_empty() {
        return Err("项目名称不能为空".to_string());
    }

    let projects_path = Path::new(&projects_dir);
    if !projects_path.exists() {
        fs::create_dir_all(projects_path)
            .map_err(|e| format!("无法创建项目目录: {}", e))?;
    }

    let file_path = projects_path.join(format!("{}.md", name.trim()));
    if file_path.exists() {
        return Err(format!("项目「{}」已存在", name.trim()));
    }

    // 生成 id：时间戳毫秒（简短、不依赖 uuid crate）
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let id = format!("proj-{}", millis);

    // ISO 8601 时间戳
    // 若 Cargo.toml 已有 chrono 依赖，使用下方完整路径调用：
    let created_at = chrono::offset::Utc::now().to_rfc3339();
    // 若 chrono 不存在，替换为简化实现：
    // let created_at = format!("{}", millis);  // 仅作降级兜底

    let content = format!(
        "---\nid: {}\nname: {}\nrootBranchId: \"\"\ncreatedAt: {}\n---\n\n## 对话索引\n\n",
        id, name.trim(), created_at
    );

    fs::write(&file_path, content)
        .map_err(|e| format!("写入项目文件失败: {}", e))?;

    Ok(ProjectMeta {
        id,
        name: name.trim().to_string(),
        root_branch_id: String::new(),
        created_at,
        atom_ids: vec![],
    })
}
```

> **注意**：`chrono` 是否已在 `Cargo.toml` 依赖中需确认；若不存在，可用 `chrono = "0.4"` 添加（无需 serde feature）。`chrono::offset::Utc::now()` 使用完整模块路径，无需 `use chrono::Utc;` 额外导入。

**文件**：`workbench/src-tauri/src/lib.rs`

在 `invoke_handler` 的 `projects::list_projects` 行后追加：

```diff
  projects::list_projects,
+ projects::create_project,
```

#### T-6 详情：`conversationSlice.ts` 新增 `createProject` action

**文件**：`workbench/src/store/conversationSlice.ts`

在 `ConversationSlice` interface 中新增：

```typescript
createProject: (name: string) => Promise<void>
```

在 `createConversationSlice` 实现中新增（`loadProjects` 定义之后）：

```typescript
createProject: async (name) => {
  const newProject = await invoke<ProjectMeta>('create_project', {
    projectsDir: PROJECTS_PATH,
    name,
  })
  // 追加到本地状态并自动选中，避免再次 invoke list_projects（减少 I/O）
  set((state) => ({
    projects: [...state.projects, newProject],
    selectedProjectId: newProject.id,
  }))
},
```

#### T-7/T-8/T-9 详情：NavList 内联输入框

**文件**：`workbench/src/components/NavList/NavList.tsx`

在组件顶部 `useStore` 解构中增加 `createProject`：

```typescript
const {
  projects, selectedProjectId, selectProject,
  appendAtom, selectAtom, setMode,
  createProject,
} = useStore()
```

新增 state（与 `persistError` 同层）：

```typescript
const [showNewProjectInput, setShowNewProjectInput] = useState(false)
const [newProjectName, setNewProjectName] = useState('')
const [newProjectError, setNewProjectError] = useState<string | null>(null)
const [newProjectLoading, setNewProjectLoading] = useState(false)
```

新增 `handleNewProject` handler：

```typescript
const handleNewProject = async () => {
  const trimmed = newProjectName.trim()
  if (!trimmed) return
  setNewProjectLoading(true)
  setNewProjectError(null)
  try {
    await createProject(trimmed)
    setShowNewProjectInput(false)
    setNewProjectName('')
  } catch (e) {
    setNewProjectError(String(e))
  } finally {
    setNewProjectLoading(false)
  }
}
```

「项目」section 标题区改为：

```tsx
<section className="nav-list__section">
  <div className="nav-list__section-header">
    <h3 className="nav-list__heading">项目</h3>
    <button
      className="nav-list__section-add"
      onClick={() => {
        setShowNewProjectInput(true)
        setNewProjectError(null)
        setNewProjectName('')
      }}
      title="新建项目"
    >
      +
    </button>
  </div>

  {showNewProjectInput && (
    <div className="nav-list__inline-input">
      <input
        autoFocus
        className="nav-list__inline-field"
        value={newProjectName}
        onChange={(e) => setNewProjectName(e.target.value)}
        placeholder="项目名称"
        disabled={newProjectLoading}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleNewProject()
          if (e.key === 'Escape') {
            setShowNewProjectInput(false)
            setNewProjectName('')
            setNewProjectError(null)
          }
        }}
      />
      {newProjectError && (
        <div className="nav-list__error">{newProjectError}</div>
      )}
    </div>
  )}

  {/* 项目列表（原有渲染逻辑保持不变）*/}
  ...
</section>
```

**文件**：`workbench/src/components/NavList/NavList.css`

新增样式（在 `nav-list__error` 之后追加）：

```css
/* v0.10 req-034: 项目 section header 与内联输入 */
.nav-list__section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
}

.nav-list__section-add {
  font-size: 14px;
  color: var(--color-muted, #6b7280);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  line-height: 1;
}

.nav-list__section-add:hover {
  color: var(--accent, #2563eb);
  background: rgba(37, 99, 235, 0.08);
}

.nav-list__inline-input {
  padding: 4px 8px;
}

.nav-list__inline-field {
  width: 100%;
  font-size: 12px;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 4px;
  padding: 4px 6px;
  outline: none;
  box-sizing: border-box;
}

.nav-list__inline-field:focus {
  border-color: var(--accent, #2563eb);
}
```

---

### req-035 · NavList 对话与项目数据分离展示

**负责角色**：frontend-ui

#### 技术分析

当前 `NavList.tsx` 第 52–73 行（「对话」section）和第 76–97 行（「项目」section）均调用 `projects.map(...)`，数据来源完全相同，用户看到两列重复内容。

`conversationSlice.ts` 中 `atoms: Record<string, QAAtomMeta>` 已存在（第 39 行），`QAAtomMeta.prev` 为 `string | null`；`prev === null` 的 atom 即为对话树根节点（链起点）。`NavList` 当前只从 `useStore` 解构了 `projects`，未订阅 `atoms`。

#### 实现节点 Checklist

- [x] T-10 `NavList.tsx`：从 `useStore` 订阅 `atoms`，派生 `rootAtoms` 列表
- [x] T-11 `NavList.tsx`：「对话」section 改为渲染 `rootAtoms`，点击调用 `selectAtom + setMode('chat')`
- [x] T-12 `NavList.tsx`：对话标题截断逻辑（`question` 前 30 字，空时显示「新对话」）
- [x] T-13 `NavList.tsx`：「项目」section 保持渲染 `projects`，无数据模型变更

#### T-10 详情：订阅 atoms 并派生 rootAtoms

**文件**：`workbench/src/components/NavList/NavList.tsx`

product.md 需求描述为「当前项目内 prev === null 的根节点」，因此 `rootAtoms` 必须按 `selectedProjectId` 做项目级过滤，不能展示所有项目的 root atoms（多项目场景下会混淆）。

当前 `QAAtomMeta` 结构中没有 `projectId` 字段，但 `conversationSlice.ts` 中 `ProjectMeta.atomIds: string[]` 记录了每个项目包含的 atom id 列表。过滤逻辑需结合 `selectedProjectId` → `projects.find(...)` → `atomIds` 做二次过滤：

在 `useStore` 解构中增加 `atoms`（通过 selector 避免整个 store 引用变化触发无谓重渲染）：

```typescript
// 在已有解构之外单独订阅 atoms
const atoms = useStore((s) => s.atoms)
```

在组件函数体内派生 `rootAtoms`（按 timestamp 倒序，仅展示当前项目的 root atoms）：

```typescript
// 找到当前选中项目，取其 atomIds
const selectedProject = projects.find((p) => p.id === selectedProjectId)
const projectAtomIds = new Set(selectedProject?.atomIds ?? [])

// 在当前项目的 atoms 中筛选 prev === null 的根节点
const rootAtoms = Object.values(atoms)
  .filter((a) => a.prev === null && projectAtomIds.has(a.id))
  .sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
```

> **注意**：若 `ProjectMeta.atomIds` 未能及时同步（例如新建对话后 `appendAtom` 更新了 `atoms` 但 `project.atomIds` 未更新），`rootAtoms` 可能遗漏新建的对话。实现时需确认 `appendAtom` 同步更新对应 project 的 `atomIds`，或在 `handleNewConversation` 中同时调用 `loadProjects()` 刷新 project 数据。这一一致性问题应在 TC-035-01/02 测试时验证。

#### T-11/T-12 详情：「对话」section 渲染 rootAtoms

**文件**：`workbench/src/components/NavList/NavList.tsx`

将「对话」section（第 52–73 行）改为：

```tsx
<section className="nav-list__section">
  <h3 className="nav-list__heading">对话</h3>
  {rootAtoms.length === 0 ? (
    <p className="nav-list__empty">暂无对话</p>
  ) : (
    <ul className="nav-list__items">
      {rootAtoms.map((atom) => {
        const title = atom.question
          ? atom.question.slice(0, 30) + (atom.question.length > 30 ? '…' : '')
          : '新对话'
        return (
          <li key={atom.id}>
            <button
              className={`nav-list__item${
                selectedAtomId === atom.id ? ' nav-list__item--active' : ''
              }`}
              onClick={() => {
                selectAtom(atom.id)
                setMode('chat')
              }}
              title={atom.question || '新对话'}
            >
              <span className={`nav-list__pip${
                selectedAtomId === atom.id ? ' nav-list__pip--active' : ''
              }`} />
              <span className="nav-list__item-name">{title}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )}
</section>
```

同时在 `useStore` 解构中增加 `selectedAtomId`（当前实现未解构此字段，需补充）：

```diff
- const { projects, selectedProjectId, selectProject, appendAtom, selectAtom, setMode, createProject } = useStore()
+ const { projects, selectedProjectId, selectProject, appendAtom, selectAtom, setMode, createProject, selectedAtomId } = useStore()
```

#### T-13 注意事项

「项目」section 的 `projects.map(...)` 渲染逻辑（第 76–97 行）**保持不变**，只需删除或留空「最近」section（当前硬编码「暂无最近对话」，不阻塞本版本），数据模型零变更。

---

## 测试清单

### req-033 测试用例

| 编号 | 测试项 | 操作 | 期望结果 |
|------|--------|------|---------|
| TC-033-01 | 正常路径：新建对话后立即可输入 | 点击「+ 新建对话」按钮 | textarea 立即变为可用状态（`disabled=false`），无需等待磁盘写入 |
| TC-033-02 | 降级路径：磁盘写入失败不阻塞 | 模拟 `write_qa_atom` 失败（可临时在 Rust 侧强制返回 Err），然后点击「新建对话」 | 对话在内存中正常创建，textarea 可用，NavList 顶部出现黄色持久化失败提示 |
| TC-033-03 | handleSend 错误边界 | 在浏览器 devtools 中执行 `window.__zustand_store.setState({ atoms: { 'bad-id': { id: 'bad-id', prev: null, children: [], summary: '', timestamp: new Date().toISOString() } }, selectedAtomId: 'bad-id', currentPath: [{ id: 'bad-id', prev: null, children: [], summary: '', timestamp: new Date().toISOString() }] })`，然后点击发送 | 页面出现错误提示（`streamingState === 'error'`），不静默失败，输入框不卡死 |
| TC-033-04 | streaming 超时退出 | 模拟后端无响应（停止 stream_ai 的 SSE 事件发送），等待 30s | 30s 后 streaming 状态自动退出，错误提示出现，textarea 恢复可用 |
| TC-033-05 | 正常发送流程回归 | 新建对话，输入消息，按 Enter 或点发送 | 消息正常发送，AI 回复正常 streaming，流程完整无中断 |

### req-034 测试用例

| 编号 | 测试项 | 操作 | 期望结果 |
|------|--------|------|---------|
| TC-034-01 | 创建入口可见 | 打开 NavList，查看「项目」section 标题行 | 标题旁有「+」按钮，视觉与现有 UI 一致 |
| TC-034-02 | 内联输入框展开与取消 | 点击「+」，然后按 Esc | 点击后内联输入框展开；Esc 后收起，不创建项目 |
| TC-034-03 | 正常创建项目 | 输入项目名「测试项目」，按 Enter | 新项目出现在列表中，自动高亮选中，`projects_dir` 目录下生成对应 `.md` 文件 |
| TC-034-04 | 重名项目失败提示 | 创建与已有项目同名的项目 | 内联输入框不关闭，下方显示红色错误提示，用户可修改名称重试 |
| TC-034-05 | 空名称无法提交 | 内联输入框内容为空或纯空格，按 Enter | 不执行创建，输入框保持展开（`handleNewProject` 开头 trim 检查） |
| TC-034-06 | 创建的 .md 文件格式正确 | 创建项目「测试项目」后，用文本编辑器打开 `projects_dir/测试项目.md` | 文件包含合法 frontmatter（`id: proj-xxx`、`name: 测试项目`、`rootBranchId: ""`、`createdAt: ISO8601 字符串`），并有 `## 对话索引` 章节 |

### req-035 测试用例

| 编号 | 测试项 | 操作 | 期望结果 |
|------|--------|------|---------|
| TC-035-01 | 对话与项目不重复 | 打开 NavList，同时有 ≥1 个项目和 ≥1 条对话 | 「对话」section 与「项目」section 显示不同条目，无重复 |
| TC-035-02 | 对话 section 正确筛选 | 检查「对话」section 列表 | 仅展示 `prev === null` 的 root atoms，分支节点（`prev !== null`）不出现 |
| TC-035-03 | 点击对话联动 | 点击「对话」section 中某条对话 | `selectAtom` 调用，P2 分支树和 P3 聊天视图切换至该对话链 |
| TC-035-04 | 空 question 占位 | 新建对话（question 为空），查看「对话」section | 该条目显示「新对话」文字，不崩溃，不显示空白 |
| TC-035-05 | 标题截断 | 存在 question 超过 30 字符的对话 | 列表显示前 30 字 + 省略号，不换行溢出 |
| TC-035-06 | 多项目场景隔离 | 创建两个项目 A 和 B，分别在各自项目下新建对话，切换到项目 A | 「对话」section 只展示项目 A 的对话，项目 B 的对话不出现 |

---

## 风险与注意事项

### 风险 1：`create_project` 后端命令新增

**风险**：`create_project` 需要在 Rust 层新建文件系统操作，项目目录权限、同名文件检查、`chrono` 依赖是否已有均需确认。

**缓解**：T-5 实现时首先检查 `Cargo.toml` 是否包含 `chrono`；若无，追加 `chrono = { version = "0.4", features = ["serde"] }`。同名文件使用 `Path::exists()` 提前检查并返回明确错误，不依赖 OS 错误信息。

### 风险 2：`atoms` 订阅性能

**风险**：`NavList` 新增 `useStore((s) => s.atoms)` 订阅后，每次任意 atom 变化（streaming 过程中频繁追加 token）都会触发 NavList 重渲染，可能在 streaming 时造成卡顿。

**缓解**：使用细粒度 selector 仅订阅 `atoms`（而非整个 store），结合 Zustand 的引用相等检查，仅当 `atoms` 对象本身引用改变时才触发重渲染。streaming 过程中 `atoms` 仅在 `ai-done` 事件后通过 `appendAtom` 更新，不会在 token 级别变化，风险实际较低，但需在测试 TC-033-05 中验证 streaming 时 NavList 无异常 re-render。

### 注意事项：req-033 T-4 两层超时机制

`stream_ai` invoke 在 backend 接受请求后即 resolve（不等待 SSE 事件），实际 streaming 数据通过 Tauri 事件系统（`listen('ai-token', ...)` / `listen('ai-done', ...)`）独立传递。因此需要两层超时：

- **第一层（invoke 层）**：`Promise.race([invoke(...), timeoutPromise])` 处理 backend 完全无响应（连接建立失败）的场景，invoke reject 后进入 `.catch` 中的 `setStreamingState('error')`。
- **第二层（SSE 层）**：`streamTimeoutRef` 在 invoke resolve 后启动，处理「invoke 已返回但 ai-done 事件永不到来」的场景（backend 接受了请求但 SSE 流永久挂起）。ai-done / ai-error / ai-cancelled 任意一个触发后清除计时器。

两层超时共同覆盖 TC-033-04 的验收场景。若 `stream_ai` invoke 在极端情况下先 resolve 再 reject（Tauri IPC 边界情况），`Promise.race` 的 reject 不会遮盖正常路径——因为 streaming 数据的写入由 `ai-done` 事件独立完成，与 invoke 返回值无关。

---

## 修订记录

| 版本 | 日期 | 修改内容 |
|------|------|---------|
| doc_revision 1 | 2026-05-21 | 初稿，frontend-ui 基于 v0.10 product.md 及代码分析创建 |
| doc_revision 2 | 2026-05-21 | workbench-review 修复：① T-4 改为两层超时机制（invoke 层 + SSE 事件层），修复「invoke 已返回但 ai-done 永不触发」场景下超时无效的问题，TC-033-04 可正确验收；② T-5 代码属性宏由 `#[command]` 改为 `#[tauri::command]`，补充 `use std::fs; use std::path::Path;`，`chrono` 改为完整路径 `chrono::offset::Utc::now()` 避免 use 缺失；③ `lib.rs` 注册节点标注为 T-5b 并说明必须与 T-5 同步完成；④ T-10 rootAtoms 派生逻辑补充按 selectedProjectId 过滤（通过 project.atomIds），修复多项目场景下对话混显问题，并补充 atomIds 一致性注意事项；⑤ TC-033-03 测试操作补充具体 devtools 注入方式；⑥ TC-034 新增 TC-034-06 验证创建文件 frontmatter 格式；⑦ TC-035 新增 TC-035-06 验证多项目场景隔离；⑧ 风险/注意事项中 T-4 超时语义说明更新为两层机制 |
