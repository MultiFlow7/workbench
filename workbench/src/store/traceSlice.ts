/**
 * traceSlice — v0.15 节点 4.5 / 4.6
 *
 * 管理 ProcessTrace 三层折叠状态 + 流式 liveRounds 缓冲。
 *
 * 折叠默认值：
 *   processCollapsed      = false（整体展开）
 *   thinkingGroupCollapsed = false（思维链展开）
 *   toolGroupCollapsed     = true（工具列表默认收起）
 *
 * liveRounds 用于流式渲染：agentEventDispatcher 实时追加，
 * result 事件后由 finalizeLiveTrace() 清空。
 */

import { StateCreator } from 'zustand'
import type { Round, Tool } from '../lib/atomParser'

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export interface TraceSlice {
  /** 整体折叠 */
  processCollapsed: boolean
  /** 思维链 group 折叠 */
  thinkingGroupCollapsed: boolean
  /** 工具 group 折叠 */
  toolGroupCollapsed: boolean
  /** 单项思维 override，key = roundIndex（字符串） */
  thinkOverrides: Record<string, boolean>
  /** 单项工具 override，key = toolUseId */
  toolOverrides: Record<string, boolean>

  toggleProcess: () => void
  toggleThinkingGroup: () => void
  toggleToolGroup: () => void
  toggleThinkOverride: (key: string) => void
  toggleToolOverride: (key: string) => void
  /** 切节点时调用，重置折叠状态为默认值 */
  resetTrace: () => void

  // ─── 流式缓冲（节点 4.6）──────────────────────────────────────────────────

  /** 当前流式进行中的轮次（result 事件后清空） */
  liveRounds: Round[]

  appendLiveTool: (args: {
    roundIndex: number
    toolName: string
    toolUseId: string
    input: unknown
  }) => void

  finishLiveTool: (args: {
    toolUseId: string
    result: unknown
  }) => void

  appendLiveThinking: (args: {
    roundIndex: number
    content: string
  }) => void

  /** agent result 事件后清空临时缓冲 */
  finalizeLiveTrace: () => void
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function ensureRound(rounds: Round[], index: number): Round[] {
  const next = [...rounds]
  while (next.length <= index) {
    next.push({ tools: [] })
  }
  return next
}

// ─── Slice 实现 ──────────────────────────────────────────────────────────────

export const createTraceSlice: StateCreator<TraceSlice> = (set) => ({
  // 折叠状态默认值
  processCollapsed: false,
  thinkingGroupCollapsed: false,
  toolGroupCollapsed: true,
  thinkOverrides: {},
  toolOverrides: {},

  // 折叠 actions
  toggleProcess: () =>
    set((s) => ({ processCollapsed: !s.processCollapsed })),

  toggleThinkingGroup: () =>
    set((s) => ({ thinkingGroupCollapsed: !s.thinkingGroupCollapsed })),

  toggleToolGroup: () =>
    set((s) => ({ toolGroupCollapsed: !s.toolGroupCollapsed })),

  toggleThinkOverride: (key) =>
    set((s) => ({
      thinkOverrides: {
        ...s.thinkOverrides,
        [key]: !s.thinkOverrides[key],
      },
    })),

  toggleToolOverride: (key) =>
    set((s) => ({
      toolOverrides: {
        ...s.toolOverrides,
        [key]: !s.toolOverrides[key],
      },
    })),

  resetTrace: () =>
    set({
      processCollapsed: false,
      thinkingGroupCollapsed: false,
      toolGroupCollapsed: true,
      thinkOverrides: {},
      toolOverrides: {},
      liveRounds: [],
    }),

  // 流式缓冲初始值
  liveRounds: [],

  appendLiveTool: ({ roundIndex, toolName, toolUseId, input }) =>
    set((s) => {
      const rounds = ensureRound(s.liveRounds, roundIndex)
      const round = rounds[roundIndex]
      const newTool: Tool & { _toolUseId?: string } = {
        name: toolName,
        input: typeof input === 'string' ? input : JSON.stringify(input, null, 2),
        result: '',
        status: 'done' as const,
        _toolUseId: toolUseId,
      }
      const updatedRound: Round = {
        ...round,
        tools: [...round.tools, newTool],
      }
      const nextRounds = [...rounds]
      nextRounds[roundIndex] = updatedRound
      return { liveRounds: nextRounds }
    }),

  finishLiveTool: ({ toolUseId, result }) =>
    set((s) => {
      const resultStr =
        typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      const nextRounds = s.liveRounds.map((round) => ({
        ...round,
        tools: round.tools.map((tool) => {
          const t = tool as Tool & { _toolUseId?: string }
          if (t._toolUseId === toolUseId) {
            return { ...t, result: resultStr, status: 'done' as const }
          }
          return tool
        }),
      }))
      return { liveRounds: nextRounds }
    }),

  appendLiveThinking: ({ roundIndex, content }) =>
    set((s) => {
      const rounds = ensureRound(s.liveRounds, roundIndex)
      const round = rounds[roundIndex]
      const updatedRound: Round = {
        ...round,
        thinking: (round.thinking ?? '') + content,
      }
      const nextRounds = [...rounds]
      nextRounds[roundIndex] = updatedRound
      return { liveRounds: nextRounds }
    }),

  finalizeLiveTrace: () => set({ liveRounds: [] }),
})
