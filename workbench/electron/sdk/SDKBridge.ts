/**
 * SDKBridge — Electron 主进程侧 Claude Code SDK 集成（v0.15 节点 2.1 + 2.2）
 *
 * 通过子进程调用 @anthropic-ai/claude-code CLI（--output-format stream-json），
 * 将结构化 JSON 事件流转发给 renderer（webContents.send('agent:event', event)）。
 *
 * 节点 2.2：启动前从 electron-store 读取 anthropicBaseUrl，
 * 通过 process.env.ANTHROPIC_BASE_URL 注入到子进程环境变量。
 */

import { BrowserWindow } from 'electron'
import { spawn, ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import Store from 'electron-store'

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export interface SDKOptions {
  maxTurns?: number
  permissionMode?: 'auto' | 'manual'
  allowedTools?: string[]
  /** 节点 2.2 注入点：覆盖 Anthropic API Base URL */
  baseUrl?: string
}

/** agent:event IPC 事件的联合类型（renderer 侧 agentEventDispatcher 使用） */
export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; toolName: string; input: unknown; toolUseId: string }
  | { type: 'tool_result'; toolUseId: string; result: unknown }
  | { type: 'result'; finalResult: unknown }
  | { type: 'error'; message: string }
  | { type: 'raw'; data: unknown }

// ─── electron-store 设置读取 ─────────────────────────────────────────────────

type SettingsSchema = {
  'settings.anthropicBaseUrl': string
}

let _settingsStore: Store<SettingsSchema> | null = null

function getSettingsStore(): Store<SettingsSchema> {
  if (!_settingsStore) {
    _settingsStore = new Store<SettingsSchema>({
      defaults: { 'settings.anthropicBaseUrl': '' },
    })
  }
  return _settingsStore
}

function getAnthropicBaseUrl(explicitBaseUrl?: string): string | null {
  if (explicitBaseUrl && explicitBaseUrl.length > 0) return explicitBaseUrl
  const stored = getSettingsStore().get('settings.anthropicBaseUrl', '')
  return stored && stored.length > 0 ? stored : null
}

// ─── claude CLI 路径解析 ──────────────────────────────────────────────────────

function getCliBinPath(): string {
  try {
    const req = createRequire(import.meta.url)
    const pkgPath = req.resolve('@anthropic-ai/claude-code/package.json')
    const pkgDir = path.dirname(pkgPath)
    // bin/claude.exe is the native binary (cross-platform name)
    return path.join(pkgDir, 'bin', 'claude.exe')
  } catch {
    return 'claude'
  }
}

// ─── SDKBridge ────────────────────────────────────────────────────────────────

export class SDKBridge {
  private proc: ChildProcess | null = null
  private aborted = false

  constructor(private win: BrowserWindow) {}

  /**
   * 启动 Claude Code SDK，将事件流转发到 renderer。
   * 节点 2.2：启动前注入 ANTHROPIC_BASE_URL 到子进程环境。
   */
  async start(prompt: string, options: SDKOptions = {}): Promise<void> {
    this.aborted = false

    // 节点 2.2：优先用 options.baseUrl，其次读 electron-store
    const baseUrl = getAnthropicBaseUrl(options.baseUrl)

    const childEnv: NodeJS.ProcessEnv = { ...process.env }
    if (baseUrl) {
      childEnv['ANTHROPIC_BASE_URL'] = baseUrl
    }

    // 构建 CLI 参数
    const args: string[] = [
      '--print',
      '--output-format', 'stream-json',
      '--max-turns', String(options.maxTurns ?? 10),
    ]

    if (options.permissionMode === 'manual') {
      // 手动模式下不传 --dangerously-skip-permissions
    } else {
      args.push('--dangerously-skip-permissions')
    }

    if (options.allowedTools && options.allowedTools.length > 0) {
      args.push('--allowedTools', options.allowedTools.join(','))
    }

    // 最后追加 prompt（通过 stdin 传递更安全，此处用参数简化实现）
    args.push('--', prompt)

    const cliBin = getCliBinPath()

    return new Promise<void>((resolve, reject) => {
      this.proc = spawn(cliBin, args, {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let buffer = ''

      this.proc.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8')
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          this._dispatchLine(trimmed)
        }
      })

      this.proc.stderr?.on('data', (chunk: Buffer) => {
        const msg = chunk.toString('utf-8').trim()
        if (msg) {
          const event: AgentEvent = { type: 'error', message: msg }
          this._send(event)
        }
      })

      this.proc.on('close', (code) => {
        if (buffer.trim()) this._dispatchLine(buffer.trim())
        this.proc = null
        if (this.aborted) {
          resolve()
        } else if (code === 0 || code === null) {
          resolve()
        } else {
          reject(new Error(`claude-code exited with code ${code}`))
        }
      })

      this.proc.on('error', (err) => {
        this.proc = null
        reject(err)
      })
    })
  }

  /** 取消当前执行 */
  stop(): void {
    this.aborted = true
    if (this.proc) {
      this.proc.kill('SIGTERM')
      this.proc = null
    }
  }

  // ─── 私有方法 ──────────────────────────────────────────────────────────────

  private _dispatchLine(line: string): void {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      // 非 JSON 行（调试输出等），包装为 raw 事件
      this._send({ type: 'raw', data: line })
      return
    }

    const event = this._mapToAgentEvent(raw)
    this._send(event)
  }

  /**
   * 将 claude-code stream-json 输出行映射到 AgentEvent。
   * stream-json 格式参考：https://docs.anthropic.com/claude-code/sdk
   */
  private _mapToAgentEvent(raw: unknown): AgentEvent {
    if (!raw || typeof raw !== 'object') return { type: 'raw', data: raw }

    const obj = raw as Record<string, unknown>
    const type = obj['type']

    switch (type) {
      case 'assistant': {
        // content 是 ContentBlock 数组
        const contentBlocks = obj['message'] as Record<string, unknown> | undefined
        const blocks = (contentBlocks?.['content'] ?? []) as Array<Record<string, unknown>>
        for (const block of blocks) {
          if (block['type'] === 'text') {
            return { type: 'text', content: String(block['text'] ?? '') }
          }
          if (block['type'] === 'thinking') {
            return { type: 'thinking', content: String(block['thinking'] ?? '') }
          }
          if (block['type'] === 'tool_use') {
            return {
              type: 'tool_use',
              toolName: String(block['name'] ?? ''),
              input: block['input'],
              toolUseId: String(block['id'] ?? ''),
            }
          }
        }
        return { type: 'raw', data: raw }
      }
      case 'tool_result': {
        return {
          type: 'tool_result',
          toolUseId: String(obj['tool_use_id'] ?? ''),
          result: obj['content'],
        }
      }
      case 'result': {
        return { type: 'result', finalResult: obj['result'] }
      }
      default:
        return { type: 'raw', data: raw }
    }
  }

  private _send(event: AgentEvent): void {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send('agent:event', event)
    }
  }
}
