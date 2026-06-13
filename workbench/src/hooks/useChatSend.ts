/**
 * useChatSend — v0.15.1 节点 2.2（P4 r13 重写）
 *
 * 发送/取消/暂停逻辑（仅业务，不含渲染）。
 *
 * v0.15.1 P4（r13）协议切换：
 *   旧路径：window.api.invoke('stream_ai', ...) + ai-token / ai-done / ai-tool-call 监听
 *   新路径：window.api.agent.start(prompt, options) + agent:event（agentEventDispatcher 已接管）
 *
 * 切换根因：electron/ipc/handlers.ts:477 `stream_ai` 自 v0.15 起就是 stubOk noop（注释明示
 * "Phase 2 通过 agent:start/stop 接入"）。v0.15 节点 2.x 在主进程侧建立了 LocalRunner /
 * RemoteRunner / SDKBridge 完整新通路，agentEventDispatcher（节点 2.3 / 4.6 / 4.8）也接管
 * 了 agent:event → conversationSlice / traceSlice / 落盘的完整映射。但是 renderer 侧 chat
 * 主入口 useChatSend 在 v0.15.1 节点 2.2 抽取 hook 时只是 1:1 搬运了旧的 stream_ai 调用，
 * 没有跟着切到新通路。结果：消息发送进 stubOk 黑洞，无任何事件返回，streamingState 永远卡
 * 在 'streaming'，前端表现为「输入框灰了，但没有 AI 响应」。
 *
 * P4 改动：
 *   1. handleSend 改用 window.api.agent.start({prompt, options})，prompt 由历史 + 新问
 *      题拼接成单一字符串（SDK programmatic query 模式只接受单 prompt）
 *   2. 删除所有 ai-* 事件监听（agentEventDispatcher 已经在 main.tsx 接管）
 *   3. 删除工具调用接续逻辑（execute_tool / tool_use → 自实现 messages 拼接） — SDK 内置工具
 *      由 PreToolUse hook 广播 tool_use / tool_result，dispatcher 负责映射到 traceSlice
 *   4. 删除 ai-done 中的 write_qa_atom 二次落盘 — agentEventDispatcher._flushAtomToDisk
 *      在收到 result 事件时统一负责
 *   5. handleStop → window.api.agent.stop()；cancel_stream IPC 退役
 *   6. 进入 streaming 时显式 setStreamingState('streaming') + setActiveAtomId(newAtomId)，
 *      session buffer 由 dispatcher 内部管理
 *   7. toolCallStatuses 简化为空数组（liveRounds 已是 traceSlice 真源），保留接口避免 V2
 *      组件 props 变更，但行为退化为 noop
 *
 * 返回：
 *   - handleSend(): 发送当前 expandedInput
 *   - handleStop(): 取消当前 agent
 *   - handlePause(): 触发 agent.pause（req-061 节点 2.1 暂停按钮）
 *   - toolCallStatuses: 工具调用进行中的列表（节点 P4 退化为始终为空，liveRounds 才是真源）
 *   - model / setModel / MODELS: 模型选择
 *   - atomEntries: 已加载的 atom 列表（含 frontmatter + parsed）
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../store'
import type { QAAtomMeta } from '../store/conversationSlice'
import { findKeyForModel } from '../store/settingsSlice'
import { useBasePath, useVaultPath, buildFilePath, toFilePathFromSnapshot } from '../utils/paths'
import { parseAtom } from '../lib/atomParser'
import type { ParsedAtom } from '../lib/atomParser'
import {
  setActiveAtomId as dispatcherSetActiveAtomId,
  setSessionQ as dispatcherSetSessionQ,
} from '../lib/agentEventDispatcher'

// v0.16 R-2: VAULT_PATH 常量已重写为 useVaultPath hook，旧引用清理完成

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
    const fileExists = await window.api.fsExists(toFilePathFromSnapshot(candidate))
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
  const extendCurrentPath = useStore((s) => s.extendCurrentPath)
  const selectAtom = useStore((s) => s.selectAtom)
  const addAtomToProject = useStore((s) => s.addAtomToProject)
  const setIsUserInputting = useStore((s) => s.setIsUserInputting)
  const clearPendingEvents = useStore((s) => s.clearPendingEvents)
  const apiKeys = useStore((s) => s.apiKeys)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  const setAtomStreaming = useStore((s) => s.setAtomStreaming)
  const expandedInput = useStore((s) => s.expandedInput)
  const setExpandedInput = useStore((s) => s.setExpandedInput)
  const selectedAtomId = useStore((s) => s.selectedAtomId)
  // v0.15.1 P7（r16）：流式结束后 dispatcher bump 对应 atom 版本号，
  // useEffect 监听该字典变化触发 atomEntries 重载（从磁盘读到最终答案）。
  const atomDiskRevisions = useStore((s) => s.atomDiskRevisions)

  // v0.16 R-2：vault 路径派生（替代旧 BASE_PATH / VAULT_PATH 常量）
  const basePath = useBasePath()
  // 保留以兼容未来工具默认参数使用
  const vaultPath = useVaultPath()
  void vaultPath

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
  // v0.15.1 P4 r13：toolCallStatuses 退化为空（liveRounds 是 traceSlice 真源），保留接口
  // 让 ChatInputV2 props 不变；未来若需要"工具进行中"局部 UI，订阅 liveRounds 即可。
  const toolCallStatuses: ToolCallStatus[] = []

  const currentPathRef = useRef(currentPath)
  const modelRef = useRef(model)
  const selectedAtomIdRef = useRef<string | null>(null)
  const activeStreamAtomIdRef = useRef<string | null>(null)

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
        const resp = await window.api.invoke<{ answer: string; raw?: string }>('read_qa_atom', {
          filePath: buildFilePath(basePath, m.id),
        })
        // v0.15.1 P3 r10：read_qa_atom 已结构化（解析 meta/question/answer），但 parseAtom 需要
        // 完整 markdown 文本以提取 ## Steps / ## Intervention，故优先用 resp.raw；
        // 老版本 IPC 返回 answer=整文件，回退兼容
        const source = resp.raw ?? resp.answer ?? ''
        const parsed = parseAtom(source)
        return { meta: m, parsed } satisfies AtomEntry
      }),
    )
      .then((entries) => {
        if (!cancelled) {
          setAtomEntries(entries)
          // v0.15.1 P3 r11 debug：原 atomParser 会把答案内 `## 二级标题` 误识为顶层 section，
          // 导致 response 截断。若仍出现 P3 不显示，先看这行确认 q/response 长度。
          if (typeof console !== 'undefined') {
            const summary = entries.map((e) => ({
              id: e.meta.id,
              qLen: e.parsed.q.length,
              respLen: e.parsed.response.length,
              steps: e.parsed.steps?.length ?? null,
            }))
            console.log('[v0.15.1-p3-debug] atomEntries loaded:', summary)
          }
        }
      })
      .catch((e) => console.error('[useChatSend] load atoms error:', e))
    return () => { cancelled = true }
    // v0.15.1 P7（r16）：依赖加上 atomDiskRevisions 的相关 atom 版本汇总，
    // dispatcher 落盘后 bump 版本号 → 触发 effect 重跑 → 读到最终答案，
    // 解决「AI 回复一闪而过又消失」（流式 streamingTexts 清空后 atomEntries 未更新）。
    // 用 path 内每个 atom 的版本号串联，避免无关 atom bump 触发重读。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, currentPath.map((m) => atomDiskRevisions[m.id] ?? 0).join(',')])

  // v0.15.1 P4 r13：旧的 ai-* 事件监听整块删除。
  // agent:event 由 src/main.tsx::initAgentEventDispatcher 统一接管，映射到
  // conversationSlice（appendStreamingText / setAtomStreaming / setAtomDone）和
  // traceSlice（liveRounds），落盘由 _flushAtomToDisk 在 result 事件触发。
  // useChatSend 不再持有事件订阅，避免重复触发。

  // v0.2: 构造 system prompt（后台任务摘要）— 转为 prompt 文本前缀（SDK 无独立 system 字段）
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

  /**
   * 拼接历史 + 当前问题为 SDK 单一 prompt 字符串。
   * SDK programmatic query() 模式只接受 prompt: string，无 messages array。
   * 历史路径已在前置 placeholder 写盘前累积；这里把 atomEntries 与 currentPath 交集
   * 还原成 ## User / ## Assistant 形态供模型读历史。
   */
  function buildPromptString(
    historyEntries: AtomEntry[],
    pathIds: Set<string>,
    questionText: string,
    systemPrompt?: string,
  ): string {
    const parts: string[] = []
    if (systemPrompt) {
      parts.push(systemPrompt)
      parts.push('')
    }
    for (const entry of historyEntries) {
      if (!pathIds.has(entry.meta.id)) continue
      if (entry.parsed.q) {
        parts.push(`## User`)
        parts.push(entry.parsed.q)
        parts.push('')
      }
      if (entry.parsed.response) {
        parts.push(`## Assistant`)
        parts.push(entry.parsed.response)
        parts.push('')
      }
    }
    parts.push(`## User`)
    parts.push(questionText)
    return parts.join('\n')
  }

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
    } else {
      if (!selectedProjectId) return
      if (!projects.find((p) => p.id === selectedProjectId)) return
      const branchId = await window.api.invoke<string>('next_branch_id', { qaDir: basePath })
      const now = new Date()
      const pad2 = (n: number) => String(n).padStart(2, '0')
      const dateStr = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
      const timeStr = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
      newAtomId = `${branchId}-001-${dateStr}-${timeStr}`
    }

    activeStreamAtomIdRef.current = newAtomId
    const questionText = expandedInput

    clearPendingEvents()
    setIsUserInputting(false)

    // 占位 atom 落盘（让分支树/历史能立即看到节点）— 实际答案体由 agentEventDispatcher
    // 在 result 事件时通过 _flushAtomToDisk 覆盖写入完整内容（Q / Steps / Intervention / A）
    const placeholderPrev = parentMeta ? `[[${parentMeta.id}]]` : null
    await window.api.invoke('write_qa_atom', {
      filePath: buildFilePath(basePath, newAtomId),
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
    // v0.15.1 P7（r16）：扩展 currentPath，让新节点立即进入 atomEntries 渲染队列。
    // 否则 ChatViewV2 只渲染 atomEntries（来自 currentPath），新流式节点永远不显示，
    // 用户表现为「P2 节点显示运行中、P3 无变化、AI 回复一闪而过又消失」。
    extendCurrentPath(placeholderMeta)
    setAtomStreaming(newAtomId)
    setStreamingState('streaming')

    // 通知 dispatcher：当前流式目标 = newAtomId（重置 session buffer / 轮次计数器）
    dispatcherSetActiveAtomId(newAtomId)
    dispatcherSetSessionQ(questionText)

    if (selectedProjectId) {
      const proj = projects.find((p) => p.id === selectedProjectId)
      if (proj) {
        addAtomToProject(proj.name, newAtomId).catch(console.error)
      }
    }

    opts.requestScrollToBottom()
    setExpandedInput('')

    // 历史消息从已加载的 atomEntries 派生（仅当前分支）
    const currentPathIds = new Set(currentPath.map((a) => a.id))
    const systemPrompt = await buildSystemPrompt()
    const promptString = buildPromptString(atomEntries, currentPathIds, questionText, systemPrompt)

    window.api.invoke('write_event_log', { event: { event: 'message_sent', timestamp: new Date().toISOString(), payload: { path_length: currentPath.length, model } } }).catch(() => {})

    // 选择 provider key 的 baseUrl（main 进程 r14 反查会覆盖，这里仍传作为冗余/提示）
    const keyEntry = findKeyForModel(apiKeys, model)
    const baseUrl = keyEntry?.baseUrl

    // v0.15.1 P5 r14：把 model 透传给 main，让 main 进程按 model 反查 settings.apiKeys
    // 注入 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL 到 SDKBridge env。
    window.api.agent
      .start(promptString, {
        model,
        ...(baseUrl ? { baseUrl } : {}),
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[useChatSend] agent.start error:', msg)
        setStreamingState('error')
        dispatcherSetActiveAtomId(null)
        activeStreamAtomIdRef.current = null
      })
  }, [expandedInput, currentPath, atomEntries, selectedProjectId, projects, appendAtom, extendCurrentPath, setAtomStreaming,
      addAtomToProject, setExpandedInput, buildSystemPrompt,
      apiKeys, model, setStreamingState, clearPendingEvents, setIsUserInputting, opts])

  const handleStop = useCallback(() => {
    window.api.agent.stop().catch(console.error)
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

  // 兜底：未使用变量提示规避（selectAtom 在 P4 r13 之前由 ai-done 链路使用，
  // 此处保留依赖订阅以便 _atomsRef 派生稳定，但实际选择由 dispatcher 触发 selectedAtomId
  // 不再发生在 hook 层；如未来需要"流完成后自动选中新 atom"再恢复）
  void selectAtom

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
