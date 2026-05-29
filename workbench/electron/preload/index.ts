/**
 * Electron preload 脚本（v0.15 节点 1.2 — IPC 通道映射层）
 *
 * 通过 contextBridge 暴露 `window.api` 命名空间，将 renderer 的
 * window.api.xxx(args) 调用映射到 ipcRenderer.invoke('xxx', args)，
 * 并将 main process 的 webContents.send('event', payload) 事件
 * 通过 window.api.on / window.api.off 转发给 renderer。
 *
 * 原则：renderer 不直接接触 ipcRenderer，所有 IPC 都经此文件中转。
 */

import { contextBridge, ipcRenderer } from 'electron'

// ─── 事件监听注册表（channel → listener set）─────────────────────────────────
type IpcListener = (payload: unknown) => void
const listenerMap = new Map<string, Set<IpcListener>>()

function addIpcListener(channel: string, listener: IpcListener) {
  if (!listenerMap.has(channel)) {
    listenerMap.set(channel, new Set())
    // 注册一次 ipcRenderer 监听，收到后广播给所有 renderer 监听者
    ipcRenderer.on(channel, (_event, payload: unknown) => {
      listenerMap.get(channel)?.forEach((fn) => fn(payload))
    })
  }
  listenerMap.get(channel)!.add(listener)
}

function removeIpcListener(channel: string, listener: IpcListener) {
  listenerMap.get(channel)?.delete(listener)
}

// ─── API 对象（暴露给 renderer 的 window.api）────────────────────────────────
const api = {
  // 基础 invoke 通用方法（与 Tauri invoke 签名兼容）
  invoke: <T = unknown>(channel: string, args?: unknown): Promise<T> =>
    ipcRenderer.invoke(channel, args) as Promise<T>,

  // 事件监听（替代 Tauri listen，返回 unlisten 函数供 useEffect cleanup）
  // 与 Tauri listen 保持相同的调用约定：handler 接收 { payload: T }
  // 这样所有 call-site 的 (e) => e.payload 写法零修改即可运行。
  listen: <T = unknown>(
    eventName: string,
    handler: (event: { payload: T }) => void
  ): Promise<() => void> => {
    const wrapped: IpcListener = (payload) => handler({ payload: payload as T })
    addIpcListener(eventName, wrapped)
    return Promise.resolve(() => removeIpcListener(eventName, wrapped))
  },

  // 文件系统存在性检查（替代 @tauri-apps/plugin-fs exists）
  fsExists: (path: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:exists', { path }) as Promise<boolean>,

  // 占位字段（hello-world 验证）
  version: '0.15.0-dev',
  ping: () => ipcRenderer.invoke('ping') as Promise<string>,
} as const

// ─── contextBridge 注入 ───────────────────────────────────────────────────────
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (err) {
    console.error('[preload] expose window.api failed:', err)
  }
} else {
  ;(globalThis as unknown as { api: typeof api }).api = api
}

export type WindowApi = typeof api
