/**
 * SDKBridge — Electron 主进程侧 Claude Code SDK 集成（v0.15 节点 5.1）
 *
 * 切换为 programmatic query() 模式（@anthropic-ai/claude-agent-sdk）。
 * 注册 hooks.PreToolUse 实现暂停/干预机制。
 *
 * 节点 2.2：启动前从 electron-store 读取 anthropicBaseUrl，
 * 通过 process.env.ANTHROPIC_BASE_URL 注入。
 *
 * 节点 5.1：PreToolUse hook 暂停机制（pause/resume）。
 */

import { BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import Store from 'electron-store'

// ─── SDK 动态导入（ESM .mjs，避免 electron-vite CJS 转换问题）──────────────────
// 使用 createRequire 动态 require，规避 top-level await 约束

type SDKModule = typeof import('@anthropic-ai/claude-agent-sdk')
let _sdkModule: SDKModule | null = null

async function getSdk(): Promise<SDKModule> {
  if (_sdkModule) return _sdkModule
  const req = createRequire(import.meta.url)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _sdkModule = req('@anthropic-ai/claude-agent-sdk') as SDKModule
  return _sdkModule
}

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export interface SDKOptions {
  maxTurns?: number
  permissionMode?: 'auto' | 'manual'
  allowedTools?: string[]
  /** 节点 2.2 注入点：覆盖 Anthropic API Base URL */
  baseUrl?: string
  /**
   * v0.15.1 P5 r14：覆盖 ANTHROPIC_API_KEY 环境变量。
   * 由 agent:start handler 按 model 从 settings.apiKeys 反查后注入。
   * 没传时维持 process.env.ANTHROPIC_API_KEY（兼容用户在 shell 里手动 export 的场景）。
   */
  apiKey?: string
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
  | { type: 'paused'; toolUseId: string }  // 节点 5.1：agent 已暂停等待干预

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

// ─── SDKBridge ────────────────────────────────────────────────────────────────

export class SDKBridge {
  private _query: import('@anthropic-ai/claude-agent-sdk').Query | null = null
  private _aborted = false
  private _pauseRequested = false
  private _resumeResolve: ((interventionText: string | null) => void) | null = null

  constructor(private win: BrowserWindow) {}

  /**
   * 启动 Claude Code SDK（programmatic query() 模式）。
   * 注册 PreToolUse hook 实现暂停/干预机制。
   */
  async start(prompt: string, options: SDKOptions = {}): Promise<void> {
    this._aborted = false
    this._pauseRequested = false
    this._resumeResolve = null

    const baseUrl = getAnthropicBaseUrl(options.baseUrl)
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v
    }
    if (baseUrl) env['ANTHROPIC_BASE_URL'] = baseUrl
    // v0.15.1 P5 r14：注入 API key。claude CLI 子进程不继承 renderer 的 settings.apiKeys，
    // 必须显式通过 env 传递。优先用 options.apiKey（agent:start handler 已按 model 反查），
    // 否则保持 process.env.ANTHROPIC_API_KEY（兼容 shell export 场景）。
    if (options.apiKey && options.apiKey.length > 0) {
      env['ANTHROPIC_API_KEY'] = options.apiKey
    }

    const sdk = await getSdk()

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this

    this._query = sdk.query({
      prompt,
      options: {
        maxTurns: options.maxTurns ?? 10,
        // permissionMode 映射：'auto' → bypassPermissions，'manual' → default
        permissionMode: options.permissionMode === 'manual' ? 'default' : 'bypassPermissions',
        allowedTools: options.allowedTools,
        env,
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async (input: import('@anthropic-ai/claude-agent-sdk').HookInput) => {
                  // 类型收窄：仅处理 PreToolUse 事件
                  if (input.hook_event_name !== 'PreToolUse') {
                    return {}
                  }
                  const preInput = input as import('@anthropic-ai/claude-agent-sdk').PreToolUseHookInput

                  // 广播 tool_use 事件到 renderer
                  self._send({
                    type: 'tool_use',
                    toolName: preInput.tool_name,
                    input: preInput.tool_input,
                    toolUseId: preInput.tool_use_id,
                  })

                  // 如果被请求暂停，等待 resume
                  if (self._pauseRequested) {
                    self._pauseRequested = false
                    self._send({ type: 'paused', toolUseId: preInput.tool_use_id })
                    const interventionText = await new Promise<string | null>((resolve) => {
                      self._resumeResolve = resolve
                    })
                    return {
                      hookSpecificOutput: {
                        hookEventName: 'PreToolUse' as const,
                        additionalContext: interventionText ?? undefined,
                      },
                    }
                  }

                  return {
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                    },
                  }
                },
              ],
            },
          ],
        },
      },
    })

    try {
      for await (const msg of this._query) {
        if (this._aborted) break
        this._dispatchMessage(msg)
      }
    } finally {
      this._query = null
    }
  }

  /** 请求在下一个 tool_use 前暂停 */
  pause(): void {
    this._pauseRequested = true
  }

  /** 提交干预文本并恢复 agent loop */
  resume(interventionText: string | null): void {
    if (this._resumeResolve) {
      this._resumeResolve(interventionText)
      this._resumeResolve = null
    }
  }

  /** 取消当前执行 */
  stop(): void {
    this._aborted = true
    // interrupt() 是异步的，fire-and-forget
    if (this._query) {
      this._query.interrupt().catch(() => {})
      this._query = null
    }
    // 如果挂在 pause，也 resolve 一下
    if (this._resumeResolve) {
      this._resumeResolve(null)
      this._resumeResolve = null
    }
  }

  // ─── 私有方法 ──────────────────────────────────────────────────────────────

  /**
   * 将 SDKMessage 映射到 AgentEvent 并发送。
   *
   * SDKMessage 包含多种子类型；关键类型：
   *   SDKAssistantMessage: { type: 'assistant', message: BetaMessage }
   *   SDKUserMessage:      { type: 'user', message: MessageParam }（含 tool_result）
   *   SDKResultMessage:    { type: 'result', ... }
   *
   * 注意：tool_use 由 PreToolUse hook 已广播，此处 assistant 消息中
   * 的 tool_use block 不重复发送。
   */
  private _dispatchMessage(msg: import('@anthropic-ai/claude-agent-sdk').SDKMessage): void {
    const obj = msg as Record<string, unknown>
    const type = obj['type']

    switch (type) {
      case 'assistant': {
        // BetaMessage.content: BetaContentBlock[]
        const message = obj['message'] as Record<string, unknown> | undefined
        const blocks = (message?.['content'] ?? []) as Array<Record<string, unknown>>
        for (const block of blocks) {
          if (block['type'] === 'text') {
            this._send({ type: 'text', content: String(block['text'] ?? '') })
          } else if (block['type'] === 'thinking') {
            this._send({ type: 'thinking', content: String(block['thinking'] ?? '') })
          }
          // tool_use block 已由 PreToolUse hook 广播，跳过
        }
        break
      }
      case 'user': {
        // SDKUserMessage: MessageParam 可能含 tool_result content
        const message = obj['message'] as Record<string, unknown> | undefined
        const content = message?.['content']
        if (Array.isArray(content)) {
          for (const block of content as Array<Record<string, unknown>>) {
            if (block['type'] === 'tool_result') {
              this._send({
                type: 'tool_result',
                toolUseId: String(block['tool_use_id'] ?? ''),
                result: block['content'],
              })
            }
          }
        }
        break
      }
      case 'result': {
        this._send({ type: 'result', finalResult: obj['result'] })
        break
      }
      // 其他 SDKMessage 子类型（status、hook_started 等）忽略
      default:
        break
    }
  }

  private _send(event: AgentEvent): void {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send('agent:event', event)
    }
  }
}
