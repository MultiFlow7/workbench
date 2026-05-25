---
project: 工作台
version: v0.12
status: draft
doc_revision: 4
created: 2026-05-23
---

# 技术执行文档 · v0.12 · 输入体验 + Caching + 触摸板

关联产品规划：[changelog/v0.12/product.md](product.md)
关联需求：[req-044](../../requirements/req-044-p4-text-input-expansion.md) · [req-045](../../requirements/req-045-prompt-caching.md) · [req-046](../../requirements/req-046-trackpad-gesture-fix.md)

---

## 实现阶段

### 节点依赖关系

三个需求完全正交，可并行实现：

```
节点1（req-046 触摸板手势修正）          ← 独立，无依赖
节点2（req-045 cachingEnabled 状态）     ← 独立，无依赖
  └─ 节点3（req-045 Caching UI 开关）   ← 依赖节点2
  └─ 节点4（req-045 invoke 参数接入）   ← 依赖节点2 + 节点3（节点3 在 ChatView 顶部声明了 cachingEnabled selector）
节点5（req-044 layoutSlice p4Mode）      ← 独立，无依赖
  └─ 节点6（req-044 P4 text-input 面板）← 依赖节点5（直接从 store 读 expandedInput，不依赖 ChatView）
  └─ 节点7（req-044 P3 展开按钮 + 同步）← 依赖节点5
```

---

- [ ] **节点1：req-046 触摸板手势修正**

  修改 `BranchTree.tsx` 中 `onWheel` 回调，区分 pinch（缩放）和双指滑动（平移）。

  **当前实现**（`BranchTree.tsx:162`）：`onWheel` 仅用 `deltaY` 做缩放，无平移逻辑。

  **关键问题：passive listener**

  React 17+ 将合成事件的 wheel listener 注册为 passive，导致 `e.preventDefault()` 在合成事件中无效——Tauri WebView 会触发系统层级缩放。必须用原生 DOM listener 覆盖：

  ```typescript
  // BranchTree.tsx 组件内新增
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => { e.preventDefault() }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])
  ```

  `BranchTree.tsx:136` 确认 `setTransform` 来自 `const [transform, setTransform] = useState(...)` —— `useState` setter 为稳定引用，`useCallback` deps 空数组正确。

  **BranchTree.tsx:200 JSX 修改**（在已有属性中新增 `ref={containerRef}`）：

  ```tsx
  // 修改前（第200行）：
  <div ... onWheel={onWheel} ...>

  // 修改后：
  <div ... ref={containerRef} onWheel={onWheel} ...>
  ```

  **修改后 `onWheel`**（React 合成事件，仍保留用于逻辑处理）：

  ```typescript
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey) {
      // macOS pinch → 缩放（系统将捏合映射为 ctrlKey=true 的 wheel 事件）
      setTransform((prev) => {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const delta = e.deltaY < 0 ? 1.1 : 0.9
        const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, prev.scale * delta))
        return {
          x: mx - (mx - prev.x) * (newScale / prev.scale),
          y: my - (my - prev.y) * (newScale / prev.scale),
          scale: newScale,
        }
      })
    } else {
      // 双指滑动 → 平移
      setTransform((prev) => ({
        ...prev,
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }))
    }
  }, [])
  ```

  注：`e.preventDefault()` 已由原生 handler 处理，合成事件里不需再调用。

  **涉及文件**：`src/components/BranchTree/BranchTree.tsx`

  **验收**：双指上下/左右滑动 → 视图平移；双指捏合 → 缩放；两者无混淆。

---

- [ ] **节点2：req-045 cachingEnabled Zustand 状态 + 持久化**

  在 `settingsSlice.ts` 中新增 `cachingEnabled: boolean`，与 API key 使用同一套持久化机制。

  **`SettingsSlice` 接口扩展**：

  ```typescript
  export interface SettingsSlice {
    apiKeys: StoredApiKey[]
    cachingEnabled: boolean
    setCachingEnabled: (v: boolean) => void
    // ... 其余不变
  }
  ```

  **`persistKeys` 签名修改**（`settingsSlice.ts:50`，完整替换函数定义）：

  ```typescript
  // 修改前（第50–55行）：
  function persistKeys(keys: StoredApiKey[]) {
    localStorage.setItem(LS_KEYS, JSON.stringify(keys))
    invoke('write_settings', { data: JSON.stringify({ apiKeys: keys }) }).catch(() => {})
  }

  // 修改后：
  function persistKeys(keys: StoredApiKey[], cachingEnabled: boolean) {
    localStorage.setItem(LS_KEYS, JSON.stringify(keys))
    localStorage.setItem('wb_caching_enabled', JSON.stringify(cachingEnabled))
    invoke('write_settings', {
      data: JSON.stringify({ apiKeys: keys, cachingEnabled })
    }).catch(() => {})
  }
  ```

  注：`persistKeys` 必须同步写 `wb_caching_enabled` 到 localStorage，否则通过 `addApiKey`/`removeApiKey` 等路径更新 keys 时，文件中的 `cachingEnabled` 会更新而 localStorage 不更新，导致冷启动时两者不一致。

  **调用处枚举**（`settingsSlice.ts` 共 3 处，全部需要更新）：

  | 行号 | 所在函数 | 原调用 | 改为 |
  |------|----------|--------|------|
  | 70 | `addApiKey` | `persistKeys(next)` | `persistKeys(next, get().cachingEnabled)` |
  | 76 | `updateApiKey` | `persistKeys(next)` | `persistKeys(next, get().cachingEnabled)` |
  | 82 | `removeApiKey` | `persistKeys(next)` | `persistKeys(next, get().cachingEnabled)` |

  **`createSettingsSlice` 新增初始值和 action**：

  ```typescript
  // 初始值（从 localStorage fast 读）
  cachingEnabled: JSON.parse(localStorage.getItem('wb_caching_enabled') ?? 'false'),

  // action
  setCachingEnabled: (v) => {
    localStorage.setItem('wb_caching_enabled', JSON.stringify(v))
    set({ cachingEnabled: v })
    invoke('write_settings', {
      data: JSON.stringify({ apiKeys: get().apiKeys, cachingEnabled: v })
    }).catch(() => {})
  },
  ```

  **`hydrateSettingsFromFile` 更新**：类型断言和 setState 均需增加 `cachingEnabled`：

  ```typescript
  const data = JSON.parse(raw) as { apiKeys?: StoredApiKey[]; cachingEnabled?: boolean }
  // ...
  if (data.apiKeys && data.apiKeys.length > 0) {
    localStorage.setItem(LS_KEYS, JSON.stringify(data.apiKeys))
    setState({ apiKeys: data.apiKeys })
  }
  // cachingEnabled 单独处理（文件值优先，undefined 时保留 localStorage 初始值）
  if (data.cachingEnabled !== undefined) {
    localStorage.setItem('wb_caching_enabled', JSON.stringify(data.cachingEnabled))
    setState({ cachingEnabled: data.cachingEnabled })
  }
  ```

  **涉及文件**：`src/store/settingsSlice.ts`

---

- [ ] **节点3：req-045 Caching UI 开关按钮**

  在 `ChatView.tsx` 顶部新增 selector（节点4 依赖此声明），并渲染开关按钮。

  ```typescript
  // ChatView.tsx 顶部 selector 区
  const cachingEnabled = useStore((s) => s.cachingEnabled)
  const setCachingEnabled = useStore((s) => s.setCachingEnabled)
  ```

  ```tsx
  {/* 紧靠模型选择下拉框 */}
  <button
    className={`chat-caching-btn${cachingEnabled ? ' chat-caching-btn--active' : ''}`}
    onClick={() => setCachingEnabled(!cachingEnabled)}
    title={cachingEnabled ? '关闭 Prompt Caching' : '开启 Prompt Caching'}
  >
    Caching
  </button>
  ```

  样式（`ChatView.css` 新增）：
  - `.chat-caching-btn`：`padding: 2px 8px; border-radius: 4px; font-size: 12px; border: 1px solid var(--border); background: transparent; cursor: pointer; transition: background 0.15s, color 0.15s`
  - `.chat-caching-btn--active`：`background: var(--accent, #2563eb); color: white; border-color: var(--accent, #2563eb)`

  **涉及文件**：`src/components/ChatView/ChatView.tsx`、`ChatView.css`

---

- [ ] **节点4：req-045 invoke 参数接入**

  将两处 `invoke('stream_ai')` 的 `caching: false` 替换为实际状态，移除 TODO 注释。节点3 已在 ChatView 顶部声明了 `cachingEnabled` selector，本节点直接使用。

  ```typescript
  // tool continuation 处（ChatView.tsx:262）—— 在闭包内，用 getState() 避免捕获旧值：
  // 原：caching: false, // TODO: 接入 v0.12 Caching UI 开关后改为 useStore.getState().cachingEnabled
  // 改为：
  caching: useStore.getState().cachingEnabled,

  // 普通发送处（ChatView.tsx:501）—— 在 handleSend 作用域内，cachingEnabled 为组件顶部 selector：
  // 原：caching: false, // TODO: 接入 v0.12 Caching UI 开关后改为 useStore.getState().cachingEnabled
  // 改为：
  caching: cachingEnabled,
  ```

  **涉及文件**：`src/components/ChatView/ChatView.tsx`

---

- [ ] **节点5：req-044 layoutSlice 新增 p4Mode + expandedInput**

  在 `layoutSlice.ts` 中新增两个字段，同时处理 `DetailPanel.tsx` 中现有的本地类型冲突。

  **layoutSlice.ts 新增**：

  ```typescript
  export type P4Mode = 'detail' | 'text-input'

  export interface LayoutSlice {
    // ... 现有字段
    p4Mode: P4Mode
    setP4Mode: (mode: P4Mode) => void
    expandedInput: string
    setExpandedInput: (v: string) => void
  }

  // 初始值
  p4Mode: 'detail',
  setP4Mode: (mode) => set({ p4Mode: mode }),
  expandedInput: '',
  setExpandedInput: (v) => set({ expandedInput: v }),
  ```

  **DetailPanel.tsx 清理**：

  当前 `DetailPanel.tsx:20` 有本地类型定义，`DetailPanel.tsx:27` 有对应的 useState：
  ```typescript
  // 第20行
  type P4Mode = 'detail' | 'markdown' | 'editor'
  // 第27行（带下划线前缀，表示声明但未在 JSX 中引用）
  const [_p4Mode] = useState<P4Mode>('detail')
  ```
  `_p4Mode` 在 JSX 中无任何引用，可安全删除。实现节点5时：
  1. 删除第20行本地 `type P4Mode`
  2. 删除第27行 `const [_p4Mode] = useState<P4Mode>('detail')`
  3. 在 import 区新增：`import type { P4Mode } from '../../store/layoutSlice'`（节点6 会使用）

  **涉及文件**：`src/store/layoutSlice.ts`、`src/components/DetailPanel/DetailPanel.tsx`

---

- [ ] **节点6：req-044 P4 text-input 面板**

  在 `DetailPanel.tsx` 中实现 `text-input` 视图模式渲染。

  ```tsx
  const p4Mode = useStore((s) => s.p4Mode)
  const setP4Mode = useStore((s) => s.setP4Mode)
  const expandedInput = useStore((s) => s.expandedInput)
  const setExpandedInput = useStore((s) => s.setExpandedInput)

  if (p4Mode === 'text-input') {
    return (
      <div className="p4-text-input">
        <div className="p4-text-input__header">
          <span className="p4-text-input__title">文本输入</span>
          <button className="p4-text-input__collapse" onClick={() => setP4Mode('detail')}>
            收起
          </button>
        </div>
        <textarea
          className="p4-text-input__area"
          value={expandedInput}
          onChange={(e) => setExpandedInput(e.target.value)}
          placeholder="在此输入长文本，内容实时同步至对话输入框…"
        />
        <div className="p4-text-input__footer">{expandedInput.length} 字符</div>
      </div>
    )
  }
  // 原 detail 模式渲染不变
  ```

  **CSS 注意**：`DetailPanel.css` 已确认 `.detail-panel { height: 100% }` 存在（第1行），`flex: 1` 可正常生效，无需补充。

  `--border` 和 `--text-muted` 在全局 CSS 中无显式定义，项目惯例使用带 fallback 的写法（见 `DashboardView.css` 等文件）。

  ```css
  /* DetailPanel.css 新增 */
  .p4-text-input {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 12px;
    box-sizing: border-box;
  }
  .p4-text-input__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .p4-text-input__area {
    flex: 1;
    resize: none;
    font-family: Inter, sans-serif;
    font-size: 14px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 4px;
    padding: 8px;
    outline: none;
  }
  .p4-text-input__footer {
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-muted, #9ca3af);
    text-align: right;
  }
  ```

  **涉及文件**：`src/components/DetailPanel/DetailPanel.tsx`、`DetailPanel.css`

---

- [ ] **节点7：req-044 P3 展开按钮 + handleSend 改写**

  将 `ChatView.tsx` 的输入框从本地 `useState` 改为读写 store 的 `expandedInput`，并新增展开按钮。

  **Store selector（ChatView 顶部新增）**：

  ```typescript
  const expandedInput = useStore((s) => s.expandedInput)
  const setExpandedInput = useStore((s) => s.setExpandedInput)
  const setP4Mode = useStore((s) => s.setP4Mode)
  ```

  **删除本地 useState**：删除 `const [input, setInput] = useState('')`（`ChatView.tsx:126`）。

  **textarea 属性改写**：

  ```typescript
  // ChatView.tsx:646 — value prop：
  // 原：value={input}
  // 改：value={expandedInput}

  // ChatView.tsx:648 — onChange（原第647行，实际含 onChange 函数体）：
  // 修改前：
  onChange={(e) => {
    setInput(e.target.value)
    if (e.target.value.trim()) { setIsUserInputting(true) } else { setIsUserInputting(false) }
  }}
  // 修改后：
  onChange={(e) => {
    setExpandedInput(e.target.value)
    if (e.target.value.trim()) { setIsUserInputting(true) } else { setIsUserInputting(false) }
  }}
  ```

  **handleSend 改写清单**（精确行号）：

  | 行号 | 原代码 | 改为 |
  |------|--------|------|
  | 429 | `if (!input.trim() \|\| streamingState === 'streaming') return` | `if (!expandedInput.trim() \|\| streamingState === 'streaming') return` |
  | 470 | `pendingQuestionRef.current = input` | `pendingQuestionRef.current = expandedInput` |
  | 472 | `{ role: 'user', content: input }` （setMessages 内） | `content: expandedInput` |
  | 473 | `setInput('')` | `setExpandedInput('')` |
  | 486 | `{ role: 'user', content: input }` （outgoingMessages 内） | `content: expandedInput` |

  **handleSend useCallback deps**（`ChatView.tsx:524`）：

  ```typescript
  // 修改前（第524行）：
  }, [input, streamingState, currentPath, messages, selectedProjectId, projects,
      setStreamingState, clearPendingEvents, setIsUserInputting, buildSystemPrompt])

  // 修改后：
  }, [expandedInput, streamingState, currentPath, messages, selectedProjectId, projects,
      setStreamingState, clearPendingEvents, setIsUserInputting, buildSystemPrompt])
  ```

  **发送后清空时机**：`setExpandedInput('')` 在 `pendingQuestionRef.current = expandedInput` 之后、`setMessages` 之前调用（与原 `setInput('')` 位置相同，确保 ref 已保存问题内容再清空）。P4 保持当前 `p4Mode` 不变（不调用 `setP4Mode`）。

  **展开按钮**（textarea 旁新增）：

  ```tsx
  <button
    className="chat-expand-btn"
    onClick={() => setP4Mode('text-input')}
    title="展开到 P4 编辑 (⤢)"
  >
    ⤢
  </button>
  ```

  **涉及文件**：`src/components/ChatView/ChatView.tsx`、`ChatView.css`

---

> 进度：0/7 节点完成

────────────── 实现完成后解锁 ──────────────

## 测试阶段

### AI 测试（自动运行）

**req-046 逻辑验证**

- [ ] **T1 · ctrlKey 分支**：阅读修改后的 `onWheel` 代码，验证 `e.ctrlKey=true` 走缩放逻辑、`e.ctrlKey=false` 走平移逻辑；验证 `containerRef` 绑定了 `{ passive: false }` 的原生 wheel listener；验证 `useEffect` 返回清理函数（`return () => el.removeEventListener('wheel', handler)`），不会内存泄漏

**req-045 状态验证**

- [ ] **T2 · cachingEnabled 持久化**：`settingsSlice` 初始值为 `false`；`setCachingEnabled(true)` 后 `localStorage.getItem('wb_caching_enabled')` 返回 `"true"`；`persistKeys` 签名含 `cachingEnabled` 参数，无 `useStore.getState()` 调用（无循环依赖）
- [ ] **T3 · invoke 参数接入**：验证两处 `invoke('stream_ai')` 的 `caching` 字段已替换为 store 值，无 `caching: false` 硬编码残留

**req-044 状态验证**

- [ ] **T4 · p4Mode 状态机**：`setP4Mode('text-input')` 后 `p4Mode === 'text-input'`；`setP4Mode('detail')` 后回到 `'detail'`
- [ ] **T5 · expandedInput P3→P4 同步**：`setExpandedInput('hello')` 后，P3 textarea `value` 和 P4 textarea `value` 均为 `'hello'`（两者均从 store 读取同一字段）
- [ ] **T6 · handleSend 改写完整性**：验证 `handleSend` 中 `input` 的所有 5 处引用已替换为 `expandedInput`，`useState('')` 已删除，`useCallback` deps 已更新

### 人工验收（用户确认）

- [ ] **V1 · 触摸板平移**：P2 画布上双指上下/左右滑动 → 视图平移，不缩放
- [ ] **V2 · 触摸板缩放**：P2 画布上双指捏合/张开 → 视图缩放，不平移
- [ ] **V3 · Caching 开关外观**：P3 输入框旁有「Caching」按钮，active 态蓝色高亮，inactive 态边框样式
- [ ] **V4 · Caching 持久化**：开启 Caching 后重启 app，开关仍处于 active 态
- [ ] **V5 · P4 展开**：点击展开按钮，P4 切换为 text-input 模式，textarea 显示当前输入内容
- [ ] **V6 · 双向同步**：在 P4 textarea 输入，P3 输入框同步更新；在 P3 输入，P4 同步更新
- [ ] **V7 · 收起保留内容**：点击 P4「收起」，P4 回到 detail 模式，P3 输入框内容完整保留
- [ ] **V8 · 发送不退出 P4**：在 P4 text-input 模式下发送消息，P4 保持 text-input 模式（不自动退回 detail）

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1 | 2026-05-23 | 初稿，7 个实现节点 + 5 AI 测试 + 8 人工验收 |
| v2 | 2026-05-23 | review-agent 修订：🔴节点1 补全 passive wheel listener 完整代码（useEffect + containerRef）；🔴节点2 persistKeys 改为接收 cachingEnabled 参数（消除循环依赖）、补全 hydrateSettingsFromFile 类型更新；🔴节点7 补全 handleSend 5 处改写清单和清空时机；🟡节点4 补充依赖节点3；🟡节点5 明确 P4Mode 类型冲突清理；🟡新增 T6 handleSend 完整性检查；🟡节点6 补全 CSS 父容器上下文和最小 CSS 片段 |
| v3 | 2026-05-23 | review-agent 修订：🔴节点1 补全 setTransform 来源说明（useState 第136行，deps [] 正确）+ BranchTree:200 JSX diff；🔴节点2 persistKeys 补全 wb_caching_enabled localStorage 写入 + 枚举3处调用行号（70/76/82）；🔴节点7 补全 handleSend 5处改写精确行号（429/470/472/473/486）+ useCallback deps 完整内容（第524行）；🟡节点5 确认 _p4Mode 无JSX引用；🟡节点6 修正依赖关系（不依赖节点7）+ 确认 .detail-panel height:100% 已存在 + CSS 变量改用带 fallback 写法；🟡T1 补充 cleanup 函数验证 |
| v4 | 2026-05-23 | review-agent 修订：🔴节点2 persistKeys 函数定义行号（第50行）+ 修改前完整代码片段；🔴节点4 精确行号（tool continuation:262，普通发送:501）+ 原始注释内容；🔴节点7 补充 value={input} 改写行号（第646行）+ 单独列出 |
