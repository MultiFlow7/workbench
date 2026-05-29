/**
 * Electron preload 脚本（v0.15 节点 1.1 占位）
 *
 * 通过 contextBridge 暴露 `window.api` 命名空间。
 * 节点 1.1 阶段仅放占位字段（version + ping），后续节点逐项加 IPC 接口：
 *   - 节点 1.2：通用 invoke 通道
 *   - 节点 1.3：fs.* （read/write/list/exists/mkdir）
 *   - 节点 1.4：dialog.pickFolder
 *   - 节点 1.5：service-ready 事件订阅
 *   - 节点 2.1 起：agent:start / agent:event / agent:pause / agent:resume
 */

import { contextBridge } from 'electron'

const api = {
  /** 占位字段，节点 1.2 替换为真实 IPC 通道 */
  version: '0.15.0-dev',
  ping: () => 'pong',
} as const

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (err) {
    console.error('[preload] expose window.api failed:', err)
  }
} else {
  // 仅在异常配置下生效（contextIsolation 默认 true，不应走到这里）
  ;(globalThis as unknown as { api: typeof api }).api = api
}

export type WindowApi = typeof api
