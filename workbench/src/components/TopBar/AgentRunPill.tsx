/**
 * AgentRunPill · v0.15.1 节点 3.4
 *
 * TopBar 中央标题旁的运行状态 pill：`Agent 运行中 · N 活跃`。
 * 数据派生自 v0.15 conversationSlice.streamingAtoms（Set<atomId>），活跃 Agent 数量 = size。
 * 0 个活跃时不渲染（无占位）；1+ 个时显示文案 + 蓝色脉冲点。
 *
 * Token 复用（不新增）：var(--run-bg) / var(--run-bd) / var(--accent)
 *   - 浅色 tokens.css 第 47/48 行；暗色第 130/131 行（v0.15 已建）。
 *
 * 验证锚点：T-V151-C5（0 计数不渲染）/ T-V151-C6（N 计数实时）/ T-V151-C7（token 复用断言）
 */

import { useStore } from '../../store'

export function AgentRunPill() {
  const activeCount = useStore((s) => s.streamingAtoms.size)

  if (activeCount === 0) return null

  return (
    <span className="agent-run-pill" data-v151-node="3.4">
      <span className="agent-run-pill__dot" />
      Agent 运行中 · {activeCount} 活跃
    </span>
  )
}
