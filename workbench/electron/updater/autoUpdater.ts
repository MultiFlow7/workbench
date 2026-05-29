/**
 * electron-updater 集成（v0.15 节点 1.6）
 *
 * 职责：
 *  - 仅在 packaged 应用启动时调用 `checkForUpdatesAndNotify()`
 *  - 通过 update:* 事件向 renderer 广播状态（available / downloaded / error）
 *  - dev 模式直接 no-op（避免本地 dev 触发误更新）
 *
 * Publish provider 由 electron-builder 配置决定（默认 GitHub Releases）。
 * 配置存在于 workbench/electron-builder.yml -> publish 段。
 *
 * renderer 侧 UI（节点 4.x 通知 banner）订阅事件：
 *   window.api.listen('update:available',  (e) => { e.payload: { version: string } })
 *   window.api.listen('update:downloaded', (e) => { e.payload: { version: string } })
 *   window.api.listen('update:error',      (e) => { e.payload: { message: string } })
 */

import { app, BrowserWindow } from 'electron'

let _initialized = false

export function initAutoUpdater(): void {
  if (_initialized) return
  _initialized = true

  // dev 模式跳过：electron-updater 在未签名 / 未打包应用上会直接 fail
  if (!app.isPackaged) {
    console.log('[updater] skipped in dev mode')
    return
  }

  // 动态 require：electron-updater 仅在 packaged build 内可用，
  // 避免 dev 模式 import 时触发 file://app-update.yml 缺失警告。
  // 使用 eval('require') 绕过 electron-vite bundle 静态分析，
  // 保证 dev 模式即便未安装 electron-updater 也不会编译失败。
  type AutoUpdaterLike = {
    on(event: string, listener: (...args: unknown[]) => void): void
    checkForUpdatesAndNotify(): Promise<unknown>
    logger?: unknown
  }
  let autoUpdater: AutoUpdaterLike
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = (eval('require') as NodeRequire)('electron-updater') as {
      autoUpdater: AutoUpdaterLike
    }
    autoUpdater = mod.autoUpdater
  } catch (err) {
    console.error('[updater] electron-updater module not available:', err)
    return
  }

  autoUpdater.on('update-available', (info: unknown) => {
    const version = (info as { version?: string } | undefined)?.version ?? 'unknown'
    console.log(`[updater] update-available: ${version}`)
    broadcast('update:available', { version })
  })

  autoUpdater.on('update-downloaded', (info: unknown) => {
    const version = (info as { version?: string } | undefined)?.version ?? 'unknown'
    console.log(`[updater] update-downloaded: ${version}`)
    broadcast('update:downloaded', { version })
  })

  autoUpdater.on('error', (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[updater] error:', message)
    broadcast('update:error', { message })
  })

  void autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[updater] checkForUpdatesAndNotify failed:', err)
  })
}

function broadcast(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) {
      w.webContents.send(channel, payload)
    }
  })
}
