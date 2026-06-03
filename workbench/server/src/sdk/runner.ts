import { query } from '@anthropic-ai/claude-agent-sdk'
import { WebSocket } from 'ws'
import { persistence } from '../persistence/sqlite.js'
import { trackSession, untrackSession } from '../checkpoint/scheduler.js'
import crypto from 'node:crypto'

export interface RunnerOptions {
  prompt: string
  nodeId: string
  maxTurns?: number
  baseUrl?: string
}

export async function runSession(
  options: RunnerOptions,
  /** 当前连接的 WebSocket 集合（可为空） */
  clients: Set<WebSocket>
): Promise<string> {
  const sessionId = crypto.randomUUID()
  persistence.createSession(sessionId, options.nodeId)
  trackSession(sessionId)

  const env: Record<string, string> = { ...process.env as Record<string, string> }
  if (options.baseUrl) env['ANTHROPIC_BASE_URL'] = options.baseUrl

  const q = query({
    prompt: options.prompt,
    options: {
      maxTurns: options.maxTurns ?? 10,
      permissionMode: 'bypassPermissions',
      env,
    },
  })

  try {
    for await (const msg of q) {
      const obj = msg as Record<string, unknown>
      const type = obj['type'] as string
      const eventName = mapMsgTypeToEventName(type, obj)
      if (!eventName) continue

      const payload = extractPayload(type, obj)
      persistence.appendEvent(sessionId, eventName, payload)

      // 广播到已连接客户端
      const wsMsg = JSON.stringify({ type: 'agent:event', event: eventName, payload })
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(wsMsg)
        }
      }

      if (eventName === 'result') {
        persistence.completeSession(sessionId)
        break
      }
    }
  } catch (err) {
    persistence.completeSession(sessionId, String(err))
  } finally {
    untrackSession(sessionId)
  }

  return sessionId
}

function mapMsgTypeToEventName(type: string, obj: Record<string, unknown>): string | null {
  switch (type) {
    case 'assistant': {
      const blocks = ((obj['message'] as Record<string, unknown>)?.['content'] ?? []) as Array<Record<string, unknown>>
      for (const b of blocks) {
        if (b['type'] === 'text') return 'text'
        if (b['type'] === 'thinking') return 'thinking'
        if (b['type'] === 'tool_use') return 'tool_use'
      }
      return null
    }
    case 'user': {
      const content = ((obj['message'] as Record<string, unknown>)?.['content'])
      if (Array.isArray(content)) {
        for (const b of content as Array<Record<string, unknown>>) {
          if (b['type'] === 'tool_result') return 'tool_result'
        }
      }
      return null
    }
    case 'result': return 'result'
    default: return null
  }
}

function extractPayload(type: string, obj: Record<string, unknown>): unknown {
  // 简化：直接返回原始 message 对象
  return obj['message'] ?? obj['result'] ?? obj
}
