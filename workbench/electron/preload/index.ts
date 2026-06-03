/**
 * Electron preload 脚本（v0.15 节点 1.3 — fs IPC 扩展）
 *
 * 通过 contextBridge 暴露 `window.api` 命名空间，将 renderer 的
 * window.api.xxx(args) 调用映射到 ipcRenderer.invoke('xxx', args)，
 * 并将 main process 的 webContents.send('event', payload) 事件
 * 通过 window.api.on / window.api.off 转发给 renderer。
 *
 * 原则：renderer 不直接接触 ipcRenderer，所有 IPC 都经此文件中转。
 * 文件系统操作全部通过语义化 window.api.fs.* 方法，不直接暴露 fs 模块。
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
  // 保留旧签名以兼容现有 ChatView 调用（window.api.fsExists）
  fsExists: (path: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:exists', { path }) as Promise<boolean>,

  // ── fs.* 语义化文件系统 API（节点 1.3）──────────────────────────────────
  // 所有路径在 main process 经 path.resolve 规范化并做 workspace 越界校验。
  // renderer 不直接接触 Node.js fs 模块。
  fs: {
    /** 读取文件内容（UTF-8） */
    read: (path: string): Promise<string> =>
      ipcRenderer.invoke('fs:read', { path }) as Promise<string>,

    /** 写入文件内容（原子写：tmp → rename，避免写入中断产生损坏文件） */
    write: (path: string, content: string): Promise<null> =>
      ipcRenderer.invoke('fs:write', { path, content }) as Promise<null>,

    /** 列举目录内容（非递归，返回子项名称列表） */
    list: (path: string): Promise<string[]> =>
      ipcRenderer.invoke('fs:list', { path }) as Promise<string[]>,

    /** 检查路径是否存在 */
    exists: (path: string): Promise<boolean> =>
      ipcRenderer.invoke('fs:exists', { path }) as Promise<boolean>,

    /** 创建目录（recursive，已存在不报错） */
    mkdir: (path: string): Promise<null> =>
      ipcRenderer.invoke('fs:mkdir', { path }) as Promise<null>,
  },

  // ── sidecar.* Python ai-service 状态查询（节点 1.5）─────────────────────
  // renderer 通过 listen('service-ready' | 'service-error' | 'service-exit', cb)
  // 订阅事件；同步查询当前状态可调 sidecar.status()。
  sidecar: {
    /** 查询 sidecar 是否已 ready（首次 health probe 通过后为 true） */
    status: (): Promise<{ ready: boolean; baseUrl: string; port: number }> =>
      ipcRenderer.invoke('sidecar:status') as Promise<{
        ready: boolean
        baseUrl: string
        port: number
      }>,
  },

  // ── agent.* Claude Code SDK 代理控制（节点 2.1 / 2.6）────────────────────
  // renderer 通过 window.api.agent.start() 启动 agent，
  // 通过 window.api.agent.onEvent(cb) 订阅流式事件。
  agent: {
    /**
     * 启动 agent。prompt 为用户指令；options 为可选配置。
     * location 选择本地（默认）或远程服务器执行；remote 时需提供 serverConfig。
     * 立即返回 null——进度事件通过 onEvent 回调推送。
     */
    start: (
      prompt: string,
      options?: {
        maxTurns?: number
        permissionMode?: 'auto' | 'manual'
        allowedTools?: string[]
        baseUrl?: string
        /**
         * v0.15.1 P5 r14：当前选中的 model 名，main 进程据此从 settings.apiKeys 反查
         * apiKey + baseUrl 注入到 SDKBridge env。
         */
        model?: string
        location?: 'local' | 'remote'
        serverConfig?: { url: string; token: string }
      }
    ): Promise<null> => {
      const { location, serverConfig, model, ...sdkOptions } = options ?? {}
      return ipcRenderer.invoke('agent:start', {
        prompt,
        options: sdkOptions,
        model,
        location,
        serverConfig,
      }) as Promise<null>
    },

    /**
     * 取消当前正在执行的 agent。
     */
    stop: (): Promise<null> =>
      ipcRenderer.invoke('agent:stop') as Promise<null>,

    /**
     * 请求在下一个 tool_use 前暂停（节点 5.3）。
     * 主进程收到后设置 pauseRequested 标志；下一次 PreToolUse hook 触发时暂停。
     */
    pause: (): Promise<null> =>
      ipcRenderer.invoke('agent:pause') as Promise<null>,

    /**
     * 提交干预文本并恢复 agent loop（节点 5.3）。
     * interventionText 为 null 时表示无干预，直接恢复。
     */
    resume: (interventionText: string | null): Promise<null> =>
      ipcRenderer.invoke('agent:resume', { interventionText }) as Promise<null>,

    /**
     * 订阅 agent 事件（text / thinking / tool_use / tool_result / result / error / paused）。
     * 返回 unlisten 函数，在 useEffect cleanup 中调用以避免内存泄漏。
     */
    onEvent: <T = unknown>(
      handler: (event: T) => void
    ): (() => void) => {
      const listener: IpcListener = (payload) => handler(payload as T)
      addIpcListener('agent:event', listener)
      return () => removeIpcListener('agent:event', listener)
    },
  },

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
