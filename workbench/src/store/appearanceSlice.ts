/**
 * Appearance Slice · v0.15 节点 3.4
 *
 * 主题切换 store：
 * - theme: 'light' | 'dark'
 * - setTheme(theme): 切换主题，立即写入 localStorage 与 <body class>
 * - toggleTheme(): 在 light / dark 间反转
 *
 * 持久化：localStorage key = `appearance.theme`
 * 初始化：模块加载时从 localStorage 恢复；缺失时按系统 `prefers-color-scheme` 推断
 *
 * 副作用同步：
 * - setTheme 写入 store 时同步 toggle `document.body.classList`（'dark' class）
 * - 不刷新页面：CSS 变量随 .dark 选择器即时生效（180ms 过渡由 reset.css body 过渡声明）
 */

import { StateCreator } from 'zustand'

export type Theme = 'light' | 'dark'

const LOCAL_STORAGE_KEY = 'appearance.theme'

/**
 * 从 localStorage / 系统偏好推断初始 theme。
 * SSR / 测试环境无 window / matchMedia 时返回 'light'。
 */
function resolveInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  try {
    const stored = window.localStorage?.getItem(LOCAL_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // localStorage 可能在沙箱中不可用，忽略
  }
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

/**
 * 把 theme 应用到 DOM（toggle body 上的 .dark class）。
 * 单独抽出以便 store 创建时立即同步一次。
 */
function applyThemeToDom(theme: Theme): void {
  if (typeof document === 'undefined') return
  const body = document.body
  if (!body) return
  if (theme === 'dark') {
    body.classList.add('dark')
  } else {
    body.classList.remove('dark')
  }
}

function persistTheme(theme: Theme): void {
  try {
    window.localStorage?.setItem(LOCAL_STORAGE_KEY, theme)
  } catch {
    // 忽略写入失败
  }
}

export interface AppearanceSlice {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const createAppearanceSlice: StateCreator<AppearanceSlice> = (set, get) => {
  const initial = resolveInitialTheme()
  // 立即同步 DOM（保证首屏视觉与 store 一致）
  applyThemeToDom(initial)

  return {
    theme: initial,
    setTheme: (theme) => {
      if (get().theme === theme) return
      set({ theme })
      applyThemeToDom(theme)
      persistTheme(theme)
    },
    toggleTheme: () => {
      const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
      set({ theme: next })
      applyThemeToDom(next)
      persistTheme(next)
    },
  }
}
