/**
 * Vault IPC Handlers（v0.16 节点 M-2，req-063）
 *
 * 注册 4 个 IPC channel：
 *   - `vault:get-config`      renderer → main，返回完整 4 字段 + 边带 __fallbackInfo
 *   - `vault:set-config`      renderer → main，partial merge + 广播
 *   - `vault:pick-folder`     renderer → main，调系统文件夹选择对话框，不写 store
 *   - `vault:config-changed`  main → renderer 广播（由 set-config / M-3 补偿广播触发）
 *
 * 设计：独立成文件而非塞进 handlers.ts，因为 vault 是 v0.16 新增独立子域。
 * 风格参照 v0.15 handlers.ts 的 dialog:pickFolder + workspace:changed 广播链路。
 */

import { BrowserWindow, dialog, ipcMain } from 'electron'
import {
  getVaultConfig,
  setVaultConfig,
  type VaultConfig,
} from '../store/vaultStore'
import { getLastFallbackInfo, getLastTriggerSource } from '../main/vaultBootstrap'

/**
 * 广播 vault 配置变化到所有 BrowserWindow。
 * 供 M-2 set-config handler 与 M-3 补偿广播逻辑共用。
 */
export function broadcastVaultConfigChanged(payload: {
  config: VaultConfig
  fallbackUsed?: boolean
  fallbackReason?: string
  triggerSource?: 'fresh-install'
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('vault:config-changed', payload)
    }
  }
}

export function registerVaultIpc(): void {
  // ── vault:get-config ────────────────────────────────────────────────────
  // 返回完整 4 字段 + 边带 __fallbackInfo（非持久化、仅响应有效）。
  ipcMain.handle('vault:get-config', () => {
    try {
      const config = getVaultConfig()
      const fallbackInfo = getLastFallbackInfo()
      return { ...config, __fallbackInfo: fallbackInfo }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`vault config read failed: ${msg}`)
    }
  })

  // ── vault:set-config ────────────────────────────────────────────────────
  // partial merge → 返回合并后的完整对象 → 广播 vault:config-changed。
  ipcMain.handle('vault:set-config', (_e, patch: Partial<VaultConfig>) => {
    try {
      const merged = setVaultConfig(patch ?? {})
      broadcastVaultConfigChanged({ config: merged })
      return merged
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`vault config write failed: ${msg}`)
    }
  })

  // ── vault:pick-folder ───────────────────────────────────────────────────
  // 弹出系统目录选择对话框。用户取消时返回 null。
  // 注意：本 handler 不直接写入 store——renderer 拿到路径后再调 vault:set-config。
  ipcMain.handle(
    'vault:pick-folder',
    async (_e, options?: { title?: string }) => {
      const title = options?.title ?? '选择 Vault 根目录'
      const focused =
        BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      try {
        const result = focused
          ? await dialog.showOpenDialog(focused, {
              properties: ['openDirectory'],
              title,
            })
          : await dialog.showOpenDialog({
              properties: ['openDirectory'],
              title,
            })
        if (result.canceled || result.filePaths.length === 0) return null
        return result.filePaths[0]
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new Error(`vault pick-folder failed: ${msg}`)
      }
    }
  )
}

/**
 * 测试钩子：返回当前已注册的 channel 列表（仅供 integration test 使用）。
 * 通过 ipcMain.eventNames 内省 — 不影响生产行为。
 */
export function __getRegisteredChannelsForTesting(): string[] {
  return (ipcMain.eventNames() as string[]).filter((n) => typeof n === 'string')
}

/**
 * 在 M-3 补偿广播路径中复用：拿到首个 BrowserWindow 后立即发一次 vault:config-changed，
 * 把 fallbackUsed / triggerSource 信息送达 renderer（兜底 renderer 错过 init 的场景）。
 */
export function sendCompensationBroadcast(win: BrowserWindow): void {
  const fallback = getLastFallbackInfo()
  const source = getLastTriggerSource()
  if (!fallback.used && source === null) return
  const payload: {
    config: VaultConfig
    fallbackUsed?: boolean
    fallbackReason?: string
    triggerSource?: 'fresh-install'
  } = { config: getVaultConfig() }
  if (fallback.used) {
    payload.fallbackUsed = true
    payload.fallbackReason = fallback.reason
  }
  if (source !== null) {
    payload.triggerSource = source
  }
  if (!win.isDestroyed()) {
    win.webContents.send('vault:config-changed', payload)
  }
}
