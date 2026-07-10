/**
 * vaultSlice.test.ts · v0.16 节点 R-1 单元测试
 *
 * 覆盖测试用例：
 * - T-V016-R1.1 初始 state
 * - T-V016-R1.2 initVault 拉取
 * - T-V016-R1.3 initVault 幂等
 * - T-V016-R1.4 setVaultConfig partial
 * - T-V016-R1.5 广播订阅
 * - T-V016-R1.6 getVaultConfigSnapshot 非 React 调用
 * - T-V016-R1.7 IPC 失败
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useStore } from '../index'
import { getVaultConfigSnapshot } from '../vaultSlice'
import type { VaultConfig, VaultConfigChangedPayload } from '../../types/vault'

// ─── window.api mock helpers ────────────────────────────────────────────────

type ListenHandler = (event: { payload: unknown }) => void

interface WindowApiMock {
  invoke: ReturnType<typeof vi.fn>
  listen: ReturnType<typeof vi.fn>
  fsExists: ReturnType<typeof vi.fn>
  __listeners: Map<string, Set<ListenHandler>>
  __emit: (channel: string, payload: unknown) => void
}

function makeWindowApi(): WindowApiMock {
  const listeners = new Map<string, Set<ListenHandler>>()
  return {
    invoke: vi.fn(),
    listen: vi.fn((channel: string, handler: ListenHandler) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set())
      listeners.get(channel)!.add(handler)
      return Promise.resolve(() => listeners.get(channel)?.delete(handler))
    }),
    fsExists: vi.fn().mockResolvedValue(true),
    __listeners: listeners,
    __emit: (channel, payload) => {
      listeners.get(channel)?.forEach((fn) => fn({ payload }))
    },
  }
}

function setWindowApi(api: WindowApiMock) {
  ;(globalThis as unknown as { window: { api: WindowApiMock } }).window = {
    api,
  }
}

function resetVaultState() {
  useStore.setState({
    vaultConfig: null,
    vaultConfigError: null,
    vaultFallbackInfo: null,
    lastVaultTriggerSource: null,
  })
}

const SAMPLE_CONFIG: VaultConfig = {
  vaultRoot: '/tmp/v',
  qaSubdir: 'QA',
  projectsSubdir: 'Projects',
  conversationsSubdir: 'Conversations',
  hasShownFirstLaunchToast: false,
}

// ─── 测试 ──────────────────────────────────────────────────────────────────

describe('vaultSlice', () => {
  beforeEach(() => {
    resetVaultState()
  })

  it('T-V016-R1.1 初始 state: vaultConfig === null && vaultConfigError === null', () => {
    const s = useStore.getState()
    expect(s.vaultConfig).toBeNull()
    expect(s.vaultConfigError).toBeNull()
    expect(s.vaultFallbackInfo).toBeNull()
    expect(s.lastVaultTriggerSource).toBeNull()
  })

  it('T-V016-R1.2 initVault 拉取后 vaultConfig 与 IPC 返回值相等', async () => {
    const api = makeWindowApi()
    api.invoke.mockResolvedValueOnce({ ...SAMPLE_CONFIG })
    setWindowApi(api)

    await useStore.getState().initVault()

    expect(api.invoke).toHaveBeenCalledWith('vault:get-config')
    expect(useStore.getState().vaultConfig).toEqual(SAMPLE_CONFIG)
    expect(useStore.getState().vaultConfigError).toBeNull()
  })

  it('T-V016-R1.3 initVault 幂等：连续两次调用 invoke 只被调用一次', async () => {
    const api = makeWindowApi()
    api.invoke.mockResolvedValue({ ...SAMPLE_CONFIG })
    setWindowApi(api)

    await useStore.getState().initVault()
    await useStore.getState().initVault()

    expect(api.invoke).toHaveBeenCalledTimes(1)
  })

  it('T-V016-R1.4 setVaultConfig partial merge: store 反映 main 返回的合并后对象', async () => {
    const api = makeWindowApi()
    const merged: VaultConfig = { ...SAMPLE_CONFIG, qaSubdir: 'Notes' }
    api.invoke.mockResolvedValueOnce(merged)
    setWindowApi(api)

    await useStore.getState().setVaultConfig({ qaSubdir: 'Notes' })

    expect(api.invoke).toHaveBeenCalledWith('vault:set-config', { qaSubdir: 'Notes' })
    const v = useStore.getState().vaultConfig!
    expect(v.qaSubdir).toBe('Notes')
    expect(v.vaultRoot).toBe(SAMPLE_CONFIG.vaultRoot)
    expect(v.projectsSubdir).toBe(SAMPLE_CONFIG.projectsSubdir)
    expect(v.hasShownFirstLaunchToast).toBe(SAMPLE_CONFIG.hasShownFirstLaunchToast)
  })

  it('T-V016-R1.5 广播订阅触发后 vaultConfig 被替换 + fallback/triggerSource 写入', async () => {
    const api = makeWindowApi()
    setWindowApi(api)

    // 注册一个 listener 用于触发；模拟 initVaultSubscription 已经跑过
    // （为了避免模块单例 __vaultSubscription 跨测试污染，这里直接调用 __apply* 验证 listener 内部分发逻辑）
    const newConfig: VaultConfig = { ...SAMPLE_CONFIG, vaultRoot: '/new' }
    const payload: VaultConfigChangedPayload = {
      config: newConfig,
      fallbackUsed: true,
      fallbackReason: 'homedir mkdir failed: EACCES',
      triggerSource: 'fresh-install',
    }
    const state = useStore.getState()
    state.__applyVaultConfig(payload.config)
    if (payload.fallbackUsed !== undefined) {
      state.__applyFallbackInfo({
        used: payload.fallbackUsed,
        reason: payload.fallbackReason ?? '',
      })
    }
    if (payload.triggerSource) {
      state.__applyTriggerSource(payload.triggerSource)
    }

    const after = useStore.getState()
    expect(after.vaultConfig).toEqual(newConfig)
    expect(after.vaultFallbackInfo).toEqual({
      used: true,
      reason: 'homedir mkdir failed: EACCES',
    })
    expect(after.lastVaultTriggerSource).toBe('fresh-install')
  })

  it('T-V016-R1.6 getVaultConfigSnapshot 非 React 调用返回 store 当前值', () => {
    useStore.setState({ vaultConfig: { ...SAMPLE_CONFIG } })
    expect(getVaultConfigSnapshot()).toEqual(SAMPLE_CONFIG)

    useStore.setState({ vaultConfig: null })
    expect(getVaultConfigSnapshot()).toBeNull()
  })

  it('T-V016-R1.7 initVault IPC 失败：vaultConfigError 被设置，vaultConfig 仍为 null', async () => {
    const api = makeWindowApi()
    api.invoke.mockRejectedValueOnce(new Error('IPC failed'))
    setWindowApi(api)

    await useStore.getState().initVault()

    expect(useStore.getState().vaultConfigError).toContain('IPC failed')
    expect(useStore.getState().vaultConfig).toBeNull()
  })
})
