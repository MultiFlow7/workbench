/**
 * AgentRunner 接口（v0.15 节点 2.6）
 *
 * 定义 Electron 主进程侧 Agent 执行抽象。
 * LocalRunner 实现使用 SDKBridge 在本地运行 Claude Code SDK。
 * 后续 Phase 6 将实现 RemoteRunner，通过 WebSocket 连接远程 server。
 */

import type { SDKOptions } from './SDKBridge'

export interface AgentRunner {
  /** 启动 agent，返回 Promise（agent 完成时 resolve，被取消时也 resolve） */
  start(prompt: string, options?: SDKOptions): Promise<void>

  /** 取消当前执行 */
  stop(): void

  /** 注册事件监听（供主进程内部逻辑使用，renderer 事件通过 IPC 推送） */
  on(event: string, handler: (...args: unknown[]) => void): void
}
