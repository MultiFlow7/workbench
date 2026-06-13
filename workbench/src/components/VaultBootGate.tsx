/**
 * VaultBootGate · v0.16 节点 R-3
 *
 * 挂在 App 入口顶层，等待 vaultSlice 通过 IPC 拿到 vaultConfig 后再渲染 children。
 * 避免 paths.ts 消费方在 vaultConfig=null 时读到空路径触发后续 IPC 报错。
 *
 * Loading UI 边界（product.md「不在本版本范围」明确）：
 * - 不做 splash / 启动动画 / 品牌 logo / spinner
 * - 仅一行文字 + 居中
 * - 错误态显示明确错误信息（便于截图反馈），不弹 modal
 *
 * 兜底：config 非 null 即放行，即使 vaultRoot 为空（M-4 fallback 全失败的极端场景）也放行，
 * 让用户能进 Settings 手动配置，避免死锁。
 */

import { useEffect } from 'react'
import { useStore } from '../store'
import {
  useVaultConfig,
  useVaultConfigError,
  initVaultSubscription,
} from '../store/vaultSlice'

interface VaultBootGateProps {
  children: React.ReactNode
}

export function VaultBootGate({ children }: VaultBootGateProps) {
  const config = useVaultConfig()
  const error = useVaultConfigError()

  useEffect(() => {
    // 注册 vault:config-changed 广播订阅（幂等，模块内单例）
    initVaultSubscription().catch((e) => {
      console.error('[VaultBootGate] initVaultSubscription failed:', e)
    })
    // 幂等：vaultSlice.initVault 内部已有 vaultConfig !== null 短路
    useStore.getState().initVault()
  }, [])

  if (config === null) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="vault-boot-gate-loading"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--text-2)',
          fontFamily: 'var(--font-ui, Inter, sans-serif)',
          fontSize: '14px',
          background: 'var(--bg)',
        }}
      >
        {error ? `Vault 配置加载失败：${error}` : 'Loading Vault config...'}
      </div>
    )
  }

  return <>{children}</>
}
