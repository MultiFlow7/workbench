/**
 * ChatInputV2.test.tsx · v0.15.1 节点 4.1
 *
 * 覆盖发送按钮三态切换（idle / streaming / paused）。
 * useStore 在 SSR 环境下走 server snapshot（始终返回 initial state），
 * 使用 vi.mock 替换 store 模块以驱动不同状态。
 *
 * 验证锚点：T-V151-B1（三态图标 ▶ / ⏸ / ⏸ disabled）
 *           T-V151-B2（streamingState !== idle 时 textarea.disabled）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'

// 在 import 组件前用 vi.mock 拦截 store
const mockState = {
  streamingState: 'idle' as 'idle' | 'streaming' | 'paused' | 'cancelled' | 'error',
  expandedInput: 'hello',
  setExpandedInput: vi.fn(),
  setIsUserInputting: vi.fn(),
  cachingEnabled: true,
  setCachingEnabled: vi.fn(),
  setP4Mode: vi.fn(),
  currentPath: [{ id: 'a', prev: null }],
  selectedProjectId: 'p1',
}

vi.mock('../../../store', () => ({
  useStore: <T,>(selector: (s: typeof mockState) => T) => selector(mockState),
}))

// ContextIndicator 同样依赖 store，stub 掉避免分支噪音
vi.mock('../../ContextIndicator/ContextIndicator', () => ({
  ContextIndicator: () => null,
}))

import { ChatInputV2 } from '../ChatInputV2'

describe('ChatInputV2 · 三态切换', () => {
  const baseProps = {
    handleSend: vi.fn(),
    handlePause: vi.fn(),
    model: 'claude-sonnet-4',
    setModel: vi.fn(),
    MODELS: ['claude-sonnet-4'],
    toolCallStatuses: [],
  }

  beforeEach(() => {
    mockState.expandedInput = 'hello'
    mockState.currentPath = [{ id: 'a', prev: null }] as never
    mockState.selectedProjectId = 'p1'
  })

  it('idle 状态：按钮显示 ↑（send 图标），输入框可用', () => {
    mockState.streamingState = 'idle'
    const html = renderToString(<ChatInputV2 {...baseProps} />)
    expect(html.includes('chat-input-btn--send')).toBe(true)
    expect(html.includes('chat-input-btn--pause')).toBe(false)
    // textarea 不应有 disabled
    expect(/<textarea[^>]*disabled[^>]*>/.test(html)).toBe(false)
  })

  it('streaming 状态：按钮显示 ⏸ pause 类名，textarea disabled', () => {
    mockState.streamingState = 'streaming'
    const html = renderToString(<ChatInputV2 {...baseProps} />)
    expect(html.includes('chat-input-btn--pause')).toBe(true)
    expect(html.includes('chat-input-btn--paused-disabled')).toBe(false)
    // wrap 应带 running 修饰
    expect(html.includes('chat-input-wrap--running')).toBe(true)
    expect(/<textarea[^>]*disabled/.test(html)).toBe(true)
  })

  it('paused 状态：按钮 ⏸ + paused-disabled 类，textarea 仍 disabled', () => {
    mockState.streamingState = 'paused'
    const html = renderToString(<ChatInputV2 {...baseProps} />)
    expect(html.includes('chat-input-btn--paused-disabled')).toBe(true)
    expect(html.includes('chat-input-wrap--paused')).toBe(true)
    expect(/<textarea[^>]*disabled/.test(html)).toBe(true)
  })
})
