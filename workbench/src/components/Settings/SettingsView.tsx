/**
 * SettingsView · v0.16 节点 R-4
 *
 * P3 主工作区的 Settings 模式容器。分区顺序固化：
 *   1. Vault 配置（v0.16 新增 · 置顶）
 *   2. （未来扩展：API Keys / Theme / 其他）
 *
 * 监听 settingsSlice.activeSection 变化触发 scrollIntoView 到对应分区锚点，
 * 实现 R-5 FirstLaunchToast 「打开 Settings → Vault 配置」联动。
 */

import { useEffect } from 'react'
import { useStore } from '../../store'
import { VaultConfig } from './VaultConfig'

export function SettingsView() {
  const activeSection = useStore((s) => s.activeSection)

  useEffect(() => {
    if (!activeSection) return
    // 等下一帧渲染完成再 scroll
    const id = `settings-section-${activeSection}`
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [activeSection])

  return (
    <div
      className="settings-view"
      style={{
        height: '100%',
        overflow: 'auto',
        padding: '20px 24px',
        background: 'var(--bg, #f5f5f5)',
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>设置</h1>
      <VaultConfig />
    </div>
  )
}
