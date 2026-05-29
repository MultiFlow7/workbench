/**
 * agentEventDispatcher — renderer 侧 agent 事件分发器（v0.15 节点 2.3 / 4.6）
 *
 * 监听主进程通过 'agent:event' IPC 频道推送的事件，
 * 按事件类型映射到 Zustand conversationStore 的对应 action。
 *
 * 事件类型映射：
 *   text        → conversationStore.appendStreamingText(activeAtomId, content)
 *   thinking    → traceSlice.appendLiveThinking({ roundIndex, content })
 *   tool_use    → conversationStore.setAtomStreaming(activeAtomId)
 *                 + traceSlice.appendLiveTool({ roundIndex, toolName, toolUseId, input })
 *   tool_result → traceSlice.finishLiveTool({ toolUseId, result })
 *   result      → conversationStore.setAtomDone(activeAtomId) + clearStreamingText
 *                 + traceSlice.finalizeLiveTrace()
 *   error       → conversationStore.setStreamingState('error')
 *
 * 保持与 v0.14 conversationSlice（appendStreamingText / setAtomStreaming / setAtomDone）
 * 签名完全兼容，无破坏性修改。
 *
 * 节点 4.6 新增：traceSlice 写入（liveRounds 实时追加）。
 * roundIndex 由内部计数器 _currentRoundIndex 追踪（每次 tool_use 到来时按需递增）。
 */

import { useStore } from '../store'

// ─── AgentEvent 类型（与主进程 SDKBridge 保持同步）────────────────────────────

type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; toolName: string; input: unknown; toolUseId: string }
  | { type: 'tool_result'; toolUseId: string; result: unknown }
  | { type: 'result'; finalResult: unknown }
  | { type: 'error'; message: string }
  | { type: 'raw'; data: unknown }

// ─── 内部状态 ─────────────────────────────────────────────────────────────────

/** 当前正在接收流的 atomId，由外部调用 setActiveAtomId() 设置 */
let _activeAtomId: string | null = null

/** 已注册的 unlisten 函数（防止重复注册） */
let _unlisten: (() => void) | null = null

/**
 * 当前 thinking 轮次索引（节点 4.6）。
 * thinking 事件追加到当前轮次，tool_use 事件触发轮次递增（首次不递增）。
 */
let _currentRoundIndex = 0

/** 是否已进入第一个轮次（用于首次 tool_use 不递增） */
let _firstToolSeen = false

// ─── 公开 API ─────────────────────────────────────────────────────────────────

/**
 * 设置当前活跃的 atomId，agentEventDispatcher 将把事件关联到该 atom。
 * 应在调用 ipcAgent.start() 之前设置。
 * 同时重置轮次计数器。
 */
export function setActiveAtomId(atomId: string | null): void {
  _activeAtomId = atomId
  _currentRoundIndex = 0
  _firstToolSeen = false
}

/**
 * 获取当前活跃的 atomId。
 */
export function getActiveAtomId(): string | null {
  return _activeAtomId
}

/**
 * 初始化 agentEventDispatcher，注册 'agent:event' IPC 监听。
 * 幂等：多次调用只注册一次监听。
 * 应在 src/main.tsx bootstrap() 中调用。
 */
export function initAgentEventDispatcher(): void {
  if (_unlisten) return // 已注册，幂等

  const unlisten = window.api.listen<AgentEvent>('agent:event', ({ payload }) => {
    _handleEvent(payload)
  })

  // window.api.listen 返回 Promise<unlisten>
  unlisten.then((fn) => {
    _unlisten = fn
  })
}

/**
 * 清理监听器（如 HMR 或组件卸载时使用）。
 */
export function cleanupAgentEventDispatcher(): void {
  if (_unlisten) {
    _unlisten()
    _unlisten = null
  }
}

// ─── 事件分发逻辑 ─────────────────────────────────────────────────────────────

function _handleEvent(event: AgentEvent): void {
  const atomId = _activeAtomId
  const store = useStore.getState()

  switch (event.type) {
    case 'text': {
      if (atomId) {
        store.appendStreamingText(atomId, event.content)
      }
      break
    }
    case 'thinking': {
      // 节点 4.6：写入 traceSlice liveRounds（附加到当前轮次）
      store.appendLiveThinking({ roundIndex: _currentRoundIndex, content: event.content })
      // 保留原 streaming text 写入（向后兼容）
      if (atomId) {
        store.appendStreamingText(atomId, `[thinking] ${event.content}`)
      }
      break
    }
    case 'tool_use': {
      // 节点 4.6：每次 tool_use 开启新轮次（首次不递增）
      if (_firstToolSeen) {
        _currentRoundIndex++
      } else {
        _firstToolSeen = true
      }
      store.appendLiveTool({
        roundIndex: _currentRoundIndex,
        toolName: event.toolName,
        toolUseId: event.toolUseId,
        input: event.input,
      })
      if (atomId) {
        // 工具调用开始：标记 atom 为 streaming 状态
        store.setAtomStreaming(atomId)
        store.appendStreamingText(atomId, `[tool:${event.toolName}] `)
      }
      break
    }
    case 'tool_result': {
      // 节点 4.6：填入工具结果
      store.finishLiveTool({ toolUseId: event.toolUseId, result: event.result })
      // 工具结果返回：不结束 streaming（可能还有后续 text 或 tool_use）
      if (atomId) {
        store.appendStreamingText(atomId, `[/tool:${event.toolUseId}] `)
      }
      break
    }
    case 'result': {
      // 节点 4.6：清空流式缓冲
      store.finalizeLiveTrace()
      // agent 最终完成
      if (atomId) {
        store.setAtomDone(atomId)
        store.clearStreamingText(atomId)
      }
      store.setStreamingState('idle')
      _activeAtomId = null
      _currentRoundIndex = 0
      _firstToolSeen = false
      break
    }
    case 'error': {
      // 节点 4.6：出错时也清空流式缓冲
      store.finalizeLiveTrace()
      if (atomId) {
        store.setAtomDone(atomId)
        store.clearStreamingText(atomId)
      }
      store.setStreamingState('error')
      _activeAtomId = null
      _currentRoundIndex = 0
      _firstToolSeen = false
      break
    }
    case 'raw': {
      // 调试用原始数据，忽略
      break
    }
  }
}
