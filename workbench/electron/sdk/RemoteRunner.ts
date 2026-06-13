/**
 * RemoteRunner — AgentRunner 的服务器端实现（v0.15 节点 6.1）
 *
 * 通过 WebSocket 连接远程 workbench-server（节点 6.0 实现），
 * 接收 SDK 事件流，通过 IPC 转发到 renderer。
 *
 * 实现 AgentRunner 接口，与 LocalRunner 对外接口完全一致。
 *
 * 注意：使用 Node.js 22+ / 24 内置全局 WebSocket（无需 ws 包），
 * TypeScript 类型由 tsconfig lib: ["DOM"] 提供。
 */
import { BrowserWindow } from 'electron'
import crypto from 'node:crypto'
import type { AgentRunner } from './AgentRunner'
import type { SDKOptions, AgentEvent } from './SDKBridge'

export interface ServerConfig {
  /** 例如 ws://your-server:3001/ws/agent */
  url: string
  /** Bearer token */
  token: string
}

type EventHandler = (...args: unknown[]) => void

export class RemoteRunner implements AgentRunner {
  private ws: WebSocket | null = null
  private sessionId: string | null = null
  private lastEventId = 0
  private listeners = new Map<string, Set<EventHandler>>()
  private reconnectAttempt = 0
  private readonly maxReconnects = 10
  private readonly reconnectDelays = [1000, 2000, 5000, 10000]
  private stopped = false

  constructor(
    private win: BrowserWindow,
    private config: ServerConfig
  ) {}

  async start(prompt: string, options?: SDKOptions): Promise<void> {
    this.stopped = false
    this.sessionId = null
    this.lastEventId = 0
    this.reconnectAttempt = 0

    return new Promise<void>((resolve, reject) => {
      this._connect(prompt, options, resolve, reject)
    })
  }

  stop(): void {
    this.stopped = true
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(handler)
  }

  private _connect(
    prompt: string,
    options: SDKOptions | undefined,
    resolve: () => void,
    reject: (err: Error) => void
  ): void {
    const ws = new WebSocket(this.config.url, {
      headers: { Authorization: `Bearer ${this.config.token}` },
    } as unknown as string[])
    this.ws = ws

    ws.addEventListener('open', () => {
      this.reconnectAttempt = 0
      ws.send(JSON.stringify({
        type: 'agent:start',
        payload: {
          prompt,
          nodeId: (options as Record<string, unknown> | undefined)?.['nodeId'] as string ?? crypto.randomUUID(),
          maxTurns: options?.maxTurns ?? 10,
        },
      }))
    })

    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as Record<string, unknown>
        if (msg['type'] === 'session:started') {
          this.sessionId = msg['sessionId'] as string
        } else if (msg['type'] === 'agent:event') {
          const event = msg['payload'] as AgentEvent
          this._send(event)
          if (event.type === 'result') {
            resolve()
          }
        } else if (msg['type'] === 'error') {
          reject(new Error(String(msg['message'])))
        }
      } catch {
        // 忽略非 JSON 消息
      }
    })

    ws.addEventListener('close', () => {
      if (this.stopped) return
      this._reconnect(prompt, options, resolve, reject)
    })

    ws.addEventListener('error', () => {
      if (this.reconnectAttempt === 0) {
        reject(new Error(`WebSocket connection failed: ${this.config.url}`))
      }
    })
  }

  private _reconnect(
    prompt: string,
    options: SDKOptions | undefined,
    resolve: () => void,
    reject: (err: Error) => void
  ): void {
    if (this.stopped || this.reconnectAttempt >= this.maxReconnects) return

    const delay = this.reconnectDelays[
      Math.min(this.reconnectAttempt, this.reconnectDelays.length - 1)
    ]
    this.reconnectAttempt++

    setTimeout(async () => {
      if (this.stopped) return
      if (this.sessionId) {
        await this._catchUp(resolve)
      }
      this._connect(prompt, options, resolve, reject)
    }, delay)
  }

  private async _catchUp(resolve: () => void): Promise<void> {
    if (!this.sessionId) return
    try {
      const httpUrl = this.config.url
        .replace(/^ws:\/\//, 'http://')
        .replace(/^wss:\/\//, 'https://')
        .replace(/\/ws\/agent$/, '')
      const res = await fetch(
        `${httpUrl}/sessions/${this.sessionId}/replay?since=${this.lastEventId}`,
        { headers: { Authorization: `Bearer ${this.config.token}` } }
      )
      const data = await res.json() as {
        events: Array<{ id: number; eventName: string; payload: unknown }>
      }
      for (const ev of data.events) {
        this.lastEventId = ev.id
        this._send(ev.payload as AgentEvent)
        if ((ev.payload as AgentEvent).type === 'result') {
          resolve()
          return
        }
      }
    } catch {
      // 忽略 catch-up 失败，继续重连
    }
  }

  private _send(event: AgentEvent): void {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send('agent:event', event)
    }
    this._emit('event', event)
  }

  private _emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((fn) => fn(...args))
  }
}
