import { useEffect, useRef, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { exists } from '@tauri-apps/plugin-fs'
import { useStore } from '../../store'
import type { QAAtomMeta } from '../../store/conversationSlice'
import { findKeyForModel } from '../../store/settingsSlice'
import { toFilePath, VAULT_PATH, BASE_PATH } from '../../utils/paths'
import { getContextLimit } from '../../constants/modelLimits'
import { ContextIndicator } from '../ContextIndicator/ContextIndicator'
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
    const fileExists = await exists(toFilePath(candidate))
    if (!fileExists) return candidate
    seqNum++
  }
  throw new Error('ID space exhausted')
}

export function ChatView() {
  const currentPath = useStore((s) => s.currentPath)
  const streamingState = useStore((s) => s.streamingState)
  const setStreamingState = useStore((s) => s.setStreamingState)
  const appendAtom = useStore((s) => s.appendAtom)
  const selectAtom = useStore((s) => s.selectAtom)
  // v0.2
  const setIsUserInputting = useStore((s) => s.setIsUserInputting)
  const clearPendingEvents = useStore((s) => s.clearPendingEvents)
  // v0.3
  const updateAtomTokens = useStore((s) => s.updateAtomTokens)
  const apiKeys = useStore((s) => s.apiKeys)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)

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
  const [streamingText, setStreamingText] = useState('')
  const [model, setModel] = useState(MODELS[0])
  const [lastError, setLastError] = useState<string>('')
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
  // T-4: idle timeout ref — reset on every ai-token; fires only if no tokens for STREAM_TIMEOUT_MS
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // stored callback for the current timeout, so ai-token can reset without capturing stale closures
  const streamTimeoutCbRef = useRef<(() => void) | null>(null)
  // 用 ref 避免 listener 因 state 变化而重新注册（防止事件丢失竞态）
  const currentPathRef = useRef(currentPath)
  const modelRef = useRef(model)
  // pendingQuestionRef: captures the user's question at send time so ai-done can read it
  // after setInput('') has already cleared the input state
  const pendingQuestionRef = useRef('')
  // pendingIsNewRootRef: true when the next ai-done should write prev:null (no placeholder root atom)
  const pendingIsNewRootRef = useRef(false)
  // pendingPrevWikilinkRef: fixed at handleSend time; used by all ai-done handlers for this request
  // (prevents tool-call continuation from re-reading currentPath which now includes the atom itself)
  const pendingPrevWikilinkRef = useRef<string | null>(null)
  // Tool calling refs — hold state for continuation after tool execution
  const pendingMessagesRef = useRef<Array<{ role: string; content: unknown }>>([])
  const systemPromptRef = useRef<string | undefined>(undefined)
  const streamingTextRef = useRef('')
  // activeStreamAtomIdRef: tracks the atom_id of the current active stream (req-050 leak prevention)
  const activeStreamAtomIdRef = useRef<string | null>(null)
  // True from the moment ai-tool-call fires (sync, before any await) until ai-done/error/cancel.
  // handleSend reads this to skip setting Timer A when a tool call has already started.
  const toolCallInProgressRef = useRef(false)
  const [toolCallStatuses, setToolCallStatuses] = useState<ToolCallStatus[]>([])
  useEffect(() => { currentPathRef.current = currentPath }, [currentPath])
  useEffect(() => { modelRef.current = model }, [model])

  // Load full atoms when path changes
  useEffect(() => {
    if (!currentPath.length) {
      setMessages([])
      return
    }
    let cancelled = false
    Promise.all(
      currentPath.map((m) =>
        invoke<QAAtom>('read_qa_atom', { filePath: toFilePath(m.id) })
      )
    )
      .then((atoms) => {
        const msgs = flattenToMessages(atoms)
        // Don't clear an in-progress conversation: if the loaded path resolves to empty
        // (e.g. a freshly created root atom) but streaming is active, skip the update to
        // avoid wiping the user message already shown in the chat.
        if (!cancelled && (msgs.length > 0 || useStore.getState().streamingState !== 'streaming')) {
          setMessages(msgs)
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

  // Register ai-token / ai-done / ai-error / ai-cancelled listeners
  useEffect(() => {
    const unlisteners: Array<() => void> = []

    // Node-F-2: ai-token handler with atom_id filter to prevent content leaking across atoms
    listen<{ atom_id: string; text: string }>('ai-token', (e) => {
      if (activeStreamAtomIdRef.current && e.payload.atom_id !== activeStreamAtomIdRef.current) return
      streamingTextRef.current += e.payload.text
      setStreamingText((prev) => prev + e.payload.text)
      if (isNearBottom()) scrollToBottom()
      if (streamTimeoutCbRef.current && streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current)
        streamTimeoutRef.current = setTimeout(streamTimeoutCbRef.current, STREAM_TIMEOUT_MS)
      }
    }).then((u) => unlisteners.push(u))

    listen<{ atom_id: string; tool_use_id: string; tool_name: string; tool_input: Record<string, unknown> }>('ai-tool-call', async (e) => {
      // Set flag synchronously (before any await) so handleSend's post-race code sees it
      toolCallInProgressRef.current = true
      const { atom_id, tool_use_id, tool_name, tool_input } = e.payload
      const startedAt = Date.now()
      setToolCallStatuses((prev) => [
        ...prev,
        { id: tool_use_id, name: tool_name, input: tool_input, status: 'running', startedAt },
      ])

      let toolResult: string
      try {
        toolResult = await invoke<string>('execute_tool', {
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

      const textBeforeTool = streamingTextRef.current
      streamingTextRef.current = ''
      setStreamingText('')

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

      // Idle timeout: fires if no tokens arrive for STREAM_TIMEOUT_MS after continuation starts
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current)
      const toolContinuationTimeoutCb = () => {
        console.warn('[ChatView] tool continuation idle timeout (no tokens for 60s)')
        invoke('cancel_stream', {}).catch(() => {})
        setLastError('工具调用超时（60s 内无响应），请重试')
        setStreamingState('error')
        setStreamingText('')
        streamTimeoutCbRef.current = null
      }
      streamTimeoutCbRef.current = toolContinuationTimeoutCb
      streamTimeoutRef.current = setTimeout(toolContinuationTimeoutCb, STREAM_TIMEOUT_MS)

      invoke('stream_ai', {
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
        setLastError(msg)
        setStreamingState('error')
      })
    }).then((u) => unlisteners.push(u))

    listen<{ atom_id: string; full_content: string; input_tokens?: number; output_tokens?: number }>('ai-done', async (e) => {
      // T-4: 清除第二层超时计时器
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current)
        streamTimeoutRef.current = null
        streamTimeoutCbRef.current = null
      }
      const { atom_id, full_content, input_tokens, output_tokens } = e.payload
      const isNewRoot = pendingIsNewRootRef.current
      pendingIsNewRootRef.current = false
      // Guard: if no active conversation was started from handleSend, ignore spurious events
      if (!isNewRoot && pendingPrevWikilinkRef.current === null) return
      const currentInput = pendingQuestionRef.current
      const currentModel = modelRef.current

      // Use the prev fixed at handleSend time — do NOT re-read currentPath here,
      // because tool-call continuations fire ai-done after appendAtom/selectAtom
      // have already added this atom to currentPath, causing self-referential prev.
      const prevWikilink = pendingPrevWikilinkRef.current
      const now = new Date().toISOString()

      const hasTokens = input_tokens !== undefined && output_tokens !== undefined
      const tokenMeta = hasTokens ? {
        model: currentModel,
        usage: { input_tokens: input_tokens!, output_tokens: output_tokens! },
        context_tokens_used: input_tokens,
        context_window_limit: getContextLimit(currentModel),
      } : undefined

      await invoke('write_qa_atom', {
        filePath: toFilePath(atom_id),
        atom: {
          meta: {
            id: atom_id,
            prev: prevWikilink,
            children: [],
            summary: currentInput.slice(0, 50),
            timestamp: now,
            ...(tokenMeta ?? {}),
          },
          question: currentInput,
          answer: full_content,
        },
      }).catch(console.error)

      const newMeta: QAAtomMeta = {
        id: atom_id,
        prev: prevWikilink,
        children: [],
        summary: currentInput.slice(0, 50),
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

      // Add response atom to the current project so BranchTree can render it
      const { selectedProjectId: projId, projects: projs } = useStore.getState()
      if (projId) {
        const proj = projs.find((p) => p.id === projId)
        if (proj) {
          useStore.getState().addAtomToProject(proj.name, atom_id).catch(console.error)
        }
      }

      toolCallInProgressRef.current = false
      if (full_content) {
        shouldScrollRef.current = true
        setMessages((prev) => [...prev, { role: 'ai', content: full_content, atomId: atom_id }])
      }
      setStreamingText('')
      streamingTextRef.current = ''
      setToolCallStatuses([])
      // Second clear: handles the race where invoke('stream_ai') returned and set
      // streamTimeoutRef AFTER our first clearTimeout ran at the top of this handler
      // (both the event and the invoke response arrive as separate macrotasks, and
      // handleSend may run between our initial clear and this point)
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current)
        streamTimeoutRef.current = null
        streamTimeoutCbRef.current = null
      }
      setStreamingState('idle')

      // Node-F-4: conditional navigation — only jump to new atom if user is still on the parent node
      const _path = currentPathRef.current
      const lastInPath = _path[_path.length - 1]
      const prevId = pendingPrevWikilinkRef.current?.replace(/^\[\[|\]\]$/g, '') ?? null
      if (lastInPath?.id === prevId) {
        selectAtom(atom_id)
      }
      // Node-F-5: clear active stream ref after done
      activeStreamAtomIdRef.current = null

      const duration_ms = Date.now() - streamStartRef.current
      const token_count = Math.round(full_content.length / 4)
      invoke('write_event_log', { event: { event: 'streaming_complete', timestamp: new Date().toISOString(), payload: { duration_ms, token_count } } }).catch(() => {})
    }).then((u) => unlisteners.push(u))

    listen<{ error?: string; message?: string }>('ai-error', (e) => {
      // T-4: 清除第二层超时计时器
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current)
        streamTimeoutRef.current = null
        streamTimeoutCbRef.current = null
      }
      toolCallInProgressRef.current = false
      setLastError(e.payload?.error ?? e.payload?.message ?? '未知错误')
      setStreamingState('error')
      setStreamingText('')
      streamingTextRef.current = ''
      setToolCallStatuses([])
      // Node-F-5: clear active stream ref on error
      activeStreamAtomIdRef.current = null
    }).then((u) => unlisteners.push(u))

    listen('ai-cancelled', () => {
      // T-4: 清除第二层超时计时器
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current)
        streamTimeoutRef.current = null
        streamTimeoutCbRef.current = null
      }
      toolCallInProgressRef.current = false
      setStreamingState('cancelled')
      setStreamingText('')
      streamingTextRef.current = ''
      setToolCallStatuses([])
      // Node-F-5: clear active stream ref on cancel
      activeStreamAtomIdRef.current = null
    }).then((u) => unlisteners.push(u))

    return () => unlisteners.forEach((u) => u())
  }, [appendAtom, selectAtom, setStreamingState, updateAtomTokens])

  // v0.2: Build system prompt with active backend task summaries
  const buildSystemPrompt = useCallback(async (): Promise<string | undefined> => {
    try {
      const [pending, running, blocked, awaitingDecision] = await Promise.all([
        invoke<Array<{ task_id: string; role: string; status: string; version: string }>>('list_tasks', { filter: 'Pending' }),
        invoke<Array<{ task_id: string; role: string; status: string; version: string }>>('list_tasks', { filter: 'Running' }),
        invoke<Array<{ task_id: string; role: string; status: string; version: string }>>('list_tasks', { filter: 'Blocked' }),
        invoke<Array<{ task_id: string; role: string; status: string; version: string }>>('list_tasks', { filter: 'AwaitingDecision' }),
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
      // Backend unreachable — proceed without task summary
      return undefined
    }
  }, [])

  const handleSend = useCallback(async () => {
    if (!expandedInput.trim() || streamingState === 'streaming') return
    const parentMeta = currentPath[currentPath.length - 1] ?? null

    // Determine the new atom's ID:
    //   - New conversation (no parent): Q&A atom IS the root, prev will be null
    //   - Reply: derive next seq from parent ID
    let newAtomId: string
    if (parentMeta) {
      try {
        newAtomId = await generateNewAtomId(parentMeta.id)
      } catch (e) {
        const msg = `ID生成失败: ${e instanceof Error ? e.message : String(e)}`
        console.error('[ChatView] generateNewAtomId failed:', e)
        setLastError(msg)
        setStreamingState('error')
        return
      }
      pendingIsNewRootRef.current = false
      pendingPrevWikilinkRef.current = `[[${parentMeta.id}]]`
    } else {
      // New conversation: the Q&A itself becomes the root, no placeholder atom needed
      if (!selectedProjectId) return
      if (!projects.find((p) => p.id === selectedProjectId)) return
      const branchId = await invoke<string>('next_branch_id', { qaDir: BASE_PATH })
      const now = new Date()
      const pad2 = (n: number) => String(n).padStart(2, '0')
      const dateStr = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
      const timeStr = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
      newAtomId = `${branchId}-001-${dateStr}-${timeStr}`
      pendingIsNewRootRef.current = true
      pendingPrevWikilinkRef.current = null
    }

    // Node-F-3: record the active stream's atom_id before invoking (prevents token leaking)
    activeStreamAtomIdRef.current = newAtomId

    // v0.2: clear pending events and user inputting flag before sending
    clearPendingEvents()
    setIsUserInputting(false)

    setStreamingState('streaming')
    setStreamingText('')
    streamingTextRef.current = ''
    setToolCallStatuses([])

    // Capture question before clearing input so ai-done handler can read it via ref
    pendingQuestionRef.current = expandedInput
    shouldScrollRef.current = true
    setMessages((prev) => [...prev, { role: 'user', content: expandedInput }])
    setExpandedInput('')

    const historyMessages = messages
      .filter((m) => m.role !== 'ai' || !m.content.startsWith('— 分支节点'))
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: typeof m.content === 'string'
          ? [{ type: 'text', text: m.content }]
          : m.content,
      }))

    // v0.2: inject task context into system prompt
    const systemPrompt = await buildSystemPrompt()

    invoke('write_event_log', { event: { event: 'message_sent', timestamp: new Date().toISOString(), payload: { path_length: currentPath.length, model } } }).catch(() => {})
    streamStartRef.current = Date.now()

    // Store state for tool-call continuation
    const outgoingMessages = [
      ...historyMessages,
      { role: 'user', content: [{ type: 'text', text: expandedInput }] },
    ]
    pendingMessagesRef.current = outgoingMessages
    systemPromptRef.current = systemPrompt

    // T-4 第一层：invoke 建立连接超时
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('stream_ai timeout')), STREAM_TIMEOUT_MS)
    )
    await Promise.race([
      invoke('stream_ai', {
        messages: outgoingMessages,
        model,
        atomId: newAtomId,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        tools: TOOL_SCHEMAS,
        caching: cachingEnabled,
        providerKey: findKeyForModel(apiKeys, model)?.key ?? null,
      }),
      timeoutPromise,
    ]).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[ChatView] stream_ai error/timeout:', msg)
      setLastError(msg)
      setStreamingState('error')
      return
    })

    // T-4 第二层：仅当 ai-done 还未触发 且 没有工具调用在进行中时才设超时
    // (工具调用路径由 ai-tool-call 监听器自行管理 Timer B，避免 Timer A 与 Timer B 竞态)
    if (useStore.getState().streamingState === 'streaming' && !toolCallInProgressRef.current) {
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current)
      const idleTimeoutCb = () => {
        console.warn('[ChatView] idle timeout: no tokens for 60s')
        invoke('cancel_stream', {}).catch(() => {})
        setLastError('响应超时（60s 内无新内容），请重试')
        setStreamingState('error')
        setStreamingText('')
        streamTimeoutCbRef.current = null
      }
      streamTimeoutCbRef.current = idleTimeoutCb
      streamTimeoutRef.current = setTimeout(idleTimeoutCb, STREAM_TIMEOUT_MS)
    }
  }, [expandedInput, streamingState, currentPath, messages, selectedProjectId, projects, setStreamingState, clearPendingEvents, setIsUserInputting, buildSystemPrompt])

  const handleStop = useCallback(() => {
    invoke('cancel_stream').catch(console.error)
  }, [])

  const handleRetry = useCallback(() => {
    setStreamingState('idle')
  }, [setStreamingState])

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
        {messages.length === 0 && streamingState === 'idle' && (
          <div className="chat-empty">选择节点或发送消息开始对话</div>
        )}

        {messages.map((msg, i) => (
          msg.content.startsWith('— 分支节点') ? (
            <div key={i} className="chat-branch-marker">{msg.content}</div>
          ) : (
            <div key={i} className={`bubble-row bubble-row--${msg.role}`}>
              <div className={`bubble bubble--${msg.role}`}>
                {msg.role === 'ai' ? (
                  <div className="markdown-body">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeHighlight]}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          )
        ))}

        {streamingState === 'streaming' && (
          <div className="bubble-row bubble-row--ai">
            <div className="bubble bubble--ai bubble--streaming">
              {streamingText && (
                <pre className="streaming-plain-text">{streamingText}</pre>
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
              {!streamingText && toolCallStatuses.length === 0 && (
                <span className="streaming-cursor" />
              )}
            </div>
          </div>
        )}

        {streamingState === 'error' && (
          <div className="chat-error">
            请求失败：{lastError || '请检查网络或 API Key'}
            <button onClick={handleRetry}>重试</button>
          </div>
        )}

        {streamingState === 'cancelled' && (
          <div className="chat-error" style={{ background: '#fffbeb', borderColor: '#fbbf24', color: '#92400e' }}>
            已停止
            <button onClick={handleRetry} style={{ background: '#92400e' }}>关闭</button>
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
            disabled={streamingState === 'streaming'}
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
            disabled={streamingState === 'streaming' || (!currentPath.length && !selectedProjectId)}
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
          {streamingState === 'streaming' ? (
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
