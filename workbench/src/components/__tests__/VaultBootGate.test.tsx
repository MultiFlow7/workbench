/**
 * VaultBootGate.test.tsx · v0.16 节点 R-3 组件测试
 *
 * 测试用例：
 * - T-V016-R3.1 loading 分支（vaultConfig=null）
 * - T-V016-R3.2 放行分支（vaultConfig 非 null）
 * - T-V016-R3.3 错误态（vaultConfig=null + error）
 * - T-V016-R3.4 vaultRoot 为空（fallback 全失败兜底）仍放行
 *
 * Mock 模式：与 AgentRunPill.test.tsx 一致，通过 vi.mock + closure mockState 控制
 * useVaultConfig / useVaultConfigError 返回值（zustand selector 在 node SSR
 * 环境下 useSyncExternalStore 不会读 setState，需要 mock）
 */

import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import type { VaultConfig } from '../../types/vault'

const mockState: {
  vaultConfig: VaultConfig | null
  vaultConfigError: string | null
} = {
  vaultConfig: null,
  vaultConfigError: null,
}

vi.mock('../../store/vaultSlice', () => ({
  useVaultConfig: () => mockState.vaultConfig,
  useVaultConfigError: () => mockState.vaultConfigError,
  initVaultSubscription: () => Promise.resolve(() => {}),
}))

vi.mock('../../store', () => ({
  useStore: { getState: () => ({ initVault: vi.fn() }) },
}))

import { VaultBootGate } from '../VaultBootGate'

const SAMPLE_CONFIG: VaultConfig = {
  vaultRoot: '/v',
  qaSubdir: 'QA',
  projectsSubdir: 'Projects',
  conversationsSubdir: 'Conversations',
  hasShownFirstLaunchToast: false,
}

describe('VaultBootGate', () => {
  it('T-V016-R3.1 loading 分支：vaultConfig=null 时显示 Loading 文本，children 不渲染', () => {
    mockState.vaultConfig = null
    mockState.vaultConfigError = null
    const html = renderToString(
      <VaultBootGate>
        <div id="child-marker">CHILD_RENDERED</div>
      </VaultBootGate>,
    )
    expect(html).toContain('Loading Vault config...')
    expect(html).not.toContain('CHILD_RENDERED')
  })

  it('T-V016-R3.2 放行分支：vaultConfig 非 null 时 children 渲染、不含 loading', () => {
    mockState.vaultConfig = SAMPLE_CONFIG
    mockState.vaultConfigError = null
    const html = renderToString(
      <VaultBootGate>
        <div id="child-marker">CHILD_RENDERED</div>
      </VaultBootGate>,
    )
    expect(html).toContain('CHILD_RENDERED')
    expect(html).not.toContain('Loading Vault config...')
  })

  it('T-V016-R3.3 错误态：vaultConfig=null + vaultConfigError 时显示错误信息', () => {
    mockState.vaultConfig = null
    mockState.vaultConfigError = 'IPC failed'
    const html = renderToString(
      <VaultBootGate>
        <div id="child-marker">CHILD_RENDERED</div>
      </VaultBootGate>,
    )
    expect(html).toContain('Vault 配置加载失败')
    expect(html).toContain('IPC failed')
    expect(html).not.toContain('CHILD_RENDERED')
  })

  it('T-V016-R3.4 vaultRoot 为空时（fallback 全失败兜底）仍放行 children', () => {
    mockState.vaultConfig = { ...SAMPLE_CONFIG, vaultRoot: '' }
    mockState.vaultConfigError = null
    const html = renderToString(
      <VaultBootGate>
        <div id="child-marker">CHILD_RENDERED</div>
      </VaultBootGate>,
    )
    expect(html).toContain('CHILD_RENDERED')
  })
})
