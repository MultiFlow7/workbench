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

/** agent.* Claude Code SDK 代理控制（节点 2.1 + 2.6） */
interface WindowApiAgentOptions {
  maxTurns?: number
  permissionMode?: 'auto' | 'manual'
  allowedTools?: string[]
  /** 覆盖 Anthropic API Base URL（节点 2.2） */
  baseUrl?: string
}

/** agent:event IPC 事件联合类型 */
type AgentEventPayload =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; toolName: string; input: unknown; toolUseId: string }
  | { type: 'tool_result'; toolUseId: string; result: unknown }
  | { type: 'result'; finalResult: unknown }
  | { type: 'error'; message: string }
  | { type: 'raw'; data: unknown }
  | { type: 'paused'; toolUseId: string }  // 节点 5.1：agent 已暂停等待干预

interface WindowApiAgent {
  /** 启动 agent，进度事件通过 onEvent 回调推送 */
  start(prompt: string, options?: WindowApiAgentOptions): Promise<null>
  /** 取消当前 agent 执行 */
  stop(): Promise<null>
  /** 订阅 agent 事件，返回 unlisten 函数 */
  onEvent(handler: (event: AgentEventPayload) => void): () => void
  /** 暂停 agent（下一个工具执行前生效，节点 5.2）*/
  pause(): Promise<null>
  /** 恢复 agent 执行，可选注入补充指令（节点 5.2）*/
  resume(text: string | null): Promise<null>
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

  /** agent.* Claude Code SDK 代理控制（节点 2.1 + 2.6）*/
  agent: WindowApiAgent

  /** 占位字段 */
  readonly version: string
  ping(): Promise<string>
}

interface Window {
  api: WindowApi
}
