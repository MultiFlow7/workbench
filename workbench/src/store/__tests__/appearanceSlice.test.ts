/**
 * appearanceSlice 单元测试（v0.15 节点 3.4）
 *
 * 不依赖 DOM 环境（vitest 默认 node）：
 *  - typeof document === 'undefined' 时 applyThemeToDom 应直接 no-op
 *  - typeof window === 'undefined' 时 resolveInitialTheme 应返回 'light'
 *
 * DOM 副作用（body.classList toggle）的端到端验证留给 Phase 4 ActivityBar 测试。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { create } from 'zustand'
import { createAppearanceSlice, AppearanceSlice } from '../appearanceSlice'

describe('appearanceSlice', () => {
  beforeEach(() => {
    // 重置 globalThis.window / document 影响（node 环境下默认 undefined）
  })

  it('在无 window 环境下默认 theme = light', () => {
    const store = create<AppearanceSlice>()((...a) => ({
      ...createAppearanceSlice(...a),
    }))
    expect(store.getState().theme).toBe('light')
  })

  it('setTheme 切换状态', () => {
    const store = create<AppearanceSlice>()((...a) => ({
      ...createAppearanceSlice(...a),
    }))
    expect(store.getState().theme).toBe('light')
    store.getState().setTheme('dark')
    expect(store.getState().theme).toBe('dark')
    store.getState().setTheme('light')
    expect(store.getState().theme).toBe('light')
  })

  it('setTheme 同值不重复 set（避免不必要 re-render）', () => {
    const store = create<AppearanceSlice>()((...a) => ({
      ...createAppearanceSlice(...a),
    }))
    let changeCount = 0
    const unsub = store.subscribe(() => {
      changeCount++
    })
    store.getState().setTheme('light') // 已是 light，不应触发
    expect(changeCount).toBe(0)
    store.getState().setTheme('dark') // 触发
    expect(changeCount).toBe(1)
    store.getState().setTheme('dark') // 已是 dark，不应触发
    expect(changeCount).toBe(1)
    unsub()
  })

  it('toggleTheme 在 light/dark 间反转', () => {
    const store = create<AppearanceSlice>()((...a) => ({
      ...createAppearanceSlice(...a),
    }))
    expect(store.getState().theme).toBe('light')
    store.getState().toggleTheme()
    expect(store.getState().theme).toBe('dark')
    store.getState().toggleTheme()
    expect(store.getState().theme).toBe('light')
    store.getState().toggleTheme()
    expect(store.getState().theme).toBe('dark')
  })
})
