/**
 * CanvasCard · v0.15 节点 4.3 P2
 *
 * 画布节点卡片（规范化签名版本）。
 *
 * 设计要点：
 * - 签名严格按节点 4.3 P2 任务说明定义，不引入额外 props。
 * - 视觉细节（token badge / streaming dot / Q/A 文本）由 BranchTree 在 NodeData
 *   之外通过 children 注入（未来如需扩展再加 props，避免一开始就过度抽象）。
 * - 选中态颜色统一走 `var(--accent)` 而非硬编码 var(--accent)，配合 tokens.css 双主题。
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
  /** 卡片内部插槽：BranchTree 用于注入 Q/A 行、token badge 等富内容 */
  children?: ReactNode
  /** 容器尺寸（由父组件控制，避免 CanvasCard 写死宽度） */
  width: number
  /** 是否处于 streaming 状态（顶部蓝色脉冲点） */
  isStreaming?: boolean
}

export function CanvasCard({
  node,
  isSelected,
  onSelect,
  children,
  width,
  isStreaming = false,
}: CanvasCardProps) {
  const shortId = node.id.slice(-4)

  return (
    <div
      className={`bt-node${isSelected ? ' bt-node--selected' : ''}`}
      style={{
        left: node.pos.x - width / 2,
        top: node.pos.y,
        width,
      }}
      onClick={() => onSelect(node.id)}
      data-status={node.status}
      data-node-id={node.id}
    >
      <span className="bt-node__id">{shortId}</span>
      {children}
      {isStreaming && (
        <span className="bt-node__streaming-dot" aria-label="AI 生成中" />
      )}
    </div>
  )
}
