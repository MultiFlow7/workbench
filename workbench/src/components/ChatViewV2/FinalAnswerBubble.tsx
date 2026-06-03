/**
 * FinalAnswerBubble — v0.15.1 节点 1.2
 *
 * 集中 Markdown 渲染（左对齐、无外框、复用 ChatView 已引入的 react-markdown 链路）。
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github.css'
import './FinalAnswerBubble.css'

export interface FinalAnswerBubbleProps {
  content: string
  isStreaming?: boolean
}

export function FinalAnswerBubble({ content, isStreaming }: FinalAnswerBubbleProps) {
  return (
    <div className="bubble-row bubble-row--ai">
      <div className={`bubble--ai-plain markdown-body${isStreaming ? ' bubble--streaming-plain' : ''}`}>
        {content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {content}
          </ReactMarkdown>
        ) : (
          isStreaming ? <span className="final-answer__cursor" /> : null
        )}
      </div>
    </div>
  )
}
