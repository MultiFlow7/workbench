/**
 * useChatSend — v0.15.1 节点 2.2
 *
 * 从 ChatViewV2 抽出的发送/事件监听/工具调用接续/取消逻辑。
 * 仅业务（不含渲染），便于 ChatViewV2 与 ChatInputV2 共享同一发送链路。
 *
 * 返回：
 *   - handleSend(): 发送当前 expandedInput
 *   - handleStop(): 取消当前 atom 流式
 *   - handlePause(): 触发 agent.pause（req-061 节点 2.1 暂停按钮）
 *   - toolCallStatuses: 工具调用进行中的列表（用于输入区底部提示）
 *   - model / setModel / MODELS: 模型选择
 *   - atomEntries: 已加载的 atom 列表（含 frontmatter + parsed）
 *
 * 与 ChatView 一致的事件订阅（ai-token / ai-tool-call / ai-done / ai-error / ai-cancelled）
 * 在 hook 内部 useEffect 中挂载，组件卸载时清理。
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../store'
import type { QAAtomMeta } from '../store/conversationSlice'
import { findKeyForModel } from '../store/settingsSlice'
import { toFilePath, VAULT_PATH, BASE_PATH } from '../utils/paths'
import { getContextLimit } from '../constants/modelLimits'
import { parseAtom } from '../lib/atomParser'
import type { ParsedAtom } from '../lib/atomParser'

const TOOL_SCHEMAS = [
  {
    name: 'read_file',
    description: '读取指定绝对路径的文件内容',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '绝对文件路径' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_vault',
    description: '在 Vault 中搜索包含关键词的笔记',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
        vault_path: { type: 'string', description: `Vault 根目录，默认 ${VAULT_PATH}` },
      },
      required: ['keyword'],
    },
  },
]

export interface ToolCallStatus {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  error?: string
  startedAt: number
  durationMs?: number
}

export interface AtomEntry {
  meta: QAAtomMeta
  parsed: ParsedAtom
}

const STREAM_TIMEOUT_MS = 60_000

async function generateNewAtomId(parentId: string): Promise<string> {
  const match = parentId.match(/^(\d+)-(\d+)/)
  if (!match) throw new Error(`unexpected parent id format: ${parentId}`)
  const branchId = match[1]
  let seqNum = parseInt(match[2], 10) + 1
  const pad2 = (n: number) => String(n).padStart(2, '0')
  for (let i = 0; i < 100; i++) {
    const now = new Date()
    const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
    const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
    const candidate = `${branchId}-${String(seqNum).padStart(3, '0')}-${date}-${time}`
    const fileExists = await window.api.fsExists(toFilePath(candidate))
    if (!fileExists) return candidate
    seqNum++
  }
  throw new Error('ID space exhausted')
}

export interface UseChatSendOptions {
  /** 滚动相关 — 由调用方提供（DOM 在调用方持有） */
  isNearBottom: () => boolean
  scrollToBottom: () => void
  /** 末位 atom 完成后请求容器自动滚动 */
  requestScrollToBottom: () => void
}

export interface UseChatSendResult {
  atomEntries: AtomEntry[]
  toolCallStatuses: ToolCallStatus[]
  model: string
  setModel: (m: string) => void
  MODELS: string[]
  handleSend: () => Promise<void>
  handleStop: () => void
  handlePause: () => void
}

export function useChatSend(opts: UseChatSendOptions): UseChatSendResult {
  const currentPath = useStore((s) => s.currentPath)
  const setStreamingState = useStore((s) => s.setStreamingState)
  const appendAtom = useStore((s) => s.appendAtom)
  const selectAtom = useStore((s) => s.selectAtom)
  const addAtomToProject = useStore((s) => s.addAtomToProject)
  const setIsUserInputting = useStore((s) => s.setIsUserInputting)
  const clearPendingEvents = useStore((s) => s.clearPendingEvents)
  const updateAtomTokens = useStore((s) => s.updateAtomTokens)
  const apiKeys = useStore((s) => s.apiKeys)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  const setAtomStreaming = useStore((s) => s.setAtomStreaming)
  const setAtomDone = useStore((s) => s.setAtomDone)
  const appendStreamingText = useStore((s) => s.appendStreamingText)
  const clearStreamingText = useStore((s) => s.clearStreamingText)
  const cachingEnabled = useStore((s) => s.cachingEnabled)
  const expandedInput = useStore((s) => s.expandedInput)
  const setExpandedInput = useStore((s) => s.setExpandedInput)
  const selectedAtomId = useStore((s) => s.selectedAtomId)

  const DEFAULT_MODELS = [
    'claude-sonnet-4-6',
    'claude-opus-4-7',
    'claude-haiku-4-5-20251001',
    'gemini-2.5-pro',
  ]
  const allConfiguredModels = [...new Set(apiKeys.flatMap((k) => k.models))]
  const MODELS = allConfiguredModels.length ? allConfiguredModels : DEFAULT_MODELS

  const [atomEntries, setAtomEntries] = useState<AtomEntry[]>([])
  const [model, setModel] = useState(MODELS[0])
  const [toolCallStatuses, setToolCallStatuses] = useState<ToolCallStatus[]>([])

  const streamStartRef = useRef<number>(0)
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamTimeoutCbRef = useRef<(() => void) | null>(null)
  const currentPathRef = useRef(currentPath)
  const modelRef = useRef(model)
  const selectedAtomIdRef = useRef<string | null>(null)
  const activeStreamAtomIdRef = useRef<string | null>(null)
  const pendingPrevMapRef = useRef<Map<string, string>>(new Map())
  const pendingQuestionsMapRef = useRef<Map<string, string>>(new Map())
  const pendingIsNewRootRef = useRef(false)
  const pendingMessagesRef = useRef<Array<{ role: string; content: unknown }>>([])
  const systemPromptRef = useRef<string | undefined>(undefined)
  const toolCallInProgressRef = useRef(false)

  useEffect(() => { currentPathRef.current = currentPath }, [currentPath])
  useEffect(() => { modelRef.current = model }, [model])
  useEffect(() => { selectedAtomIdRef.current = selectedAtomId }, [selectedAtomId])

  // 加载 currentPath 上每个 atom 的原始 markdown 并 parseAtom 化
  useEffect(() => {
    if (!currentPath.length) {
      setAtomEntries([])
      return
    }
    let cancelled = false
    Promise.all(
      currentPath.map(async (m) => {
        const raw = await window.api.invoke<{ answer: string }>('read_qa_atom', {
          filePath: toFilePath(m.id),
        })
        const parsed = parseAtom(raw.answer ?? '')
        return { meta: m, parsed } satisfies AtomEntry
      }),
    )
      .then((entries) => {
        if (!cancelled) setAtomEntries(entries)
      })
      .catch((e) => console.error('[useChatSend] load atoms error:', e))
    return () => { cancelled = true }
  }, [currentPath])

  // 事件监听（与 ChatView 1:1）
  useEffect(() => {
    const unlisteners: Array<() => void> = []

    window.api.listen<{ atom_id: string; text: string }>('ai-token', (e) => {
      const { text, atom_id } = e.payload
      appendStreamingText(atom_id, text)
      if (atom_id === selectedAtomIdRef.current && opts.isNearBottom()) {
        opts.scrollToBottom()
      }
      if (atom_id === activeStreamAtomIdRef.current) {
        if (streamTimeoutCbRef.current && streamTimeoutRef.current) {
          clearTimeout(streamTimeoutRef.current)
          streamTimeoutRef.current = setTimeout(streamTimeoutCbRef.current, STREAM_TIMEOUT_MS)
        }
      }
    }).then((u) => unlisteners.push(u))

    window.api.listen<{ atom_id: string; tool_use_id: string; tool_name: string; tool_input: Record<string, unknown> }>('ai-tool-call', async (e) => {
      toolCallInProgressRef.current = true
      const { atom_id, tool_use_id, tool_name, tool_input } = e.payload
      const startedAt = Date.now()
      setToolCallStatuses((prev) => [
        ...prev,
        { id: tool_use_id, name: tool_name, input: tool_input, status: 'running', startedAt },
      ])

      let toolResult: string
      try {
        toolResult = await window.api.invoke<string>('execute_tool', {
          toolName: tool_name,
          toolInput: tool_input,
        })
        const durationMs = Date.now() - startedAt
        setToolCallStatuses((prev) =>
          prev.map((s) => s.id === tool_use_id ? { ...s, status: 'done', durationMs } : s),
        )
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const durationMs = Date.now() - startedAt
        setToolCallStatuses((prev) =>
          prev.map((s) => s.id === tool_use_id ? { ...s, status: 'error', error: errMsg, durationMs } : s),
        )
        toolResult = `error: ${errMsg}`
      }

      const textBeforeTool = useStore.getState().streamingTexts.get(atom_id) ?? ''
      clearStreamingText(atom_id)

      const assistantContent: unknown[] = []
      if (textBeforeTool) {
        assistantContent.push({ type: 'text', text: textBeforeTool })
      }
      assistantContent.push({ type: 'tool_use', id: tool_use_id, name: tool_name, input: tool_input })

      const continuationMessages = [
        ...pendingMessagesRef.current,
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id, content: toolResult }] },
      ]
      pendingMessagesRef.current = continuationMessages

      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current)
      const toolContinuationTimeoutCb = () => {
        console.warn('[useChatSend] tool continuation idle timeout (no tokens for 60s)')
        window.api.invoke('cancel_stream', { atomId: atom_id }).catch(() => {})
        setStreamingState('error')
        setToolCallStatuses([])
      }
      streamTimeoutCbRef.current = toolContinuationTimeoutCb
      streamTimeoutRef.current = setTimeout(toolContinuationTimeoutCb, STREAM_TIMEOUT_MS)

      window.api.invoke('stream_ai', {
        messages: continuationMessages,
        model: modelRef.current,
        atomId: atom_id,
        ...(systemPromptRef.current ? { system: systemPromptRef.current } : {}),
        tools: TOOL_SCHEMAS,
        caching: useStore.getState().cachingEnabled,
        providerKey: findKeyForModel(useStore.getState().apiKeys, modelRef.current)?.key ?? null,
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[useChatSend] tool continuation stream_ai error:', msg)
        if (streamTimeoutRef.current) {
          clearTimeout(streamTimeoutRef.current)
          streamTimeoutRef.current = null
          streamTimeoutCbRef.current = null
        }
        toolCallInProgressRef.current = false
        setAtomDone(atom_id)
        clearStreamingText(atom_id)
        pendingPrevMapRef.current.delete(atom_id)
        pendingQuestionsMapRef.current.delete(atom_id)
        setStreamingState('error')
      })
    }).then((u) => unlisteners.push(u))

    window.api.listen<{ atom_id: string; full_content: string; input_tokens?: number; output_tokens?: number }>('ai-done', async (e) => {
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current)
        streamTimeoutRef.current = null
        streamTimeoutCbRef.current = null
      }
      const { atom_id, full_content, input_tokens, output_tokens } = e.payload

      if (!pendingQuestionsMapRef.current.has(atom_id)) return

      const questionText = pendingQuestionsMapRef.current.get(atom_id) ?? ''
      const prevRawId = pendingPrevMapRef.current.get(atom_id) ?? ''
      const prevWikilink = prevRawId ? `[[${prevRawId}]]` : null
      const currentModel = modelRef.current
      const now = new Date().toISOString()

      const hasTokens = input_tokens !== undefined && output_tokens !== undefined
      const tokenMeta = hasTokens ? {
        model: currentModel,
        usage: { input_tokens: input_tokens!, output_tokens: output_tokens! },
        context_tokens_used: input_tokens,
        context_window_limit: getContextLimit(currentModel),
      } : undefined

      await window.api.invoke('write_qa_atom', {
        filePath: toFilePath(atom_id),
        atom: {
          meta: {
            id: atom_id,
            prev: prevWikilink,
            children: [],
            summary: questionText.slice(0, 50),
            timestamp: now,
            ...(tokenMeta ?? {}),
          },
          question: questionText,
          answer: full_content,
        },
      }).catch(console.error)

      const newMeta: QAAtomMeta = {
        id: atom_id,
        prev: prevWikilink,
        children: [],
        summary: questionText.slice(0, 50),
        timestamp: now,
        ...(tokenMeta ?? {}),
      }
      appendAtom(newMeta)
      if (hasTokens) {
        updateAtomTokens(atom_id, {
          model: currentModel,
          usage: tokenMeta!.usage,
          contextTokensUsed: input_tokens,
          contextWindowLimit: getContextLimit(currentModel),
        })
      }

      toolCallInProgressRef.current = false
      setAtomDone(atom_id)
      clearStreamingText(atom_id)
      setToolCallStatuses([])

      if (atom_id === selectedAtomIdRef.current && full_content) {
        opts.requestScrollToBottom()
      }

      const lastInPath = currentPathRef.current[currentPathRef.current.length - 1]
      if (lastInPath?.id === prevRawId) {
        selectAtom(atom_id)
      }

      pendingPrevMapRef.current.delete(atom_id)
      pendingQuestionsMapRef.current.delete(atom_id)

      const duration_ms = Date.now() - streamStartRef.current
      const token_count = Math.round(full_content.length / 4)
      window.api.invoke('write_event_log', { event: { event: 'streaming_complete', timestamp: new Date().toISOString(), payload: { duration_ms, token_count } } }).catch(() => {})
    }).then((u) => unlisteners.push(u))

    window.api.listen<{ atom_id?: string; error?: string; message?: string }>('ai-error', (e) => {
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current)
        streamTimeoutRef.current = null
        streamTimeoutCbRef.current = null
      }
      toolCallInProgressRef.current = false
      const atom_id = e.payload.atom_id
      if (atom_id) {
        setAtomDone(atom_id)
        clearStreamingText(atom_id)
        pendingPrevMapRef.current.delete(atom_id)
        pendingQuestionsMapRef.current.delete(atom_id)
      } else {
        setStreamingState('error')
      }
      setToolCallStatuses([])
    }).then((u) => unlisteners.push(u))

    window.api.listen<{ atom_id?: string }>('ai-cancelled', (e) => {
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current)
        streamTimeoutRef.current = null
        streamTimeoutCbRef.current = null
      }
      toolCallInProgressRef.current = false
      const atom_id = e.payload.atom_id
      if (atom_id) {
        setAtomDone(atom_id)
        clearStreamingText(atom_id)
        pendingPrevMapRef.current.delete(atom_id)
        pendingQuestionsMapRef.current.delete(atom_id)
      }
      setToolCallStatuses([])
    }).then((u) => unlisteners.push(u))

    return () => unlisteners.forEach((u) => u())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // v0.2: 构造 system prompt（后台任务摘要）
  const buildSystemPrompt = useCallback(async (): Promise<string | undefined> => {
    try {
      const [pending, running, blocked, awaitingDecision] = await Promise.all([
        window.api.invoke<Array<{ task_id: string; role: string; status: string; version: string }>>('list_tasks', { status: 'Pending' }),
        window.api.invoke<Array<{ task_id: string; role: string; status: string; version: string }>>('list_tasks', { status: 'Running' }),
        window.api.invoke<Array<{ task_id: string; role: string; status: string; version: string }>>('list_tasks', { status: 'Blocked' }),
        window.api.invoke<Array<{ task_id: string; role: string; status: string; version: string }>>('list_tasks', { status: 'AwaitingDecision' }),
      ])
      const allTasks = [...pending, ...running, ...blocked, ...awaitingDecision]
      if (allTasks.length === 0) return undefined
      const summaryLines = allTasks.map((t) => `- [${t.task_id}] ${t.role} (${t.status}) v${t.version}`)
      const awaitingCount = awaitingDecision.length
      return `当前后台任务状态：\n${summaryLines.join('\n')}\n待决策 ${awaitingCount} 项。`
    } catch {
      return undefined
    }
  }, [])

  const handleSend = useCallback(async () => {
    if (!expandedInput.trim()) return
    if (!currentPath.length && !selectedProjectId) return

    const parentMeta = currentPath[currentPath.length - 1] ?? null

    let newAtomId: string
    if (parentMeta) {
      try {
        newAtomId = await generateNewAtomId(parentMeta.id)
      } catch (e) {
        console.error('[useChatSend] generateNewAtomId failed:', e instanceof Error ? e.message : String(e))
        setStreamingState('error')
        return
      }
      pendingIsNewRootRef.current = false
    } else {
      if (!selectedProjectId) return
      if (!projects.find((p) => p.id === selectedProjectId)) return
      const branchId = await window.api.invoke<string>('next_branch_id', { qaDir: BASE_PATH })
      const now = new Date()
      const pad2 = (n: number) => String(n).padStart(2, '0')
      const dateStr = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
      const timeStr = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
      newAtomId = `${branchId}-001-${dateStr}-${timeStr}`
      pendingIsNewRootRef.current = true
    }

    activeStreamAtomIdRef.current = newAtomId

    const questionText = expandedInput
    pendingPrevMapRef.current.set(newAtomId, parentMeta?.id ?? '')
    pendingQuestionsMapRef.current.set(newAtomId, questionText)

    clearPendingEvents()
    setIsUserInputting(false)

    const placeholderPrev = parentMeta ? `[[${parentMeta.id}]]` : null
    await window.api.invoke('write_qa_atom', {
      filePath: toFilePath(newAtomId),
      atom: {
        meta: {
          id: newAtomId,
          prev: placeholderPrev,
          children: [],
          summary: questionText.slice(0, 50),
          timestamp: new Date().toISOString(),
        },
        question: questionText,
        answer: '',
      },
    }).catch(console.error)

    const placeholderMeta: QAAtomMeta = {
      id: newAtomId,
      prev: placeholderPrev,
      children: [],
      summary: questionText.slice(0, 50),
      timestamp: new Date().toISOString(),
    }
    appendAtom(placeholderMeta)
    setAtomStreaming(newAtomId)

    if (selectedProjectId) {
      const proj = projects.find((p) => p.id === selectedProjectId)
      if (proj) {
        addAtomToProject(proj.name, newAtomId).catch(console.error)
      }
    }

    opts.requestScrollToBottom()
    setExpandedInput('')
    setToolCallStatuses([])

    // 历史消息从已加载的 atomEntries 派生（仅当前分支）
    const currentPathIds = new Set(currentPath.map((a) => a.id))
    const historyMessages: Array<{ role: string; content: unknown }> = []
    for (const entry of atomEntries) {
      if (!currentPathIds.has(entry.meta.id)) continue
      if (entry.parsed.q) {
        historyMessages.push({ role: 'user', content: [{ type: 'text', text: entry.parsed.q }] })
      }
      if (entry.parsed.response) {
        historyMessages.push({ role: 'assistant', content: [{ type: 'text', text: entry.parsed.response }] })
      }
    }

    const systemPrompt = await buildSystemPrompt()

    window.api.invoke('write_event_log', { event: { event: 'message_sent', timestamp: new Date().toISOString(), payload: { path_length: currentPath.length, model } } }).catch(() => {})
    streamStartRef.current = Date.now()

    const outgoingMessages = [
      ...historyMessages,
      { role: 'user', content: [{ type: 'text', text: questionText }] },
    ]
    pendingMessagesRef.current = outgoingMessages
    systemPromptRef.current = systemPrompt

    window.api.invoke('stream_ai', {
      messages: outgoingMessages,
      model,
      atomId: newAtomId,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      tools: TOOL_SCHEMAS,
      caching: cachingEnabled,
      providerKey: findKeyForModel(apiKeys, model)?.key ?? null,
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useChatSend] stream_ai error:', msg)
      setAtomDone(newAtomId)
      clearStreamingText(newAtomId)
      pendingPrevMapRef.current.delete(newAtomId)
      pendingQuestionsMapRef.current.delete(newAtomId)
    })

    if (!toolCallInProgressRef.current) {
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current)
      const idleTimeoutCb = () => {
        console.warn('[useChatSend] idle timeout: no tokens for 60s')
        window.api.invoke('cancel_stream', { atomId: activeStreamAtomIdRef.current ?? '' }).catch(() => {})
        streamTimeoutCbRef.current = null
      }
      streamTimeoutCbRef.current = idleTimeoutCb
      streamTimeoutRef.current = setTimeout(idleTimeoutCb, STREAM_TIMEOUT_MS)
    }
  }, [expandedInput, currentPath, atomEntries, selectedProjectId, projects, appendAtom, setAtomStreaming,
      setAtomDone, clearStreamingText, addAtomToProject, setExpandedInput, buildSystemPrompt,
      cachingEnabled, apiKeys, model, setStreamingState, clearPendingEvents, setIsUserInputting, opts])

  const handleStop = useCallback(() => {
    window.api.invoke('cancel_stream', { atomId: selectedAtomIdRef.current ?? '' }).catch(console.error)
  }, [])

  // 节点 2.1：暂停按钮触发 agent.pause（与 ChatView 第 684 行 chat-pause-btn-header 一致）
  const handlePause = useCallback(() => {
    // 埋点（节点 4.0 预留打点位）
    window.api.invoke('write_event_log', {
      event: {
        event: 'pause_triggered',
        timestamp: new Date().toISOString(),
        payload: { atom_id: activeStreamAtomIdRef.current },
      },
    }).catch(() => {})
    void window.api.agent.pause()
  }, [])

  return {
    atomEntries,
    toolCallStatuses,
    model,
    setModel,
    MODELS,
    handleSend,
    handleStop,
    handlePause,
  }
}
