/**
 * ChatViewV2 — v0.15.1 节点 1.3 + Phase 2 重构
 *
 * Chat 模式 P3 渲染器（替代 ChatView）。
 *
 * 与 ChatView 的差异：
 *   - 渲染层：用 atomParser 解析每个 atom 为 ParsedAtom，按顺序映射为 <QABlock>
 *   - 末位 atom：streamingAtoms.has(atomId) 时把 liveRounds 注入 ProcessTrace、
 *     streamingTexts.get(atomId) 注入 FinalAnswerBubble
 *   - 移除 P3 header 中独立 ⏸ 按钮（迁移到 ChatInputV2，归属 req-061 节点 2.3）
 *   - selectedAtomId 变化时触发 resetTrace（节点 1.4 完成标志之一）
 *
 * Phase 2 重构（节点 2.1 + 2.2）：
 *   - 业务逻辑（handleSend / 事件监听 / 工具调用接续 / handlePause / handleStop /
 *     atomEntries 加载）抽出 useChatSend hook
 *   - 输入区拆出 ChatInputV2 组件实现三态机
 *   - 本组件只保留：渲染层 + 滚动控制 + selectedAtomId → resetTrace 副作用
 */

import { useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { InterventionInline } from '../InterventionInline/InterventionInline'
import { useChatSend } from '../../hooks/useChatSend'
import type { QAAtomMeta } from '../../store/conversationSlice'
import { QABlock } from './QABlock'
import type { QABlockTokenUsage } from './QABlock'
import { ChatInputV2 } from './ChatInputV2'
import '../ChatView/ChatView.css'

function buildTokenUsage(meta: QAAtomMeta): QABlockTokenUsage | undefined {
  if (!meta.usage) return undefined
  return {
    input: meta.usage.input_tokens,
    output: meta.usage.output_tokens,
    // cached / cost: v0.15 未采集，TokenLine 内部渲染为 `--`
    cached: undefined,
    cost: undefined,
  }
}

export function ChatViewV2() {
  const selectedAtomId = useStore((s) => s.selectedAtomId)
  const streamingState = useStore((s) => s.streamingState)
  const setStreamingState = useStore((s) => s.setStreamingState)
  const streamingAtoms = useStore((s) => s.streamingAtoms)
  const streamingTexts = useStore((s) => s.streamingTexts)
  const liveRounds = useStore((s) => s.liveRounds)
  const resetTrace = useStore((s) => s.resetTrace)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const shouldScrollRef = useRef(false)

  const isNearBottom = () => {
    const c = messagesContainerRef.current
    if (!c) return true
    return c.scrollHeight - c.scrollTop - c.clientHeight < 80
  }
  const scrollToBottom = () => {
    const c = messagesContainerRef.current
    if (c) c.scrollTop = c.scrollHeight
  }
  const requestScrollToBottom = () => {
    shouldScrollRef.current = true
  }

  const {
    atomEntries,
    toolCallStatuses,
    model,
    setModel,
    MODELS,
    handleSend,
    handlePause,
  } = useChatSend({ isNearBottom, scrollToBottom, requestScrollToBottom })

  // 节点 1.4 — selectedAtomId 变化时重置 trace 三维默认状态
  useEffect(() => {
    resetTrace()
  }, [selectedAtomId, resetTrace])

  // atomEntries 变化时按需滚动
  useEffect(() => {
    if (shouldScrollRef.current) {
      scrollToBottom()
      shouldScrollRef.current = false
    }
  }, [atomEntries])

  // 末位 atom 的流式信息
  const lastEntryIdx = atomEntries.length - 1
  const lastAtomId = lastEntryIdx >= 0 ? atomEntries[lastEntryIdx].meta.id : null
  const isLastStreaming = lastAtomId ? streamingAtoms.has(lastAtomId) : false
  const lastStreamingText = lastAtomId ? (streamingTexts.get(lastAtomId) ?? '') : ''

  return (
    <div className="chat-view">
      {/*
       * v0.15.1 P2 验收修订（2026-06-02）：移除 chat-header 整块
       *   - 运行 / 暂停 状态指示由 TopBar AgentRunPill 承担（节点 3.4）
       *   - 暂停态按钮指示由 ChatInputV2 三态机承担（节点 2.1）
       *   - 节点 ID / summary 信息密度通过 QABlock 内嵌 node-id 行已覆盖
       * 验证：DOM 内 .chat-header 在 ChatViewV2 子树为 null；ChatViewV2 顶部直接是 .chat-messages
       */}

      <div className="chat-messages" ref={messagesContainerRef}>
        {atomEntries.length === 0 && streamingAtoms.size === 0 && (
          <div className="chat-empty">选择节点或发送消息开始对话</div>
        )}

        {atomEntries.map((entry, idx) => {
          const isLast = idx === lastEntryIdx
          const atomId = entry.meta.id
          const isStreaming = streamingAtoms.has(atomId)

          const finalAnswerHistory = entry.parsed.response
          const finalAnswerLive = isStreaming ? (streamingTexts.get(atomId) ?? '') : ''
          const finalAnswer = isStreaming && finalAnswerLive
            ? finalAnswerLive
            : finalAnswerHistory

          let rounds = entry.parsed.steps
          if (isLast && isStreaming && (!rounds || rounds.length === 0) && liveRounds.length > 0) {
            rounds = liveRounds
          }

          return (
            <div key={atomId}>
              {/* v0.15.1 P2 验收修订：第二个及以后的 QABlock 之前插入 branch-marker
                  与 v0.14 ChatView 的 `— 分支节点 {atomId} —` 文案保持一致 */}
              {idx > 0 && (
                <div className="chat-branch-marker">— 分支节点 {atomId} —</div>
              )}
              <QABlock
                atomId={atomId}
                question={entry.parsed.q}
                finalAnswer={finalAnswer}
                rounds={rounds}
                interventions={entry.parsed.interventions}
                tokenUsage={buildTokenUsage(entry.meta)}
                isStreaming={isStreaming}
                isLast={isLast}
                timestamp={entry.meta.timestamp}
              />
            </div>
          )
        })}

        {lastAtomId === null && streamingAtoms.size > 0 && Array.from(streamingAtoms).map((sid) => (
          <QABlock
            key={sid}
            atomId={sid}
            question=""
            finalAnswer={streamingTexts.get(sid) ?? ''}
            rounds={liveRounds.length > 0 ? liveRounds : null}
            interventions={[]}
            isStreaming
            isLast
          />
        ))}

        <InterventionInline />

        {streamingState === 'error' && (
          <div className="chat-error">
            请求失败：请检查网络或 API Key
            <button onClick={() => setStreamingState('idle')}>关闭</button>
          </div>
        )}

        <div ref={messagesEndRef} />
        <span hidden data-debug={isLastStreaming ? lastStreamingText.length : 0} />
      </div>

      <ChatInputV2
        handleSend={handleSend}
        handlePause={handlePause}
        model={model}
        setModel={setModel}
        MODELS={MODELS}
        toolCallStatuses={toolCallStatuses}
      />
    </div>
  )
}
