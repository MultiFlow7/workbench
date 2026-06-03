/**
 * test-setup.ts · v0.15.1 节点 4.1
 *
 * Vitest 全局测试 setup：补齐 node 环境缺失的 browser 全局对象（window / localStorage）。
 * 不引入 jsdom（T-V151-R4：本版本不引入新依赖），仅最小桩满足 store/slice 初始化需求。
 */

import { vi, beforeEach } from 'vitest'

const localStorageMock = {
  store: {} as Record<string, string>,
  getItem(k: string) { return this.store[k] ?? null },
  setItem(k: string, v: string) { this.store[k] = String(v) },
  removeItem(k: string) { delete this.store[k] },
  clear() { this.store = {} },
}

// 每个测试前清空 localStorage，避免跨测试状态污染（修复 appearanceSlice toggleTheme 因
// 上一测试遗留 'appearance.theme=dark' 导致 resolveInitialTheme 返回 'dark' 的问题）
beforeEach(() => {
  localStorageMock.store = {}
})

;(globalThis as unknown as { localStorage: typeof localStorageMock }).localStorage = localStorageMock

if (typeof (globalThis as unknown as { window?: unknown }).window === 'undefined') {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window = {
    api: { invoke: vi.fn().mockResolvedValue(undefined) },
    localStorage: localStorageMock,
  }
} else {
  const w = (globalThis as unknown as { window: Record<string, unknown> }).window
  if (!w.api) w.api = { invoke: vi.fn().mockResolvedValue(undefined) }
  if (!w.localStorage) w.localStorage = localStorageMock
}
