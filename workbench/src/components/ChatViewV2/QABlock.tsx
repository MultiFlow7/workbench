/**
 * QABlock — v0.15.1 节点 1.1
 *
 * 封装单个 QA atom 的完整渲染（用户问题 / AI 执行过程 / 最终回答 / Token 行）。
 *
 * DOM 顺序（与 product.md「渲染结构方案 B」一致）：
 *   1. QBubble        用户问题气泡（右对齐）+ node-id · time mono 字体小字
 *   2. ProcessTrace   AI 执行过程（rounds 非空时挂载，否则不渲染）
 *   3. FinalAnswerBubble  最终回答 markdown 气泡（左对齐无外框）
 *   4. TokenLine      Token 统计行（紧凑内联）
 */

import { ProcessTrace } from '../ProcessTrace/ProcessTrace'
import type { Round, Intervention } from '../../lib/atomParser'
import { FinalAnswerBubble } from './FinalAnswerBubble'
import { TokenLine } from './TokenLine'
import './QABlock.css'

export interface QABlockTokenUsage {
  input?: number
  output?: number
  cached?: number
  cost?: number
}

export interface QABlockProps {
  atomId: string
  question: string
  finalAnswer: string
  rounds: Round[] | null
  interventions: Intervention[]
  tokenUsage?: QABlockTokenUsage
  isStreaming: boolean
  isLast: boolean
  timestamp?: string
}

function formatTime(ts?: string): string {
  if (!ts) return ''
  // ts may be ISO 8601 or already pretty; try to extract HH:mm:ss
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export function QABlock({
  atomId,
  question,
  finalAnswer,
  rounds,
  interventions,
  tokenUsage,
  isStreaming,
  timestamp,
}: QABlockProps) {
  const hasProcess = rounds !== null && rounds.length > 0
  const showFinalAnswer = finalAnswer.length > 0 || !isStreaming || hasProcess
  const timeStr = formatTime(timestamp)

  return (
    <div className="qa-block" data-atom-id={atomId}>
      {/* 1. Q Bubble */}
      {question && (
        <div className="qa-block__q-row">
          <div className="bubble bubble--user qa-block__q-bubble">{question}</div>
        </div>
      )}
      <div className="qa-block__q-meta">
        <span className="qa-block__node-id">{atomId}</span>
        {timeStr && (
          <>
            <span className="qa-block__meta-sep">·</span>
            <span className="qa-block__time">{timeStr}</span>
          </>
        )}
      </div>

      {/* 2. ProcessTrace (rounds 非空时挂载；rounds === null 时组件内 return null) */}
      <ProcessTrace
        rounds={rounds}
        interventions={interventions}
        atomId={atomId}
      />

      {/* 3. Final Answer */}
      {showFinalAnswer && (
        <FinalAnswerBubble content={finalAnswer} isStreaming={isStreaming} />
      )}

      {/* 4. Token Line */}
      {tokenUsage && (
        <TokenLine usage={tokenUsage} />
      )}
    </div>
  )
}
