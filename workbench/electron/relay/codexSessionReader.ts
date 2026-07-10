import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import * as fsp from 'node:fs/promises'

export type RelayPlatform = 'workbench' | 'codex' | 'claude'

export type SourceEventMarkerType =
  | 'agent_execution_candidate'
  | 'agent_agent_candidate'
  | 'tool_trace_candidate'
  | 'unmapped_source_event'

export interface SourceEventMarker {
  type: SourceEventMarkerType
  sourceKey: string
  timestamp?: string
  reason: string
}

export interface CodexSessionMeta {
  sessionId: string
  sourcePath: string
  sourcePathDisplay: string
  sourcePathHash: string
  sourceCwd?: string
  sourceCwdDisplay?: string
  sourceCwdHash?: string
  sourceTitle?: string
  sourceSessionHash: string
  readCheckpoint: string
}

export interface CodexQAPair {
  sourceKey: string
  timestamp: string
  question: string
  answer: string
}

export interface CodexReadResult {
  meta: CodexSessionMeta
  pairs: CodexQAPair[]
  markers: SourceEventMarker[]
}

type CodexRole = 'user' | 'assistant'

interface PendingMessage {
  role: CodexRole
  text: string
  timestamp: string
  lineIndex: number
  sourceKey: string
}

let CODEX_SESSIONS_ROOT = join(homedir(), '.codex', 'sessions')
const MAX_SESSION_BYTES = 16 * 1024 * 1024

export function __setCodexSessionsRootForTesting(root: string): void {
  CODEX_SESSIONS_ROOT = root
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function compactPathDisplay(path: string): string {
  const home = homedir()
  if (path.startsWith(home)) return `~${path.slice(home.length)}`
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 4) return path
  return `.../${parts.slice(-3).join('/')}`
}

function compactCwdDisplay(path: string): string {
  const home = homedir()
  const normalized = path.startsWith(home) ? `~${path.slice(home.length)}` : path
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 3) return normalized
  return `.../${parts.slice(-2).join('/')}`
}

async function findSessionPathById(sessionId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return null
  const queue = [CODEX_SESSIONS_ROOT]
  while (queue.length > 0) {
    const dir = queue.shift() as string
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        queue.push(full)
      } else if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.includes(sessionId)) {
        return full
      }
    }
  }
  return null
}

async function resolveAllowedSessionPath(args: { sessionId?: string; sourcePath?: string }): Promise<string> {
  const inputPath = args.sourcePath?.trim()
  const expandedInputPath = inputPath?.startsWith('~/')
    ? join(homedir(), inputPath.slice(2))
    : inputPath
  const candidate = expandedInputPath
    ? resolve(expandedInputPath)
    : args.sessionId
      ? await findSessionPathById(args.sessionId)
      : null
  if (!candidate) throw new Error('未找到 Codex session 文件')
  if (!candidate.endsWith('.jsonl')) throw new Error('Codex session 只支持 .jsonl 文件')

  const real = await fsp.realpath(candidate)
  const sessionsRoot = await fsp.realpath(CODEX_SESSIONS_ROOT).catch(() => CODEX_SESSIONS_ROOT)
  if (!real.startsWith(`${sessionsRoot}/`)) {
    throw new Error('Codex session 路径不在允许的 ~/.codex/sessions 范围内')
  }
  const stat = await fsp.stat(real)
  if (!stat.isFile()) throw new Error('Codex session 路径不是文件')
  if (stat.size > MAX_SESSION_BYTES) throw new Error('Codex session 文件过大，已拒绝读取')
  return real
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      if (typeof record.text === 'string') return record.text
      if (typeof record.input_text === 'string') return record.input_text
      if (typeof record.output_text === 'string') return record.output_text
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function extractMessage(payload: unknown): { role: CodexRole; text: string } | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.type !== 'message') return null
  const role = record.role === 'user' || record.role === 'assistant' ? record.role : null
  if (!role) return null
  const text = extractTextFromContent(record.content)
  if (!text) return null
  return { role, text }
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

export async function readCodexSession(args: { sessionId?: string; sourcePath?: string }): Promise<CodexReadResult> {
  const sourcePath = await resolveAllowedSessionPath(args)
  const raw = await fsp.readFile(sourcePath, 'utf-8')
  const lines = raw.split(/\r?\n/).filter((line) => line.trim())
  const markers: SourceEventMarker[] = []
  const messages: PendingMessage[] = []

  let sessionId = args.sessionId?.trim() || ''
  let sourceCwd: string | undefined
  let sourceTitle: string | undefined
  let readCheckpoint = String(lines.length)

  for (let index = 0; index < lines.length; index++) {
    const event = parseJsonLine(lines[index])
    if (!event) {
      markers.push({
        type: 'unmapped_source_event',
        sourceKey: `line:${index}`,
        reason: '无法解析 jsonl 行',
      })
      continue
    }

    const timestamp = typeof event.timestamp === 'string' ? event.timestamp : ''
    const type = typeof event.type === 'string' ? event.type : ''
    const payload = event.payload && typeof event.payload === 'object'
      ? event.payload as Record<string, unknown>
      : {}

    if (type === 'session_meta') {
      const payloadSessionId = typeof payload.session_id === 'string'
        ? payload.session_id
        : typeof payload.id === 'string'
          ? payload.id
          : ''
      if (payloadSessionId) sessionId = payloadSessionId
      if (typeof payload.cwd === 'string') sourceCwd = payload.cwd
      continue
    }

    if (type !== 'response_item') {
      if (type && type !== 'event_msg') {
        markers.push({
          type: 'unmapped_source_event',
          sourceKey: `line:${index}`,
          timestamp,
          reason: `暂不映射事件类型 ${type}`,
        })
      }
      continue
    }

    const message = extractMessage(payload)
    if (!message) {
      const payloadType = typeof payload.type === 'string' ? payload.type : ''
      const markerType: SourceEventMarkerType = payloadType.includes('tool')
        ? 'tool_trace_candidate'
        : payloadType.includes('agent')
          ? 'agent_agent_candidate'
          : 'unmapped_source_event'
      markers.push({
        type: markerType,
          sourceKey: `line:${index}`,
        timestamp,
        reason: payloadType ? `暂不映射 response_item:${payloadType}` : '暂不映射 response_item',
      })
      continue
    }

    if (!sourceTitle && message.role === 'user') {
      sourceTitle = message.text.split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 48)
    }
    messages.push({
      ...message,
      timestamp,
      lineIndex: index,
      sourceKey: `line:${index}`,
    })
  }

  if (!sessionId) sessionId = `unknown-${hashValue(sourcePath)}`

  const pairs: CodexQAPair[] = []
  let pendingUser: PendingMessage | null = null
  for (const message of messages) {
    if (message.role === 'user') {
      if (pendingUser) {
        markers.push({
          type: 'unmapped_source_event',
          sourceKey: pendingUser.sourceKey,
          timestamp: pendingUser.timestamp,
          reason: '用户消息未找到后续 assistant 回复',
        })
      }
      pendingUser = message
      continue
    }
    if (message.role === 'assistant' && pendingUser) {
      pairs.push({
        sourceKey: pendingUser.sourceKey,
        timestamp: pendingUser.timestamp || message.timestamp || new Date().toISOString(),
        question: pendingUser.text,
        answer: message.text,
      })
      pendingUser = null
      continue
    }
    markers.push({
      type: 'unmapped_source_event',
      sourceKey: message.sourceKey,
      timestamp: message.timestamp,
      reason: 'assistant 消息缺少待配对用户消息',
    })
  }
  if (pendingUser) {
    markers.push({
      type: 'unmapped_source_event',
      sourceKey: pendingUser.sourceKey,
      timestamp: pendingUser.timestamp,
      reason: '用户消息未找到后续 assistant 回复',
    })
  }

  return {
    meta: {
      sessionId,
      sourcePath,
      sourcePathDisplay: compactPathDisplay(sourcePath),
      sourcePathHash: hashValue(sourcePath),
      ...(sourceCwd ? {
        sourceCwd,
        sourceCwdDisplay: compactCwdDisplay(sourceCwd),
        sourceCwdHash: hashValue(sourceCwd),
      } : {}),
      ...(sourceTitle ? { sourceTitle } : {}),
      sourceSessionHash: hashValue(sessionId),
      readCheckpoint,
    },
    pairs,
    markers,
  }
}
