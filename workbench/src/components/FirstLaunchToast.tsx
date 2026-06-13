/**
 * FirstLaunchToast · v0.16 节点 R-5
 *
 * 首次启动自动创建默认 Vault 后的轻量通知。
 *
 * 渲染条件（场景 D 严格判定）：
 *   config !== null
 *   AND config.hasShownFirstLaunchToast === false
 *   AND lastVaultTriggerSource === 'fresh-install'
 *
 * lifecycle 一次保证机制（三道防线）：
 *   1. 跨重启权威源：hasShownFirstLaunchToast 持久化字段（store 为 true 则永不再激活）
 *   2. 本会话激活锁：activatedRef（一旦置 true 后续 store 反转不再回退可见性）
 *   3. StrictMode 双 useEffect 防御：shouldActivate 内置 !activatedRef.current 守卫
 *
 * 文案：product.md 「Toast 规格」严格对齐
 * 5s 自动 dismiss + 「打开 Settings」联动 setSettingsPanelOpen(true)
 *   （v0.16 QA 决策：R-4 SettingsView 已撤销，Vault 配置塞进 NavIcons SettingsPanel overlay）
 */

import { useEffect, useState, useRef } from 'react'
import { useStore } from '../store'
import type { VaultConfig } from '../types/vault'

export const TOAST_AUTO_DISMISS_MS = 5000

/**
 * 抽取激活判定为纯函数（便于单元测试 R5.1/R5.2 渲染条件）。
 * 场景 D 三条件必须同时满足：
 *   1. config 非 null（已 init）
 *   2. hasShownFirstLaunchToast === false（lifecycle 未触发过）
 *   3. lastVaultTriggerSource === 'fresh-install'（M-4 条件 4 命中标记）
 */
export function shouldActivateToast(
  config: VaultConfig | null,
  triggerSource: 'fresh-install' | null,
  alreadyActivated: boolean,
): boolean {
  if (alreadyActivated) return false
  if (config === null) return false
  if (config.hasShownFirstLaunchToast !== false) return false
  if (triggerSource !== 'fresh-install') return false
  return true
}

export function FirstLaunchToast() {
  const config = useStore((s) => s.vaultConfig)
  const triggerSource = useStore((s) => s.lastVaultTriggerSource)
  const activatedRef = useRef(false)
  const [visible, setVisible] = useState(false)

  const shouldActivate = shouldActivateToast(config, triggerSource, activatedRef.current)

  useEffect(() => {
    if (!shouldActivate) return
    activatedRef.current = true
    setVisible(true)
    useStore
      .getState()
      .setVaultConfig({ hasShownFirstLaunchToast: true })
      .catch((e) => {
        console.error('[FirstLaunchToast] hasShownFirstLaunchToast 置位失败:', e)
        // 失败时 activatedRef 仍为 true，本会话不再弹；下次启动 store 仍为 false 会再弹
      })
    const timer = setTimeout(() => setVisible(false), TOAST_AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [shouldActivate])

  if (!activatedRef.current && !shouldActivate) return null
  if (!visible) return null

  const vaultRoot = config?.vaultRoot ?? ''

  function handleOpenSettings() {
    const store = useStore.getState()
    store.setSettingsPanelOpen(true)
    setVisible(false)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="first-launch-toast"
      style={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        zIndex: 9999,
        background: 'var(--surface, #ffffff)',
        color: 'var(--text-1, #1f2937)',
        border: '1px solid var(--bd, #e4e4e7)',
        borderRadius: 8,
        padding: '12px 16px',
        maxWidth: 420,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        fontFamily: 'var(--font-ui, Inter, sans-serif)',
        fontSize: 13,
        lineHeight: 1.5,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <div style={{ flex: 1 }}>
        已在{' '}
        <code style={{ fontSize: 12, background: 'var(--bg, #f5f5f5)', padding: '1px 4px', borderRadius: 3 }}>
          {vaultRoot}
        </code>{' '}
        创建默认 Vault · 点输入框上的{' '}
        <button
          type="button"
          onClick={handleOpenSettings}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--accent, #2563eb)',
            cursor: 'pointer',
            padding: 0,
            font: 'inherit',
            textDecoration: 'underline',
          }}
        >
          Settings → Vault 配置
        </button>{' '}
        中更换
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="关闭通知"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-2, #71717a)',
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}
