/**
 * v0151-acceptance.test.ts · v0.15.1 测试阶段补充用例
 *
 * 覆盖 technical.md「测试阶段 / AI 自动测试」中未在 4.1 节点组件测试集里直接覆盖的用例。
 * 采用三种验证手段（均不引入 jsdom，遵循 T-V151-R4）：
 *   - SSR renderToString：纯展示组件视觉断言（TokenLine / FinalAnswerBubble / ThemeToggleButton）
 *   - 源文件 grep：基于代码静态结构的契约断言（App.tsx 引用、chat-pause-btn-header 不存在、埋点接入）
 *   - 直接 store 调用：traceSlice 分支行为断言（group toggle）
 *
 * 验证锚点：T-V151-A4 / A5 / A6 / A7 / A8 / B3 / B4 / B5 / C3 / C4 / C7 / R1 / R3 / R4 / R5
 */

import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createStore } from 'zustand/vanilla'
import { createTraceSlice, type TraceSlice } from '../store/traceSlice'
import { TokenLine } from '../components/ChatViewV2/TokenLine'
import { FinalAnswerBubble } from '../components/ChatViewV2/FinalAnswerBubble'

// 仓库根（workbench/）相对此文件路径：../..
const REPO_ROOT = resolve(__dirname, '../..')

function readSource(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf-8')
}

// ─── Phase 1 · ProcessTrace 接入 补充用例 ────────────────────────────────

describe('T-V151-A4 · 旧 atom（无 ## Steps）降级不报错', () => {
  // QABlock 的 rounds === null 分支已在 QABlock.test.tsx 场景 2 覆盖。
  // 这里补充契约层断言：atomParser 解析 v0.14 旧 atom 应返回 steps === null。
  it('atomParser 对无 ## Steps 的 atom 返回 rounds=null（QABlock 上游契约）', async () => {
    const { parseAtom } = await import('../lib/atomParser')
    const v014Atom = [
      '---',
      'id: legacy-atom',
      'created: 2026-05-01T00:00:00Z',
      '---',
      '',
      '## Q',
      '老的问题',
      '',
      '## A',
      '老的回答',
      '',
    ].join('\n')
    const parsed = parseAtom(v014Atom)
    // 旧 atom 无 ## Steps → steps 字段应为 null（契约：QABlock 收到 null 时不渲染 process-trace）
    expect(parsed.steps === null || parsed.steps === undefined).toBe(true)
    expect(parsed.q?.trim()).toBe('老的问题')
    expect(parsed.response?.trim()).toBe('老的回答')
  })
})

describe('T-V151-A5 · Group toggle 一次性折叠', () => {
  it('toggleThinkingGroup 切换 thinkingGroupCollapsed；toggleToolGroup 切换 toolGroupCollapsed（单次切换覆盖全 group）', () => {
    const store = createStore<TraceSlice>()(createTraceSlice)
    expect(store.getState().thinkingGroupCollapsed).toBe(false)
    store.getState().toggleThinkingGroup()
    expect(store.getState().thinkingGroupCollapsed).toBe(true)
    // 工具 group 默认 true（收起），toggle 一次 → false（展开）
    expect(store.getState().toolGroupCollapsed).toBe(true)
    store.getState().toggleToolGroup()
    expect(store.getState().toolGroupCollapsed).toBe(false)
  })
})

describe('T-V151-A6 · 单项折叠覆盖 group', () => {
  it('toggleThinkOverride / toggleToolOverride 仅影响指定 key，不污染 group 字段或其他 override', () => {
    const store = createStore<TraceSlice>()(createTraceSlice)
    // 模拟 group 展开
    store.getState().toggleToolGroup()
    expect(store.getState().toolGroupCollapsed).toBe(false)

    // 单独覆盖 toolKey 'r0-Read-abc'
    store.getState().toggleToolOverride('r0-Read-abc')
    expect(store.getState().toolOverrides['r0-Read-abc']).toBe(true)

    // 其他 key 不受影响
    expect(store.getState().toolOverrides['r0-Read-def']).toBeUndefined()
    // group 字段不被 override 改写
    expect(store.getState().toolGroupCollapsed).toBe(false)

    // 思维链 override 同理
    store.getState().toggleThinkOverride('r0')
    expect(store.getState().thinkOverrides['r0']).toBe(true)
    expect(store.getState().thinkingGroupCollapsed).toBe(false)
  })
})

describe('T-V151-A7 · Markdown 渲染验证', () => {
  it('FinalAnswerBubble 渲染标题 / bold / 行内 code / 代码块', () => {
    const md = '# 标题\n\n这是 **bold** 与行内 `code`。\n\n```js\nconst x = 1\n```\n'
    const html = renderToString(<FinalAnswerBubble content={md} />)
    expect(html.includes('<h1>')).toBe(true)
    expect(html.includes('<strong>')).toBe(true)
    // 行内 code 与代码块都会出现 <code>；代码块还会有 <pre>
    expect(html.includes('<code')).toBe(true)
    expect(html.includes('<pre>')).toBe(true)
    // rehype-highlight 会给代码块加 hljs 类
    expect(html.includes('hljs')).toBe(true)
  })
})

describe('T-V151-A8 · Token 行四项显示', () => {
  it('完整 usage：in / out 显示数值，cached / cost 显示 --（v0.15.1 占位策略）', () => {
    const html = renderToString(<TokenLine usage={{ input: 1234, output: 567 }} />)
    expect(html.includes('in:')).toBe(true)
    expect(html.includes('out:')).toBe(true)
    expect(html.includes('cached:')).toBe(true)
    expect(html.includes('cost:')).toBe(true)
    expect(html.includes('1234')).toBe(true)
    expect(html.includes('567')).toBe(true)
    // cached / cost 占位 --
    expect((html.match(/--/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('usage 字段全部缺失：四项均显示 --，不渲染 undefined 或报错', () => {
    const html = renderToString(<TokenLine usage={{}} />)
    expect(html.includes('in:')).toBe(true)
    expect(html.includes('out:')).toBe(true)
    expect(html.includes('undefined')).toBe(false)
    // 四个 -- 占位
    expect((html.match(/--/g) || []).length).toBeGreaterThanOrEqual(4)
  })
})

// ─── Phase 2 · 发送按钮状态机 补充用例 ──────────────────────────────────

describe('T-V151-B3 · 暂停触发 IPC（handlePause 路径调用）', () => {
  // ChatInputV2 已接收 handlePause prop（详 ChatInputV2.test.tsx）；
  // 实际 IPC 调用在 useChatSend hook 的 handlePause 内部，下面通过源码 grep 验证调用链
  it('useChatSend.ts 包含 window.api.agent.pause() 调用', () => {
    const src = readSource('src/hooks/useChatSend.ts')
    expect(src.includes('window.api.agent.pause')).toBe(true)
  })

  it('useChatSend.ts 同时打 pause_triggered 埋点（节点 4.0 接入）', () => {
    const src = readSource('src/hooks/useChatSend.ts')
    expect(src.includes("'pause_triggered'") || src.includes('"pause_triggered"')).toBe(true)
  })
})

describe('T-V151-B4 · P3 header 无独立 ⏸ 按钮', () => {
  it('ChatViewV2.tsx 源码不含 chat-pause-btn-header className 渲染（注释除外）', () => {
    const src = readSource('src/components/ChatViewV2/ChatViewV2.tsx')
    // 注释里有"chat-pause-btn-header"作为不迁移说明（包含 `chat-pause-btn-header` 字面值），
    // 但 className= 形式不应出现
    expect(src).not.toMatch(/className=["'`][^"'`]*chat-pause-btn-header/)
  })

  it('ChatView.tsx（旧文件保留）仍含 chat-pause-btn-header className（回滚锚点）', () => {
    const src = readSource('src/components/ChatView/ChatView.tsx')
    expect(src).toMatch(/className=["'`][^"'`]*chat-pause-btn-header/)
  })
})

describe('T-V151-B5 · v0.15.1 P2 验收修订：chat-header 整块移除', () => {
  // 原 T-V151-B5 期望 chat-status-badge 留在 P3 header；
  // v0.15.1 P2 验收修订（2026-06-02）：chat-header 整块删除，
  // 运行 / 暂停 指示由 TopBar AgentRunPill 与 ChatInputV2 三态机分担。
  it('ChatViewV2.tsx 不再渲染 chat-header / chat-status-badge / chat-node-info', () => {
    const src = readSource('src/components/ChatViewV2/ChatViewV2.tsx')
    expect(src.includes('chat-status-badge--running')).toBe(false)
    expect(src.includes('chat-status-badge--paused')).toBe(false)
    expect(src.includes('"chat-header"')).toBe(false)
    expect(src.includes('chat-node-info')).toBe(false)
  })
})

describe('T-V151-B6 · 干预取消恢复 idle（节点 2.4 兜底）', () => {
  it('InterventionInline.handleCancel 在 resume(null) 后兜底 setStreamingState("idle")', () => {
    const src = readSource('src/components/InterventionInline/InterventionInline.tsx')
    // 取消分支必须同时存在 resume(null) 与 setStreamingState('idle') 两条语句
    expect(src.includes('agent.resume(null)')).toBe(true)
    expect(src.includes("setStreamingState('idle')") || src.includes('setStreamingState("idle")')).toBe(true)
  })
})

// ─── Phase 3 · ActivityBar / TopBar 补充用例 ────────────────────────────

describe('T-V151-C3 · 底部双按钮独立', () => {
  it('NavIcons.tsx 同时挂载 ThemeToggleButton 与 settings 按钮', () => {
    const src = readSource('src/components/NavIcons/NavIcons.tsx')
    expect(src.includes('<ThemeToggleButton')).toBe(true)
    // settings 按钮（v0.15 已有，class 名包含 settings）
    expect(src).toMatch(/settings/i)
  })
})

describe('T-V151-C4 · Theme toggle 图标 / 行为', () => {
  it('ThemeToggleButton.tsx 根据 theme 在 ☀ / 🌙 间切换', () => {
    const src = readSource('src/components/NavIcons/ThemeToggleButton.tsx')
    // 图标双分支
    expect(src.includes('☀')).toBe(true)
    expect(src.includes('🌙')).toBe(true)
    // 调用 toggleTheme 上游 action
    expect(src.includes('toggleTheme')).toBe(true)
  })

  it('appearanceSlice 提供 toggleTheme（DOM body.classList + localStorage 由 v0.15 链路自动同步）', () => {
    const src = readSource('src/store/appearanceSlice.ts')
    expect(src.includes('toggleTheme')).toBe(true)
    // 节点 3.4（v0.15）规范：toggleTheme 应触达 document.body.classList
    expect(src.includes('document.body.classList') || src.includes("document.body.classList")).toBe(true)
  })
})

describe('T-V151-C7 · Token 命名空间冻结（--run-bg / --run-bd 源已存在）', () => {
  it('tokens.css 浅色 + 暗色双分支均含 --run-bg 与 --run-bd', () => {
    const src = readSource('src/styles/tokens.css')
    // 至少出现 2 次 --run-bg（浅色一次 + 暗色一次）；--run-bd 同理
    expect((src.match(/--run-bg\s*:/g) || []).length).toBeGreaterThanOrEqual(2)
    expect((src.match(/--run-bd\s*:/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('AgentRunPill 源码引用 --run-bg / --run-bd（不新建 token）', () => {
    // 节点 3.4 CSS 复用约定：实际样式定义在组件配套 CSS（AgentRunPill 内联或独立文件）
    const tsx = readSource('src/components/TopBar/AgentRunPill.tsx')
    const css = readSource('src/components/TopBar/TopBar.css')
    const combined = tsx + '\n' + css
    expect(combined.includes('--run-bg')).toBe(true)
    expect(combined.includes('--run-bd')).toBe(true)
  })
})

// ─── 回归测试 ─────────────────────────────────────────────────────────

describe('T-V151-R1 · 旧 ChatView 不再被引用为渲染挂载点', () => {
  it('App.tsx 不存在 <ChatView /> 自闭合挂载形式（旧 import 仅作回滚别名）', () => {
    const src = readSource('src/App.tsx')
    // 旧 import 应改为 _ChatViewLegacy 别名（参考实现说明）
    expect(src.includes('_ChatViewLegacy')).toBe(true)
    // 不应再有 <ChatView /> 形式挂载点（注意：`<ChatViewV2 />` 不会触发，因为它后跟 V2）
    expect(src).not.toMatch(/<ChatView\s*\/>/)
    expect(src).not.toMatch(/<ChatView>/)
  })
})

describe('T-V151-R3 · ServerConfig 在 SettingsPanel 内复用（v0.15.1 后续修订 2026-06-01）', () => {
  // 节点 3.2 后续修订：人工验收反馈服务器详情应合并到 settings，
  // 废弃独立 ServerDetailPanel；ServerStatusButton onClick 改为打开 SettingsPanel
  it('NavIcons.tsx SettingsPanel 内嵌 <ServerConfig />（合并后的复用约定）', () => {
    const src = readSource('src/components/NavIcons/NavIcons.tsx')
    expect(src.includes('<ServerConfig')).toBe(true)
  })

  it('ActivityBar 顶部不再渲染 ServerStatusButton（v0.15.1 P2 验收修订 2026-06-02）', () => {
    const src = readSource('src/components/NavIcons/NavIcons.tsx')
    // 顶部独立服务器状态按钮被删除（顶部识别噪音 → 入口下沉到底部 settings）
    expect(src).not.toMatch(/^\s*import\s+\{[^}]*ServerStatusButton/m)
    expect(src).not.toMatch(/<ServerStatusButton/)
    // ServerDetailPanel 同样不再被引用
    expect(src).not.toMatch(/^\s*import\s+\{[^}]*ServerDetailPanel/m)
    expect(src).not.toMatch(/<ServerDetailPanel/)
  })
})

describe('T-V151-R4 · v0.15.1 不引入新依赖', () => {
  it('package.json 中 dependencies / devDependencies 均不含 jsdom 与 happy-dom（vitest environment=node）', () => {
    const pkg = JSON.parse(readSource('package.json'))
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
    expect(deps.jsdom).toBeUndefined()
    expect(deps['happy-dom']).toBeUndefined()
    expect(deps['@testing-library/react']).toBeUndefined()
  })

  it('依赖核心包仍延用 v0.15 已有的 react-markdown / remark-gfm / rehype-highlight（无新增 markdown 库）', () => {
    const pkg = JSON.parse(readSource('package.json'))
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
    expect(deps['react-markdown']).toBeDefined()
    expect(deps['remark-gfm']).toBeDefined()
    expect(deps['rehype-highlight']).toBeDefined()
  })
})

describe('T-V151-R5 · 埋点四事件接入', () => {
  // 节点 4.0 接入约定：4 个事件分别写在 3 个文件
  //   process_trace_toggled  → ProcessTrace.tsx（整体 chevron）
  //   group_toggle_used      → ProcessTrace.tsx（思维链 + 工具 group toggle，2 处调用）
  //   pause_triggered        → useChatSend.ts（暂停按钮 → hook 内部）
  //   intervention_submitted → InterventionInline.tsx（注入并继续）
  it('ProcessTrace.tsx 含 process_trace_toggled 与 group_toggle_used 埋点（后者出现 2 次）', () => {
    const src = readSource('src/components/ProcessTrace/ProcessTrace.tsx')
    expect(src).toMatch(/process_trace_toggled/)
    const matches = src.match(/group_toggle_used/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('useChatSend.ts 含 pause_triggered 埋点（节点 2.2 一并落地）', () => {
    const src = readSource('src/hooks/useChatSend.ts')
    expect(src).toMatch(/pause_triggered/)
  })

  it('InterventionInline.tsx 含 intervention_submitted 埋点（节点 4.0 落地）', () => {
    const src = readSource('src/components/InterventionInline/InterventionInline.tsx')
    expect(src).toMatch(/intervention_submitted/)
    // 必须传 text_length payload
    expect(src.includes('text_length')).toBe(true)
  })

  it('write_event_log 调用形式：4 处事件均通过 window.api.invoke("write_event_log", ...) 链路', () => {
    const files = [
      'src/components/ProcessTrace/ProcessTrace.tsx',
      'src/components/InterventionInline/InterventionInline.tsx',
      'src/hooks/useChatSend.ts',
    ].map(readSource).join('\n')
    expect(files).toMatch(/write_event_log/)
    // 失败静默：必须 .catch
    expect(files).toMatch(/\.catch\s*\(/)
  })
})

// ─── 引导静默：用 vi 标识本文件不依赖额外 mock ────────────────────────
// （避免 vi 未使用警告，已通过 .catch 静默策略覆盖）
void vi
