/**
 * ChatInputV2 — v0.15.1 节点 2.1
 *
 * 发送按钮三态机（req-061 行为表）：
 *   - idle / cancelled / error → 按钮 ▶ Send，onClick = handleSend，输入框可用
 *   - streaming                → 按钮 ⏸ Pause，onClick = handlePause，输入框 disabled
 *   - paused                   → 按钮 ⏸ disabled，no-op，输入框 disabled
 *
 * 视觉：
 *   - 按钮颜色：idle → var(--accent)；running → var(--pause)（项目内 amber/琥珀，对应 design-spec warn 语义）
 *   - 状态切换使用 transition: background-color var(--dur) var(--ease) Design Token
 *   - 运行态输入框背景切换 var(--surface-2)，强化"当前不可输入"
 *
 * 业务：
 *   - handleSend / handlePause 由 useChatSend hook 提供（节点 2.2）
 *   - 输入文本来自 expandedInput store slice（与 ChatView 一致）
 */

import { useStore } from '../../store'
import type { ToolCallStatus } from '../../hooks/useChatSend'
import { ContextIndicator } from '../ContextIndicator/ContextIndicator'
import './ChatInputV2.css'

export interface ChatInputV2Props {
  handleSend: () => void
  handlePause: () => void
  model: string
  setModel: (m: string) => void
  MODELS: string[]
  toolCallStatuses: ToolCallStatus[]
}

export function ChatInputV2(props: ChatInputV2Props) {
  const { handleSend, handlePause, model, setModel, MODELS, toolCallStatuses } = props
  const streamingState = useStore((s) => s.streamingState)
  const expandedInput = useStore((s) => s.expandedInput)
  const setExpandedInput = useStore((s) => s.setExpandedInput)
  const setIsUserInputting = useStore((s) => s.setIsUserInputting)
  const cachingEnabled = useStore((s) => s.cachingEnabled)
  const setCachingEnabled = useStore((s) => s.setCachingEnabled)
  const setP4Mode = useStore((s) => s.setP4Mode)
  const currentPath = useStore((s) => s.currentPath)
  const selectedProjectId = useStore((s) => s.selectedProjectId)

  // 按钮派生逻辑（technical.md 节点 2.1 三态判定）
  const isIdle =
    streamingState === 'idle' ||
    streamingState === 'cancelled' ||
    streamingState === 'error'
  const isRunning = streamingState === 'streaming'
  const isPaused = streamingState === 'paused'

  const inputDisabledByState = isRunning || isPaused
  const inputDisabledByContext = !currentPath.length && !selectedProjectId
  const inputDisabled = inputDisabledByState || inputDisabledByContext

  // 行为表派生：onClick / 图标 / 禁用
  let btnIcon = '↑'
  let btnClass = 'chat-input-btn chat-input-btn--send'
  let btnDisabled = !expandedInput.trim() || inputDisabledByContext
  let btnOnClick: () => void = handleSend
  let btnTitle = '发送 (Enter)'

  if (isRunning) {
    btnIcon = '⏸'
    btnClass = 'chat-input-btn chat-input-btn--pause'
    btnDisabled = false
    btnOnClick = handlePause
    btnTitle = '暂停 (Pause)'
  } else if (isPaused) {
    btnIcon = '⏸'
    btnClass = 'chat-input-btn chat-input-btn--pause chat-input-btn--paused-disabled'
    btnDisabled = true
    btnOnClick = () => {}
    btnTitle = '已暂停，请在干预卡片中操作'
  }

  return (
    <div className="chat-footer">
      <ContextIndicator />
      <div
        className={`chat-input-wrap chat-input-wrap--${
          isRunning ? 'running' : isPaused ? 'paused' : 'idle'
        }`}
      >
        <div className="chat-input-row">
          <textarea
            className="chat-input"
            value={expandedInput}
            onChange={(e) => {
              setExpandedInput(e.target.value)
              if (e.target.value.trim()) {
                setIsUserInputting(true)
              } else {
                setIsUserInputting(false)
              }
            }}
            placeholder={
              isRunning
                ? 'Agent 运行中…（点 ⏸ 暂停）'
                : isPaused
                  ? 'Agent 已暂停，请在上方干预卡片操作'
                  : currentPath.length
                    ? '输入消息…'
                    : selectedProjectId
                      ? '输入消息，自动开始新对话…'
                      : '请先在左侧选择项目'
            }
            disabled={inputDisabled}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (isIdle) handleSend()
              }
            }}
          />
          <button
            className={btnClass}
            onClick={btnOnClick}
            disabled={btnDisabled}
            title={btnTitle}
            aria-label={btnTitle}
          >
            {btnIcon}
          </button>
        </div>
        <div className="chat-input-meta">
          <select
            className="meta-chip chat-model-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={isRunning || isPaused}
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            className={`meta-chip${cachingEnabled ? ' meta-chip--on' : ''}`}
            onClick={() => setCachingEnabled(!cachingEnabled)}
            title={cachingEnabled ? '关闭 Prompt Caching' : '开启 Prompt Caching'}
          >
            Caching
          </button>
          <button
            className="meta-chip"
            onClick={() => setP4Mode('text-input')}
            title="展开到 P4 编辑 (⤢)"
          >
            ⤢
          </button>
          <span className="chat-meta-spacer" />
          <span className="chat-shortcut-hint">⌘↵ 发送 · ⌘K 新节点</span>
          <span className="chat-meta-spacer" />
          {toolCallStatuses.length > 0 && (
            <span className="chat-tool-running-hint">
              工具调用中 ({toolCallStatuses.filter((t) => t.status === 'running').length})
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
