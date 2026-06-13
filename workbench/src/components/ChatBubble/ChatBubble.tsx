/**
 * ChatBubble — v0.15 节点 4.4
 *
 * 对话气泡布局：
 *   <ChatRow user>  右对齐，accent 底色
 *   <ChatRow ai>    左对齐，无外框，ReactMarkdown 渲染
 *
 * 每条消息下方 mono 字体显示 nodeId · time。
 * AI 回答末尾紧凑 TokenBadge 统计条。
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github.css'
import './ChatBubble.css'

// ─── TokenBadge ───────────────────────────────────────────────────────────────

interface TokenBadgeProps {
  inputTokens: number
  outputTokens: number
}

export function TokenBadge({ inputTokens, outputTokens }: TokenBadgeProps) {
  return (
    <div className="token-badge">
      <span className="token-badge__item">
        <span className="token-badge__label">in</span>
        <span className="token-badge__value">{inputTokens.toLocaleString()}</span>
      </span>
      <span className="token-badge__sep" aria-hidden="true">·</span>
      <span className="token-badge__item">
        <span className="token-badge__label">out</span>
        <span className="token-badge__value">{outputTokens.toLocaleString()}</span>
      </span>
    </div>
  )
}

// ─── ChatRow ──────────────────────────────────────────────────────────────────

export interface ChatRowProps {
  user?: boolean
  ai?: boolean
  atomId?: string
  time?: string
  nodeId?: string
  inputTokens?: number
  outputTokens?: number
  children: React.ReactNode
}

export function ChatRow({
  user,
  ai,
  atomId: _atomId,
  time,
  nodeId,
  inputTokens,
  outputTokens,
  children,
}: ChatRowProps) {
  const isUser = user === true || ai !== true
  const rowClass = isUser ? 'chat-row chat-row--user' : 'chat-row chat-row--ai'

  const hasMeta = nodeId || time
  const hasTokens = ai && inputTokens !== undefined && outputTokens !== undefined

  return (
    <div className={rowClass}>
      <div className="chat-row__bubble">
        {isUser ? (
          <div className="chat-row__content chat-row__content--user">{children}</div>
        ) : (
          <div className="chat-row__content chat-row__content--ai markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
            >
              {typeof children === 'string' ? children : ''}
            </ReactMarkdown>
            {typeof children !== 'string' && children}
          </div>
        )}

        {hasMeta && (
          <div className="chat-row__meta">
            {nodeId && <span className="chat-row__node-id">{nodeId}</span>}
            {nodeId && time && <span className="chat-row__meta-sep" aria-hidden="true">·</span>}
            {time && <span className="chat-row__time">{time}</span>}
          </div>
        )}

        {hasTokens && (
          <TokenBadge inputTokens={inputTokens!} outputTokens={outputTokens!} />
        )}
      </div>
    </div>
  )
}
