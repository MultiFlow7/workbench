/**
 * InterventionInline — v0.15 节点 5.2
 *
 * 当 streamingState === 'paused' 时，在对话流中内联显示干预组件。
 * 支持：
 *   - slideIn 动画（200ms）
 *   - 自动滚动到底部 + 聚焦 textarea
 *   - "注入并继续" / "取消（恢复执行）" 两个操作
 *   - 干预记录写入 session buffer（addIntervention）
 */

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { addIntervention } from '../../lib/agentEventDispatcher'
import type { Intervention } from '../../lib/atomParser'
import './InterventionInline.css'

export function InterventionInline() {
  const streamingState = useStore((s) => s.streamingState)
  const setStreamingState = useStore((s) => s.setStreamingState)
  const liveRounds = useStore((s) => s.liveRounds)
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 当进入 paused 状态时，自动滚动到底部 + 聚焦
  useEffect(() => {
    if (streamingState === 'paused') {
      // 等 slideIn 动画结束（200ms）后再聚焦
      setTimeout(() => {
        textareaRef.current?.focus()
        textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 220)
    }
  }, [streamingState])

  if (streamingState !== 'paused') return null

  const handleInject = async () => {
    // 节点 4.0：埋点（intervention_submitted）— 在副作用前打点，失败静默
    const trimmedText = text.trim()
    window.api.invoke('write_event_log', {
      event: {
        event: 'intervention_submitted',
        timestamp: new Date().toISOString(),
        payload: { text_length: trimmedText.length },
      },
    }).catch(() => {})
    // 节点 5.4：如果有文本，记录干预到 session buffer
    if (trimmedText) {
      const currentRoundIndex = liveRounds.length
      const intervention: Intervention = {
        afterRound: currentRoundIndex,
        text: trimmedText,
        timestamp: new Date().toISOString(),
      }
      addIntervention(intervention)
    }
    await window.api.agent.resume(trimmedText || null)
    setText('')
  }

  const handleCancel = async () => {
    // v0.15.1 节点 2.4 — 取消干预 = 状态机回退到空闲（product.md 状态机契约）
    // 通常 backend ai-cancelled 事件会回写 streamingState，但本处兜底确保即使
    // 后端事件丢失，UI 也能立即恢复到 idle（发送按钮回到 ▶、输入框 disabled 解除）
    await window.api.agent.resume(null)
    setStreamingState('idle')
    setText('')
  }

  return (
    <div className="intervention-inline">
      <div className="intervention-inline__header">
        <span className="intervention-inline__icon">⏸</span>
        <span className="intervention-inline__title">Agent 已暂停，等待干预</span>
      </div>
      <textarea
        ref={textareaRef}
        className="intervention-inline__textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="输入补充指令（可留空直接继续）..."
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void handleInject()
          }
        }}
      />
      <div className="intervention-inline__actions">
        <button
          className="intervention-btn intervention-btn--cancel"
          onClick={() => void handleCancel()}
        >
          取消（恢复执行）
        </button>
        <button
          className="intervention-btn intervention-btn--inject"
          onClick={() => void handleInject()}
        >
          注入并继续 ⌘↵
        </button>
      </div>
    </div>
  )
}
