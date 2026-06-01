/**
 * traceSlice.test.ts · v0.15.1 节点 4.1
 *
 * 覆盖：
 *   - resetTrace 把三维折叠恢复默认（process=false / thinking=false / tool=true）
 *   - resetTrace 清空 overrides 和 liveRounds
 *   - 集成断言：模拟 ChatViewV2 useEffect 在 selectedAtomId 变化时调用 resetTrace 的行为契约
 *     （T-V151-A2 切节点重置三维默认 / T-V151-R2 v0.15 6 个 action 签名不破）
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createTraceSlice } from '../traceSlice'
import type { TraceSlice } from '../traceSlice'

function makeStore() {
  return createStore<TraceSlice>()(createTraceSlice)
}

describe('traceSlice · resetTrace 默认值恢复', () => {
  let store: ReturnType<typeof makeStore>
  beforeEach(() => { store = makeStore() })

  it('初始状态：processCollapsed=false / thinkingGroupCollapsed=false / toolGroupCollapsed=true', () => {
    const s = store.getState()
    expect(s.processCollapsed).toBe(false)
    expect(s.thinkingGroupCollapsed).toBe(false)
    expect(s.toolGroupCollapsed).toBe(true)
  })

  it('toggleProcess → toggleThinkingGroup → toggleToolGroup 后调用 resetTrace，三维恢复默认', () => {
    store.getState().toggleProcess()           // processCollapsed → true
    store.getState().toggleThinkingGroup()     // thinkingGroupCollapsed → true
    store.getState().toggleToolGroup()         // toolGroupCollapsed → false
    expect(store.getState().processCollapsed).toBe(true)
    expect(store.getState().thinkingGroupCollapsed).toBe(true)
    expect(store.getState().toolGroupCollapsed).toBe(false)

    store.getState().resetTrace()
    const s = store.getState()
    expect(s.processCollapsed).toBe(false)
    expect(s.thinkingGroupCollapsed).toBe(false)
    expect(s.toolGroupCollapsed).toBe(true)
  })

  it('resetTrace 同时清空 thinkOverrides / toolOverrides / liveRounds', () => {
    store.getState().toggleThinkOverride('0')
    store.getState().toggleToolOverride('tool-1')
    store.getState().appendLiveThinking({ roundIndex: 0, content: 'x' })
    expect(Object.keys(store.getState().thinkOverrides).length).toBe(1)
    expect(Object.keys(store.getState().toolOverrides).length).toBe(1)
    expect(store.getState().liveRounds.length).toBe(1)

    store.getState().resetTrace()
    expect(Object.keys(store.getState().thinkOverrides).length).toBe(0)
    expect(Object.keys(store.getState().toolOverrides).length).toBe(0)
    expect(store.getState().liveRounds.length).toBe(0)
  })

  // v0.15 r6 行为契约：6 个 action 签名保留（T-V151-R2）
  it('R2 · 6 个 action 签名保留：toggleProcess/toggleThinkingGroup/toggleToolGroup/toggleThinkOverride/toggleToolOverride/resetTrace 均为函数', () => {
    const s = store.getState()
    expect(typeof s.toggleProcess).toBe('function')
    expect(typeof s.toggleThinkingGroup).toBe('function')
    expect(typeof s.toggleToolGroup).toBe('function')
    expect(typeof s.toggleThinkOverride).toBe('function')
    expect(typeof s.toggleToolOverride).toBe('function')
    expect(typeof s.resetTrace).toBe('function')
  })
})

describe('traceSlice · 模拟 ChatViewV2 selectedAtomId 变化触发 resetTrace（集成）', () => {
  // 模拟 React useEffect 模式：每次 selectedAtomId 变化都调用 resetTrace
  it('A2 · 节点 A 修改工具组展开 → 切到节点 B → 三维同时回到默认值', () => {
    const store = makeStore()
    // 节点 A：把工具组展开（toolGroupCollapsed false）
    store.getState().toggleToolGroup()
    expect(store.getState().toolGroupCollapsed).toBe(false)

    // selectedAtomId 从 A 变到 B → ChatViewV2 useEffect 触发 resetTrace
    store.getState().resetTrace()

    const s = store.getState()
    expect(s.processCollapsed).toBe(false)
    expect(s.thinkingGroupCollapsed).toBe(false)
    expect(s.toolGroupCollapsed).toBe(true)
  })
})
