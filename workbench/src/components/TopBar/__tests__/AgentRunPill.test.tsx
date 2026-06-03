/**
 * AgentRunPill.test.tsx · v0.15.1 节点 4.1
 *
 * 覆盖 0 / N 计数显示（0 → 不渲染；N → 显示 "Agent 运行中 · N 活跃"）。
 *
 * 验证锚点：T-V151-C5（0 计数不渲染）/ T-V151-C6（N 计数实时文案）
 */

import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

const mockState = {
  streamingAtoms: new Set<string>(),
}

vi.mock('../../../store', () => ({
  useStore: <T,>(selector: (s: { streamingAtoms: { size: number } }) => T) =>
    selector({ streamingAtoms: { size: mockState.streamingAtoms.size } as unknown as Set<string> }),
}))

import { AgentRunPill } from '../AgentRunPill'

describe('AgentRunPill · 0/N 计数', () => {
  it('0 个活跃：返回 null，html 为空字符串', () => {
    mockState.streamingAtoms = new Set()
    const html = renderToString(<AgentRunPill />)
    expect(html).toBe('')
  })

  it('1 个活跃：文案 "Agent 运行中 · 1 活跃"', () => {
    mockState.streamingAtoms = new Set(['a1'])
    const html = renderToString(<AgentRunPill />)
    expect(html.includes('agent-run-pill')).toBe(true)
    expect(html.includes('1') && html.includes('活跃')).toBe(true)
  })

  it('2 个活跃：文案 "Agent 运行中 · 2 活跃"', () => {
    mockState.streamingAtoms = new Set(['a1', 'a2'])
    const html = renderToString(<AgentRunPill />)
    expect(html.includes('agent-run-pill')).toBe(true)
    expect(html.includes('2') && html.includes('活跃')).toBe(true)
  })
})
