/**
 * window.api 类型声明（v0.15 节点 1.2）
 *
 * 与 electron/preload/index.ts 中暴露的 api 对象保持同步。
 * 节点 1.3 起扩充 fs.* / dialog.* 等；节点 2.1 起扩充 agent.* 接口。
 */

interface WindowApi {
  /** 通用 invoke（替代 Tauri invoke）*/
  invoke<T = unknown>(channel: string, args?: unknown): Promise<T>

  /** 事件监听（替代 Tauri listen；返回 Promise<unlisten>）
   *  与 Tauri 保持相同约定：handler 收到 { payload: T }
   */
  listen<T = unknown>(
    eventName: string,
    handler: (event: { payload: T }) => void
  ): Promise<() => void>

  /** fs 存在性检查（替代 @tauri-apps/plugin-fs exists）*/
  fsExists(path: string): Promise<boolean>

  /** 占位字段 */
  readonly version: string
  ping(): Promise<string>
}

interface Window {
  api: WindowApi
}
