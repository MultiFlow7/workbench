import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from '../../store'
import React from 'react'
import type { DecisionRecord, DecisionOption } from '../../store/decisionsSlice'
import './DecisionPanel.css'

// CEO decision assistant prompt - minimal, isolated from main conversation context
const CEO_DECISION_ROLE_PROMPT = `你是工作台的 CEO 决策助理。
你的职责是帮助 CEO 分析和做出正确的 Agent 决策。
保持简洁、专业，聚焦于当前决策事项。
不要引用任何与当前决策无关的任务或上下文。`

interface ChatMessage {
  role: 'user' | 'ai'
  content: string
  isStreaming?: boolean
}

interface DecisionChatProps {
  decision: DecisionRecord
  onResolve: (decisionId: string, resolution: string) => void
}

function DecisionChat({ decision, onResolve }: DecisionChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [showCustom, setShowCustom] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const [pendingCustomResolution, setPendingCustomResolution] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const apiKeys = useStore((s) => s.apiKeys)
  const decisionModel = 'claude-sonnet-4-6'
  const decisionKey = apiKeys.find(k => k.models.includes(decisionModel))
    ?? apiKeys.find(k => k.models.length === 0)
    ?? apiKeys[0]
  const apiKey = decisionKey?.key ?? ''
  const apiBaseUrl = decisionKey?.baseUrl ?? ''

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  // Build isolated system prompt for this decision only
  const buildDecisionSystemPrompt = useCallback(() => {
    return (
      CEO_DECISION_ROLE_PROMPT +
      '\n\n当前待决策事项（JSON）：\n' +
      JSON.stringify(decision, null, 2)
    )
  }, [decision])

  // SSE listeners for decision chat
  useEffect(() => {
    const unlisteners: Array<() => void> = []

    window.api.listen<{ text: string }>('ai-token', (e) => {
      setStreamingText((prev) => prev + e.payload.text)
    }).then((u) => unlisteners.push(u))

    window.api.listen<{ atom_id: string; full_content: string }>('ai-done', (e) => {
      setIsStreaming(false)
      const content = e.payload.full_content
      setMessages((prev) => [...prev, { role: 'ai', content }])
      setStreamingText('')
    }).then((u) => unlisteners.push(u))

    window.api.listen<{ message?: string }>('ai-error', (e) => {
      setIsStreaming(false)
      setStreamingText('')
      const errMsg = e.payload?.message ?? 'AI 服务异常，请检查 API 配置'
      setMessages((prev) => [...prev, { role: 'ai', content: `⚠️ ${errMsg}` }])
    }).then((u) => unlisteners.push(u))

    window.api.listen('ai-cancelled', () => {
      setIsStreaming(false)
      setStreamingText('')
    }).then((u) => unlisteners.push(u))

    return () => unlisteners.forEach((u) => u())
  }, [])

  const sendMessage = useCallback(
    async (userText: string) => {
      if (!userText.trim() || isStreaming) return

      const newMsg: ChatMessage = { role: 'user', content: userText }
      const updatedMessages = [...messages, newMsg]
      setMessages(updatedMessages)
      setInput('')
      setIsStreaming(true)

      const apiMessages = updatedMessages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      }))

      const systemPrompt = buildDecisionSystemPrompt()

      // Use a dummy atomId for decision chat (not persisted to QA atoms)
      const dummyAtomId = `decision-chat-${decision.decision_id}-${Date.now()}`

      try {
        await window.api.invoke('stream_ai', {
          messages: apiMessages,
          model: 'claude-sonnet-4-6',
          atomId: dummyAtomId,
          system: systemPrompt,
          ...(apiKey ? { apiKey } : {}),
          ...(apiBaseUrl ? { baseUrl: apiBaseUrl } : {}),
        })
      } catch (e) {
        console.error('[DecisionChat] stream_ai error:', e)
        const errMsg = typeof e === 'string' ? e : (e as { message?: string })?.message ?? 'invoke 失败'
        setMessages((prev) => [...prev, { role: 'ai', content: `⚠️ 请求失败：${errMsg}` }])
        setIsStreaming(false)
      }
    },
    [messages, isStreaming, buildDecisionSystemPrompt, decision.decision_id]
  )

  const handleSend = () => {
    if (input.trim()) sendMessage(input.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Check if latest AI message contains confirmation prompt
  const lastAiMessage = [...messages].reverse().find((m) => m.role === 'ai')
  const showConfirmButton =
    pendingCustomResolution !== null &&
    lastAiMessage?.content.includes('是否确认？')

  const handleCustomSubmit = () => {
    if (!customInput.trim()) return
    const resolutionText = customInput.trim()
    setPendingCustomResolution(resolutionText)
    setCustomInput('')
    setShowCustom(false)
    sendMessage(`请确认我的决策：${resolutionText}`)
  }

  const handleConfirmCustom = () => {
    if (pendingCustomResolution) {
      onResolve(decision.decision_id, pendingCustomResolution)
      setPendingCustomResolution(null)
    }
  }

  return (
    <div className="decision-panel__chat">
      <div className="decision-chat__messages">
        {messages.length === 0 && !isStreaming && (
          <div className="decision-chat__empty">与 CEO 助理对话，辅助决策</div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`decision-chat__bubble-row decision-chat__bubble-row--${msg.role}`}
          >
            <div className={`decision-chat__bubble decision-chat__bubble--${msg.role}`}>
              {msg.content}
            </div>
          </div>
        ))}

        {isStreaming && (
          <div className="decision-chat__bubble-row decision-chat__bubble-row--ai">
            <div className="decision-chat__bubble decision-chat__bubble--ai decision-chat__bubble--streaming">
              {streamingText || '…'}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested action buttons when AI points to an option */}
      {showConfirmButton && (
        <div className="decision-chat__suggested-actions">
          <button
            className="decision-chat__suggested-btn"
            onClick={handleConfirmCustom}
          >
            确认
          </button>
        </div>
      )}

      {/* Custom resolution */}
      {!showCustom && (
        <button
          className="decision-chat__custom-toggle"
          onClick={() => setShowCustom(true)}
        >
          自定义决策…
        </button>
      )}

      {showCustom && (
        <div className="decision-chat__custom-resolution">
          <input
            className="decision-chat__custom-input"
            type="text"
            placeholder="输入自定义决策内容…"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCustomSubmit()
              if (e.key === 'Escape') setShowCustom(false)
            }}
            autoFocus
          />
          <button
            className="decision-chat__custom-submit"
            onClick={handleCustomSubmit}
            disabled={!customInput.trim()}
          >
            提交给 CEO 确认
          </button>
        </div>
      )}

      <div className="decision-chat__input-row">
        <textarea
          className="decision-chat__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="向 CEO 助理提问…"
          rows={1}
          disabled={isStreaming}
          onKeyDown={handleKeyDown}
        />
        <button
          className="decision-chat__send-btn"
          onClick={handleSend}
          disabled={!input.trim() || isStreaming}
        >
          发送
        </button>
      </div>
    </div>
  )
}

function formatTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return isoString
  }
}

function riskLabel(level: DecisionRecord['risk_level']): string {
  switch (level) {
    case 'High': return 'HIGH'
    case 'Medium': return 'MEDIUM'
    case 'Low': return 'LOW'
    default: return String(level).toUpperCase()
  }
}

export function DecisionPanel() {
  const { selectedDecisionId, decisions, setSelectedDecisionId, setPendingDecisionCount } =
    useStore()

  const decision = decisions.find((d) => d.decision_id === selectedDecisionId) ?? null

  const handleResolve = async (decisionId: string, resolution: string) => {
    try {
      await window.api.invoke('resolve_decision', { decisionId, resolution })
      // Remove from list
      const currentDecisions = useStore.getState().decisions
      const remaining = currentDecisions.filter((d) => d.decision_id !== decisionId)
      useStore.setState({ decisions: remaining })
      setPendingDecisionCount(remaining.length)
      setSelectedDecisionId(null)
    } catch (e) {
      console.error('[DecisionPanel] resolve failed:', e)
    }
  }

  if (!decision) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          fontSize: 13,
          color: '#a1a1aa',
        }}
      >
        选择决策查看详情
      </div>
    )
  }

  const riskKey = riskLabel(decision.risk_level)

  return (
    <div className="decision-panel">
      {/* Header */}
      <div className="decision-panel__header">
        <div className="decision-panel__meta-row">
          <span className="decision-panel__agent-tag">{decision.agent_role}</span>
          <span className={`decision-panel__risk-badge decision-panel__risk-badge--${riskKey}`}>
            {riskKey}
          </span>
          <span className="decision-panel__time">{formatTime(decision.created_at)}</span>
        </div>
        <div className="decision-panel__question">{decision.question}</div>
      </div>

      {/* Chat area */}
      <DecisionChat decision={decision} onResolve={handleResolve} />

      {/* Bottom action buttons */}
      <div className="decision-panel__actions">
        {decision.options.map((opt: DecisionOption, idx: number) => (
          <button
            key={opt.key}
            className={`decision-panel__btn ${
              idx === 0 ? 'decision-panel__btn--primary' : 'decision-panel__btn--secondary'
            }`}
            onClick={() => handleResolve(decision.decision_id, opt.key)}
            title={opt.description}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
