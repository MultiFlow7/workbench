/**
 * agentEventDispatcher — renderer 侧 agent 事件分发器（v0.15 节点 2.3）
 *
 * 监听主进程通过 'agent:event' IPC 频道推送的事件，
 * 按事件类型映射到 Zustand conversationStore 的对应 action。
 *
 * 事件类型映射：
 *   text        → conversationStore.appendStreamingText(activeAtomId, content)
 *   thinking    → 暂存到内部缓冲区（UI 层可订阅 thinkingBuffer）
 *   tool_use    → conversationStore.setAtomStreaming(activeAtomId)（标记工具调用中）
 *   tool_result → conversationStore.setAtomDone(activeAtomId)（工具完成）
 *   result      → conversationStore.setAtomDone(activeAtomId) + clearStreamingText
 *   error       → conversationStore.setStreamingState('error')
 *
 * 保持与 v0.14 conversationSlice（appendStreamingText / setAtomStreaming / setAtomDone）
 * 签名完全兼容，无破坏性修改。
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

// ─── 公开 API ─────────────────────────────────────────────────────────────────

/**
 * 设置当前活跃的 atomId，agentEventDispatcher 将把事件关联到该 atom。
 * 应在调用 ipcAgent.start() 之前设置。
 */
export function setActiveAtomId(atomId: string | null): void {
  _activeAtomId = atomId
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
      // thinking 内容不直接写入 atom 文本，仅推送到 store streaming 文本
      // 前缀 [thinking] 便于 UI 层识别
      if (atomId) {
        store.appendStreamingText(atomId, `[thinking] ${event.content}`)
      }
      break
    }
    case 'tool_use': {
      if (atomId) {
        // 工具调用开始：标记 atom 为 streaming 状态
        store.setAtomStreaming(atomId)
        store.appendStreamingText(atomId, `[tool:${event.toolName}] `)
      }
      break
    }
    case 'tool_result': {
      // 工具结果返回：不结束 streaming（可能还有后续 text 或 tool_use）
      if (atomId) {
        store.appendStreamingText(atomId, `[/tool:${event.toolUseId}] `)
      }
      break
    }
    case 'result': {
      // agent 最终完成
      if (atomId) {
        store.setAtomDone(atomId)
        store.clearStreamingText(atomId)
      }
      store.setStreamingState('idle')
      _activeAtomId = null
      break
    }
    case 'error': {
      if (atomId) {
        store.setAtomDone(atomId)
        store.clearStreamingText(atomId)
      }
      store.setStreamingState('error')
      _activeAtomId = null
      break
    }
    case 'raw': {
      // 调试用原始数据，忽略
      break
    }
  }
}
