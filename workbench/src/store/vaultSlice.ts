/**
 * vaultSlice · v0.16 节点 R-1
 *
 * Renderer 端 vault 配置状态层。启动时通过 IPC 从 main 进程拉取 vaultConfig，
 * 订阅 `vault:config-changed` 广播实现 main → renderer 单向更新。
 *
 * 严格契约（与 technical.md r1 R-1 节点对齐）：
 * - vaultConfig: VaultConfig | null（null = IPC 未返回前的初始态，VaultBootGate 据此判定 loading）
 * - vaultConfigError: 末次 IPC 错误信息（Settings UI 排错用）
 * - vaultFallbackInfo: M-4 fallback 信息透传（R-4 Settings 显示 warning bar）
 * - lastVaultTriggerSource: M-4 条件 4（全新安装）命中时由广播附带 'fresh-install'，
 *   R-5 FirstLaunchToast 据此判定是否激活 toast；条件 1/2/3 严禁产生 triggerSource
 */

import { StateCreator } from 'zustand'
import { useStore } from './index'
import type {
  VaultConfig,
  VaultConfigWithFallback,
  VaultConfigChangedPayload,
} from '../types/vault'

export interface VaultSlice {
  vaultConfig: VaultConfig | null
  vaultConfigError: string | null
  vaultFallbackInfo: { used: boolean; reason: string } | null
  lastVaultTriggerSource: 'fresh-install' | null

  /** 应用启动时调用一次，幂等（vaultConfig !== null 时直接 return） */
  initVault: () => Promise<void>
  /** 透传 vault:set-config IPC，写入 store + 触发广播（main 端） */
  setVaultConfig: (patch: Partial<VaultConfig>) => Promise<void>

  // 内部 action（仅供 IPC 广播订阅与 init 调用）
  __applyVaultConfig: (config: VaultConfig) => void
  __applyFallbackInfo: (info: { used: boolean; reason: string }) => void
  __applyTriggerSource: (source: 'fresh-install' | null) => void
}

export const createVaultSlice: StateCreator<VaultSlice> = (set, get) => ({
  vaultConfig: null,
  vaultConfigError: null,
  vaultFallbackInfo: null,
  lastVaultTriggerSource: null,

  initVault: async () => {
    // 幂等：避免 StrictMode 双调用 / hot reload 重复拉取
    if (get().vaultConfig !== null) return
    try {
      const resp = await window.api.invoke<VaultConfigWithFallback>('vault:get-config')
      // 拆解边带 __fallbackInfo
      const { __fallbackInfo, ...config } = resp
      set({
        vaultConfig: config,
        vaultConfigError: null,
        vaultFallbackInfo: __fallbackInfo ?? { used: false, reason: '' },
      })
      // 注：initVault 不设置 lastVaultTriggerSource —— 该字段仅通过
      // vault:config-changed 广播补偿路径接收（M-3 createWindow 后触发），
      // 避免普通启动（条件 1-3）误触发
    } catch (e) {
      set({ vaultConfigError: String(e) })
    }
  },

  setVaultConfig: async (patch) => {
    try {
      const updated = await window.api.invoke<VaultConfig>('vault:set-config', patch)
      set({ vaultConfig: updated, vaultConfigError: null })
    } catch (e) {
      set({ vaultConfigError: String(e) })
      throw e
    }
  },

  __applyVaultConfig: (config) => set({ vaultConfig: config }),
  __applyFallbackInfo: (info) => set({ vaultFallbackInfo: info }),
  __applyTriggerSource: (source) => set({ lastVaultTriggerSource: source }),
})

// ─── 广播订阅（模块加载时一次性注册）─────────────────────────────────────────
//
// 复用 v0.15 既有 `window.api.listen` 通道（与 workspace:changed 同款机制），
// 不引入新便捷方法。生产环境 App 生命周期内不取消订阅；测试环境 teardown 可手动调
// returned unsubscribe（initVaultSubscription 返回值）。

let __vaultSubscription: Promise<() => void> | null = null

export function initVaultSubscription(): Promise<() => void> {
  if (__vaultSubscription) return __vaultSubscription
  __vaultSubscription = window.api.listen<VaultConfigChangedPayload>(
    'vault:config-changed',
    (event) => {
      const state = useStore.getState()
      state.__applyVaultConfig(event.payload.config)
      if (event.payload.fallbackUsed !== undefined) {
        state.__applyFallbackInfo({
          used: event.payload.fallbackUsed,
          reason: event.payload.fallbackReason ?? '',
        })
      }
      if (event.payload.triggerSource) {
        state.__applyTriggerSource(event.payload.triggerSource)
      }
    },
  )
  return __vaultSubscription
}

/** 仅供测试 teardown 使用：取消订阅并允许重新注册 */
export async function __resetVaultSubscriptionForTests(): Promise<void> {
  if (__vaultSubscription) {
    const unsubscribe = await __vaultSubscription
    unsubscribe()
    __vaultSubscription = null
  }
}

// ─── 派生 selector hook ──────────────────────────────────────────────────────

export function useVaultConfig() {
  return useStore((s) => s.vaultConfig)
}
export function useVaultConfigError() {
  return useStore((s) => s.vaultConfigError)
}
export function useVaultRoot() {
  return useStore((s) => s.vaultConfig?.vaultRoot ?? '')
}
export function useQaSubdir() {
  return useStore((s) => s.vaultConfig?.qaSubdir ?? 'QA')
}
export function useProjectsSubdir() {
  return useStore((s) => s.vaultConfig?.projectsSubdir ?? 'Projects')
}
export function useConversationsSubdir() {
  return useStore((s) => s.vaultConfig?.conversationsSubdir ?? 'Conversations')
}
export function useHasShownFirstLaunchToast() {
  return useStore((s) => s.vaultConfig?.hasShownFirstLaunchToast ?? false)
}

// ─── 非 React 上下文 getter（供 paths.ts / agentEventDispatcher 等使用）────

export function getVaultConfigSnapshot(): VaultConfig | null {
  return useStore.getState().vaultConfig
}
