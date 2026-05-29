/**
 * window.api 类型声明（v0.15 节点 1.3）
 *
 * 与 electron/preload/index.ts 中暴露的 api 对象保持同步。
 * 节点 1.3: 新增 fs.* 语义化文件系统 API。
 * 节点 2.1 起扩充 agent.* 接口。
 */

/** fs.* 语义化文件系统 API（节点 1.3） */
interface WindowApiFs {
  /** 读取文件内容（UTF-8） */
  read(path: string): Promise<string>
  /** 写入文件内容（原子写） */
  write(path: string, content: string): Promise<null>
  /** 列举目录内容（非递归，返回子项名称列表） */
  list(path: string): Promise<string[]>
  /** 检查路径是否存在 */
  exists(path: string): Promise<boolean>
  /** 创建目录（recursive） */
  mkdir(path: string): Promise<null>
}

/** sidecar.* Python ai-service 状态（节点 1.5） */
interface WindowApiSidecar {
  /** 查询 sidecar 是否 ready + base URL + 端口 */
  status(): Promise<{ ready: boolean; baseUrl: string; port: number }>
}

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

  /** fs 存在性检查（保持旧签名兼容）*/
  fsExists(path: string): Promise<boolean>

  /** fs.* 语义化文件系统 API（节点 1.3）*/
  fs: WindowApiFs

  /** sidecar.* Python ai-service 状态（节点 1.5）*/
  sidecar: WindowApiSidecar

  /** 占位字段 */
  readonly version: string
  ping(): Promise<string>
}

interface Window {
  api: WindowApi
}
