/**
 * CanvasCard · v0.15 节点 4.3 P2
 *
 * 画布节点卡片（原型 v0.15 风格）。
 *
 * 结构：cc-head / cc-qa / cc-meta
 * 左侧 3px 状态色条通过 ::before 伪元素实现（CSS data-status 选择器）。
 */

import { ReactNode } from 'react'

export interface NodeData {
  id: string
  parent: string | null
  time: string
  status: 'done' | 'running' | 'paused'
  q: string
  aPreview: string
  pos: { x: number; y: number }
  tokens?: number
  cost?: number
  rounds?: number
}

export interface CanvasCardProps {
  node: NodeData
  isSelected: boolean
  onSelect: (id: string) => void
  /** 内部插槽（保留，不渲染，避免调用方编译报错） */
  children?: ReactNode
  /** 容器宽度（由父组件控制） */
  width: number
  /** 是否处于 streaming 状态 */
  isStreaming?: boolean
}

export function CanvasCard({
  node,
  isSelected,
  onSelect,
  width,
  isStreaming = false,
}: CanvasCardProps) {
  // 取 id 前两段作为显示 id，例如 "0013-002"
  const displayId = node.id.split('-').slice(0, 2).join('-')

  // 从 ISO 时间字符串提取 HH:MM
  const timeStr = node.time
    ? node.time.replace(/.*T(\d{2}):(\d{2}).*/, '$1:$2')
    : ''

  // 将 'running' 映射为 CSS 类 'run'，其余保持原值
  const statusClass = node.status === 'running' ? 'run' : node.status

  const badgeText =
    node.status === 'running' ? '运行中'
    : node.status === 'done' ? '完成'
    : '暂停'

  return (
    <div
      className={`bt-node${isSelected ? ' bt-node--selected' : ''} ${statusClass}`}
      style={{ left: node.pos.x - width / 2, top: node.pos.y, width }}
      onClick={() => onSelect(node.id)}
      data-status={node.status}
      data-node-id={node.id}
    >
      <div className="cc-head">
        <span className="cc-id">{displayId}</span>
        {timeStr && <span className="cc-time">{timeStr}</span>}
        <span className={`cc-badge ${statusClass}`}>
          {isStreaming && <span className="spinner-tiny" />}
          {badgeText}
        </span>
      </div>

      <div className="cc-qa">
        <div className="cc-row q">
          <span className="cc-tag">Q</span>
          <span className="cc-text">{node.q || '…'}</span>
        </div>
        <div className="cc-row a">
          <span className="cc-tag">A</span>
          <span className={`cc-text${isStreaming ? ' running' : ''}`}>
            {isStreaming ? '生成中…' : (node.aPreview || '…')}
          </span>
        </div>
      </div>

      <div className="cc-meta">
        {node.rounds != null && <span>{node.rounds}轮</span>}
        {node.rounds != null && node.tokens != null && (
          <span className="cc-meta-dot">·</span>
        )}
        {node.tokens != null && (
          <span>
            {node.tokens >= 1000
              ? `${(node.tokens / 1000).toFixed(1)}k`
              : node.tokens}{' '}
            tokens
          </span>
        )}
      </div>
    </div>
  )
}
