/**
 * LocalRunner — AgentRunner 的本地实现（v0.15 节点 2.6）
 *
 * 内部包装 SDKBridge，通过 @anthropic-ai/claude-code CLI 子进程
 * 在用户本机执行 Claude Code SDK。
 *
 * 事件通过 BrowserWindow.webContents.send('agent:event', ...) 推送到 renderer，
 * on() 方法额外支持主进程内部逻辑监听（如日志、统计等）。
 */

import { BrowserWindow } from 'electron'
import { SDKBridge } from './SDKBridge'
import type { SDKOptions, AgentEvent } from './SDKBridge'
import type { AgentRunner } from './AgentRunner'

type EventHandler = (...args: unknown[]) => void

export class LocalRunner implements AgentRunner {
  private bridge: SDKBridge
  private listeners = new Map<string, Set<EventHandler>>()

  constructor(win: BrowserWindow) {
    this.bridge = new SDKBridge(win)
  }

  async start(prompt: string, options?: SDKOptions): Promise<void> {
    this._emit('start', prompt, options)
    try {
      await this.bridge.start(prompt, options ?? {})
      this._emit('done')
    } catch (err) {
      this._emit('error', err)
      throw err
    }
  }

  stop(): void {
    this.bridge.stop()
    this._emit('stopped')
  }

  on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler)
  }

  off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler)
  }

  private _emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((fn) => fn(...args))
  }
}

// Re-export AgentEvent type for consumers
export type { AgentEvent }
