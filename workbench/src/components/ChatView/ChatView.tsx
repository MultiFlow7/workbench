import { useEffect, useRef, useState, useCallback, memo } from 'react'
import { useStore } from '../../store'
import type { QAAtomMeta } from '../../store/conversationSlice'
import { findKeyForModel } from '../../store/settingsSlice'
import { toFilePath, VAULT_PATH, BASE_PATH } from '../../utils/paths'
import { getContextLimit } from '../../constants/modelLimits'
import { ContextIndicator } from '../ContextIndicator/ContextIndicator'
import { InterventionInline } from '../InterventionInline/InterventionInline'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github.css'
import './ChatView.css'

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

interface ToolCallStatus {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  error?: string
  startedAt: number
  durationMs?: number
}

interface QAAtom {
  meta: QAAtomMeta
  question: string
  answer: string
}

const STREAM_TIMEOUT_MS = 60_000

interface Message {
  role: 'user' | 'ai'
  content: string
  atomId?: string
  isStreaming?: boolean
}

function flattenToMessages(atoms: QAAtom[]): Message[] {
  const result: Message[] = []
  let displayIdx = 0
  atoms.forEach((atom) => {
    if (!atom.question && !atom.answer) return  // skip empty placeholder root atoms
    if (displayIdx > 0) result.push({ role: 'ai', content: `— 分支节点 ${atom.meta.id} —`, atomId: atom.meta.id })
    result.push({ role: 'user', content: atom.question, atomId: atom.meta.id })
    result.push({ role: 'ai',   content: atom.answer,   atomId: atom.meta.id })
    displayIdx++
  })
  return result
}

async function generateNewAtomId(parentId: string): Promise<string> {
  // parentId format: "0013-001-20260429-095754"
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

const MessageBubble = memo(function MessageBubble({ msg }: { msg: Message }) {
  if (msg.content.startsWith('— 分支节点')) {
    return <div className="chat-branch-marker">{msg.content}</div>
  }
  return (
    <div className={`bubble-row bubble-row--${msg.role}`}>
      <div className={`bubble bubble--${msg.role}`}>
        {msg.role === 'ai' ? (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {msg.content}
            </ReactMarkdown>
          </div>
        ) : (
          msg.content
        )}
      </div>
    </div>
  )
})

export function ChatView() {
  const currentPath = useStore((s) => s.currentPath)
  const selectedAtomId = useStore((s) => s.selectedAtomId)
  const streamingState = useStore((s) => s.streamingState)
  const setStreamingState = useStore((s) => s.setStreamingState)
  const appendAtom = useStore((s) => s.appendAtom)
  const selectAtom = useStore((s) => s.selectAtom)
  const addAtomToProject = useStore((s) => s.addAtomToProject)
  // v0.2
  const setIsUserInputting = useStore((s) => s.setIsUserInputting)
  const clearPendingEvents = useStore((s) => s.clearPendingEvents)
  // v0.3
  const updateAtomTokens = useStore((s) => s.updateAtomTokens)
  const apiKeys = useStore((s) => s.apiKeys)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  // v0.14 req-051
  const streamingAtoms = useStore((s) => s.streamingAtoms)
  const streamingTexts = useStore((s) => s.streamingTexts)
  const setAtomStreaming = useStore((s) => s.setAtomStreaming)
  const setAtomDone = useStore((s) => s.setAtomDone)
  const appendStreamingText = useStore((s) => s.appendStreamingText)
  const clearStreamingText = useStore((s) => s.clearStreamingText)

  const cachingEnabled = useStore((s) => s.cachingEnabled)
  const setCachingEnabled = useStore((s) => s.setCachingEnabled)
  const expandedInput = useStore((s) => s.expandedInput)
  const setExpandedInput = useStore((s) => s.setExpandedInput)
  const setP4Mode = useStore((s) => s.setP4Mode)

  const DEFAULT_MODELS = [
    'claude-sonnet-4-6',
    'claude-opus-4-7',
    'claude-haiku-4-5-20251001',
    'gemini-2.5-pro',
  ]
  const allConfiguredModels = [...new Set(apiKeys.flatMap(k => k.models))]
  const MODELS = allConfiguredModels.length ? allConfiguredModels : DEFAULT_MODELS

  const [messages, setMessages] = useState<Message[]>([])
  const [model, setModel] = useState(MODELS[0])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isNearBottom = () => {
    const c = messagesContainerRef.current
    if (!c) return true
    return c.scrollHeight - c.scrollTop - c.clientHeight < 80
  }
  const scrollToBottom = () => {
    const c = messagesContainerRef.current
    if (c) c.scrollTop = c.scrollHeight
  }
  const streamStartRef = useRef<number>(0)
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamTimeoutCbRef = useRef<(() => void) | null>(null)
  const currentPathRef = useRef(currentPath)
  const modelRef = useRef(model)
  // selectedAtomIdRef: synced from store, used in ai-token scroll check
  const selectedAtomIdRef = useRef<string | null>(null)
  // activeStreamAtomIdRef: tracks the most-recently-launched stream (for timeout reset)
  const activeStreamAtomIdRef = useRef<string | null>(null)
  // pendingPrevMapRef: maps atom_id → parent atom_id ('' for new root)
  const pendingPrevMapRef = useRef<Map<string, string>>(new Map())
  // pendingQuestionsMapRef: maps atom_id → question text
  const pendingQuestionsMapRef = useRef<Map<string, string>>(new Map())
  // pendingIsNewRootRef: true when the current atom is a new root (no parent)
  const pendingIsNewRootRef = useRef(false)
  // Tool calling refs
  const pendingMessagesRef = useRef<Array<{ role: string; content: unknown }>>([])
  const systemPromptRef = useRef<string | undefined>(undefined)
  const toolCallInProgressRef = useRef(false)
  const [toolCallStatuses, setToolCallStatuses] = useState<ToolCallStatus[]>([])

  useEffect(() => { currentPathRef.current = currentPath }, [currentPath])
  useEffect(() => { modelRef.current = model }, [model])
  useEffect(() => { selectedAtomIdRef.current = selectedAtomId }, [selectedAtomId])

  // Derived streaming state for currently viewed atom
  const isCurrentAtomStreaming = selectedAtomId ? streamingAtoms.has(selectedAtomId) : false
  const currentStreamingText = selectedAtomId ? (streamingTexts.get(selectedAtomId) ?? '') : ''

  // Load full atoms when path changes
  useEffect(() => {
    if (!currentPath.length) {
      setMessages([])
      return
    }
    let cancelled = false
    Promise.all(
      currentPath.map((m) =>
        window.api.invoke<QAAtom>('read_qa_atom', { filePath: toFilePath(m.id) })
      )
    )
      .then((atoms) => {
        if (!cancelled) {
          setMessages(flattenToMessages(atoms))
        }
      })
      .catch((e) => console.error('[ChatView] read atoms error:', e))
    return () => { cancelled = true }
  }, [currentPath])

  const shouldScrollRef = useRef(false)
  useEffect(() => {
    if (shouldScrollRef.current) {
      scrollToBottom()
      shouldScrollRef.current = false
    }
  }, [messages])

  // Register ai-token / ai-done / ai-error / ai-cancelled / ai-tool-call listeners
  useEffect(() => {
    const unlisteners: Array<() => void> = []

    // Node-F-051-B-9: all streams write to their own streamingTexts entry
    window.api.listen<{ atom_id: string; text: string }>('ai-token', (e) => {
      const { text, atom_id } = e.payload
      appendStreamingText(atom_id, text)
      if (atom_id === selectedAtomIdRef.current && isNearBottom()) {
        scrollToBottom()
      }
      // timeout reset only for most-recently-launched stream
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
          prev.map((s) => s.id === tool_use_id ? { ...s, status: 'done', durationMs } : s)
        )
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const durationMs = Date.now() - startedAt
        setToolCallStatuses((prev) =>
          prev.map((s) => s.id === tool_use_id ? { ...s, status: 'error', error: errMsg, durationMs } : s)
        )
        toolResult = `error: ${errMsg}`
      }

      // capture text before tool call from store, then clear it
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
        console.warn('[ChatView] tool continuation idle timeout (no tokens for 60s)')
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
        console.error('[ChatView] tool continuation stream_ai error:', msg)
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

      // Guard: ignore spurious events not initiated by handleSend
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

      // Overwrite placeholder file with actual answer
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
      // Node-F-051-B-10: remove from streaming state
      setAtomDone(atom_id)
      clearStreamingText(atom_id)
      setToolCallStatuses([])

      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current)
        streamTimeoutRef.current = null
        streamTimeoutCbRef.current = null
      }

      // If user is viewing this atom, append AI message to chat
      if (atom_id === selectedAtomIdRef.current && full_content) {
        shouldScrollRef.current = true
        setMessages((prev) => [...prev, { role: 'ai', content: full_content, atomId: atom_id }])
      }

      // Node-F-051-B-11: conditional jump using per-atom prevId
      const lastInPath = currentPathRef.current[currentPathRef.current.length - 1]
      if (lastInPath?.id === prevRawId) {
        selectAtom(atom_id)
      }

      // Clean up per-atom pending records
      pendingPrevMapRef.current.delete(atom_id)
      pendingQuestionsMapRef.current.delete(atom_id)

      const duration_ms = Date.now() - streamStartRef.current
      const token_count = Math.round(full_content.length / 4)
      window.api.invoke('write_event_log', { event: { event: 'streaming_complete', timestamp: new Date().toISOString(), payload: { duration_ms, token_count } } }).catch(() => {})
    }).then((u) => unlisteners.push(u))

    // Node-F-051-B-18: per-atom error handling, no global lastError
    window.api.listen<{ atom_id?: string; error?: string; message?: string }>('ai-error', (e) => {
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current)
        streamTimeoutRef.current = null
        streamTimeoutCbRef.current = null
      }
      toolCallInProgressRef.current = false
      const atom_id = e.payload.atom_id
      const errorMsg = e.payload.error ?? e.payload.message ?? '未知错误'

      if (atom_id) {
        const prevId = pendingPrevMapRef.current.get(atom_id) ?? ''
        setAtomDone(atom_id)
        clearStreamingText(atom_id)
        pendingPrevMapRef.current.delete(atom_id)
        pendingQuestionsMapRef.current.delete(atom_id)
        // Show error if: (a) user is viewing this atom, or (b) this atom is a child of the current atom
        const cur = selectedAtomIdRef.current
        if (atom_id === cur || prevId === cur) {
          setMessages((prev) => [
            ...prev,
            { role: 'ai', content: `AI 响应中断：${errorMsg}，请重试`, atomId: atom_id },
          ])
        }
      } else {
        // Fallback for errors without atom_id (shouldn't happen after req-051 backend fix)
        setStreamingState('error')
      }
      setToolCallStatuses([])
    }).then((u) => unlisteners.push(u))

    // Node-F-051-B-17: per-atom cancel handling
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
  }, [appendAtom, selectAtom, setStreamingState, updateAtomTokens, appendStreamingText, clearStreamingText, setAtomStreaming, setAtomDone])

  // v0.2: Build system prompt with active backend task summaries
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

      const summaryLines = allTasks.map((t) =>
        `- [${t.task_id}] ${t.role} (${t.status}) v${t.version}`
      )
      const awaitingCount = awaitingDecision.length

      return (
        `当前后台任务状态：\n${summaryLines.join('\n')}\n待决策 ${awaitingCount} 项。`
      )
    } catch {
      return undefined
    }
  }, [])

  // Node-F-051-B-3: removed streamingState === 'streaming' guard — concurrent sends allowed
  const handleSend = useCallback(async () => {
    if (!expandedInput.trim()) return
    if (!currentPath.length && !selectedProjectId) return

    const parentMeta = currentPath[currentPath.length - 1] ?? null

    let newAtomId: string
    if (parentMeta) {
      try {
        newAtomId = await generateNewAtomId(parentMeta.id)
      } catch (e) {
        console.error('[ChatView] generateNewAtomId failed:', e instanceof Error ? e.message : String(e))
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

    // Record active stream atom for timeout reset
    activeStreamAtomIdRef.current = newAtomId

    // Step 3b: per-atom pending maps (concurrent-safe)
    const questionText = expandedInput
    pendingPrevMapRef.current.set(newAtomId, parentMeta?.id ?? '')
    pendingQuestionsMapRef.current.set(newAtomId, questionText)

    // v0.2: clear pending events
    clearPendingEvents()
    setIsUserInputting(false)

    // Step 4: Node-F-051-B-4 — write placeholder atom file (answer: '')
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

    // Step 5: Node-F-051-B-5 — immediately add to Store (BranchTree shows node at once)
    const placeholderMeta: QAAtomMeta = {
      id: newAtomId,
      prev: placeholderPrev,
      children: [],
      summary: questionText.slice(0, 50),
      timestamp: new Date().toISOString(),
    }
    appendAtom(placeholderMeta)

    // Step 6: Node-F-051-B-6 — mark as streaming (BranchTree spinner appears)
    setAtomStreaming(newAtomId)

    // Step 7: Node-F-051-B-7 — add to project before invoke (BranchTree filter shows it)
    if (selectedProjectId) {
      const proj = projects.find((p) => p.id === selectedProjectId)
      if (proj) {
        addAtomToProject(proj.name, newAtomId).catch(console.error)
      }
    }

    // Step 8: update UI messages and unlock input immediately
    shouldScrollRef.current = true
    setMessages((prev) => [...prev, { role: 'user', content: questionText, atomId: newAtomId }])
    setExpandedInput('')
    setToolCallStatuses([])

    // Step 9: build history messages and system prompt
    // Only include messages belonging to the current branch to prevent cross-branch contamination
    // in concurrent sends (e.g. sending C while B is still streaming from the same parent A).
    const currentPathIds = new Set(currentPath.map((a) => a.id))
    const historyMessages = messages
      .filter((m) => {
        if (m.role === 'ai' && m.content.startsWith('— 分支节点')) return false
        if (m.atomId !== undefined && !currentPathIds.has(m.atomId)) return false
        return true
      })
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: typeof m.content === 'string'
          ? [{ type: 'text', text: m.content }]
          : m.content,
      }))

    const systemPrompt = await buildSystemPrompt()

    window.api.invoke('write_event_log', { event: { event: 'message_sent', timestamp: new Date().toISOString(), payload: { path_length: currentPath.length, model } } }).catch(() => {})
    streamStartRef.current = Date.now()

    const outgoingMessages = [
      ...historyMessages,
      { role: 'user', content: [{ type: 'text', text: questionText }] },
    ]
    pendingMessagesRef.current = outgoingMessages
    systemPromptRef.current = systemPrompt

    // Step 10: Node-F-051-B-8 — fire-and-forget (no await, input stays unlocked)
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
      console.error('[ChatView] stream_ai error:', msg)
      setAtomDone(newAtomId)
      clearStreamingText(newAtomId)
      pendingPrevMapRef.current.delete(newAtomId)
      pendingQuestionsMapRef.current.delete(newAtomId)
      setMessages((prev) => [
        ...prev,
        { role: 'ai', content: `AI 响应中断：${msg}，请重试`, atomId: newAtomId },
      ])
    })

    // T-4: idle timeout — only when no tool call has started
    if (!toolCallInProgressRef.current) {
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current)
      const idleTimeoutCb = () => {
        console.warn('[ChatView] idle timeout: no tokens for 60s')
        window.api.invoke('cancel_stream', { atomId: activeStreamAtomIdRef.current ?? '' }).catch(() => {})
        streamTimeoutCbRef.current = null
      }
      streamTimeoutCbRef.current = idleTimeoutCb
      streamTimeoutRef.current = setTimeout(idleTimeoutCb, STREAM_TIMEOUT_MS)
    }
  }, [expandedInput, currentPath, messages, selectedProjectId, projects, appendAtom, setAtomStreaming,
      setAtomDone, clearStreamingText, addAtomToProject, setExpandedInput, buildSystemPrompt,
      cachingEnabled, apiKeys, model, setStreamingState, clearPendingEvents, setIsUserInputting])

  // Node-F-051-B-14: stop button cancels the currently viewed streaming atom
  const handleStop = useCallback(() => {
    window.api.invoke('cancel_stream', { atomId: selectedAtomIdRef.current ?? '' }).catch(console.error)
  }, [])

  // Breadcrumb: first + last 3 items
  const breadcrumb = currentPath.length <= 3
    ? currentPath.map((n) => n.summary || n.id).join(' › ')
    : [currentPath[0].summary || currentPath[0].id, '…', ...currentPath.slice(-2).map((n) => n.summary || n.id)].join(' › ')

  return (
    <div className="chat-view">
      {currentPath.length > 0 && (
        <div className="chat-breadcrumb">{breadcrumb}</div>
      )}

      <div className="chat-messages" ref={messagesContainerRef}>
        {messages.length === 0 && streamingAtoms.size === 0 && (
          <div className="chat-empty">选择节点或发送消息开始对话</div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}

        {/* Node-F-051-B-12: streaming bubble reads from streamingTexts store */}
        {isCurrentAtomStreaming && (
          <div className="bubble-row bubble-row--ai">
            <div className="bubble bubble--ai bubble--streaming">
              {currentStreamingText && (
                <pre className="streaming-plain-text">{currentStreamingText}</pre>
              )}
              {toolCallStatuses.map((tc) => {
                const summary = tc.name === 'read_file'
                  ? (tc.input.path as string | undefined ?? '').split('/').slice(-2).join('/')
                  : tc.name === 'search_vault'
                  ? `"${tc.input.keyword as string | undefined ?? ''}"`
                  : JSON.stringify(tc.input).slice(0, 40)
                return (
                  <div key={tc.id} className={`tool-status tool-status--${tc.status}`}>
                    {tc.status === 'running' && <span className="tool-status__spinner" />}
                    {tc.status === 'done' && <span className="tool-status__icon">✓</span>}
                    {tc.status === 'error' && <span className="tool-status__icon tool-status__icon--error">✗</span>}
                    <span className="tool-status__label">
                      {tc.status === 'running' && `正在执行工具：${tc.name}（${summary}）...`}
                      {tc.status === 'done' && `工具执行完成：${tc.name}（${tc.durationMs}ms）`}
                      {tc.status === 'error' && `工具执行失败：${tc.error}`}
                    </span>
                  </div>
                )
              })}
              {!currentStreamingText && toolCallStatuses.length === 0 && (
                <span className="streaming-cursor" />
              )}
            </div>
          </div>
        )}

        {/* 节点 5.2：暂停干预组件 */}
        <InterventionInline />

        {streamingState === 'error' && (
          <div className="chat-error">
            请求失败：请检查网络或 API Key
            <button onClick={() => setStreamingState('idle')}>关闭</button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <ContextIndicator />
        <div className="chat-model-row">
          <select
            className="chat-model-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={streamingAtoms.size > 0}
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            className={`chat-caching-btn${cachingEnabled ? ' chat-caching-btn--active' : ''}`}
            onClick={() => setCachingEnabled(!cachingEnabled)}
            title={cachingEnabled ? '关闭 Prompt Caching' : '开启 Prompt Caching'}
          >
            Caching
          </button>
        </div>
        <div className="chat-input-row">
          <textarea
            className="chat-input"
            value={expandedInput}
            onChange={(e) => {
              setExpandedInput(e.target.value)
              if (e.target.value.trim()) { setIsUserInputting(true) } else { setIsUserInputting(false) }
            }}
            placeholder={currentPath.length ? '输入消息…' : selectedProjectId ? '输入消息，自动开始新对话…' : '请先在左侧选择项目'}
            disabled={!currentPath.length && !selectedProjectId}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          <button
            className="chat-expand-btn"
            onClick={() => setP4Mode('text-input')}
            title="展开到 P4 编辑 (⤢)"
          >
            ⤢
          </button>
          {/* 节点 5.2：streaming 时显示暂停按钮 */}
          {streamingState === 'streaming' && (
            <button
              className="chat-pause-btn"
              onClick={() => void window.api.agent.pause()}
              title="暂停 Agent（下一个工具执行前生效）"
            >
              ⏸
            </button>
          )}
          {/* Node-F-051-B-14: stop button shows when current atom is streaming */}
          {isCurrentAtomStreaming ? (
            <button className="chat-stop-btn" onClick={handleStop}>停止</button>
          ) : (
            <button
              className="chat-send-btn"
              onClick={handleSend}
              disabled={!expandedInput.trim() || (!currentPath.length && !selectedProjectId)}
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
