/**
 * ThemeToggleButton · v0.15.1 节点 3.3
 *
 * ActivityBar 底部主题切换按钮，浅色 / 暗色瞬时切换。
 * 依赖 v0.15 节点 3.4 已实现的 appearanceSlice.toggleTheme（DOM body.classList 与 localStorage 自动同步）。
 *
 * 图标约定：dark → ☀（点亮回 light）、light → 🌙（切到 dark）
 *
 * 验证锚点：T-V151-C3（与 Settings 按钮同时存在）/ T-V151-C4（图标随主题切换）
 */

import { useStore } from '../../store'

export function ThemeToggleButton() {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)

  const icon = theme === 'dark' ? '☀' : '🌙'
  const label = theme === 'dark' ? '切换到浅色主题' : '切换到暗色主题'

  return (
    <button
      className="nav-icon-btn theme-toggle-btn"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      data-v151-node="3.3"
    >
      {icon}
    </button>
  )
}
