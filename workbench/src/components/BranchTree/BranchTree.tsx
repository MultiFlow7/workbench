import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { useStore } from '../../store'
import type { QAAtomMeta } from '../../store/conversationSlice'
import { formatTokens } from '../../utils/tokenFormat'
import { CanvasCard, type NodeData } from './CanvasCard'
import './BranchTree.css'

const NODE_W = 260
const NODE_H = 110  // layout spacing baseline (cc-head+cc-qa+cc-meta ≈ 100px)
const GAP_X = 40
const GAP_Y = 100   // gap between levels

const SCALE_MIN = 0.3
const SCALE_MAX = 2.5

interface LayoutNode {
  atom: QAAtomMeta
  x: number  // center x
  y: number  // top y
  children: LayoutNode[]
}

// v0.15.1 P3 验收修订（2026-06-03，r10）：原 roots = atoms.filter(prev===null) 漏掉
// 「孤儿原子」（prev 引用了不在当前 atoms 集合里的父节点 —— 可能因为父文件被删、
// frontmatter 损坏、project 过滤排除等原因）。孤儿原子既不是根，又不在任何根的子树里 →
// BranchTree 完全不渲染它们。修复：孤儿原子也作为根渲染（独立浮岛），保证「能看到所有原子」。
export function buildLayoutTree(
  atoms: Record<string, QAAtomMeta>
): LayoutNode[] {
  const atomIds = new Set(Object.keys(atoms))
  const getParentId = (a: QAAtomMeta): string | null => {
    if (!a.prev) return null
    // 先 trim 再 strip [[]]，避免「[[id]]  」尾随空白导致 `]]$` 不匹配
    const stripped = a.prev.trim().replace(/^\[\[|\]\]$/g, '')
    return stripped.length > 0 ? stripped : null
  }
  const roots = Object.values(atoms).filter((a) => {
    const parentId = getParentId(a)
    if (parentId === null) return true            // 真正的根
    if (!atomIds.has(parentId)) return true       // 孤儿：父节点缺失 → 作为根渲染
    return false
  })

  function makeNode(atom: QAAtomMeta, depth: number): LayoutNode {
    const children = Object.values(atoms)
      .filter((a) => {
        const parentId = getParentId(a)
        return parentId !== null && parentId === atom.id
      })
      .map((a) => makeNode(a, depth + 1))
    return { atom, x: 0, y: depth * (NODE_H + GAP_Y), children }
  }

  return roots.map((r) => makeNode(r, 0))
}

function assignX(nodes: LayoutNode[], startX = 0): number {
  let cur = startX
  for (const node of nodes) {
    if (node.children.length === 0) {
      node.x = cur + NODE_W / 2
      cur += NODE_W + GAP_X
    } else {
      const end = assignX(node.children, cur)
      const first = node.children[0]
      const last = node.children[node.children.length - 1]
      node.x = (first.x + last.x) / 2
      cur = end
    }
  }
  return cur
}

function collectNodes(roots: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = []
  function dfs(n: LayoutNode) {
    result.push(n)
    n.children.forEach(dfs)
  }
  roots.forEach(dfs)
  return result
}

function collectEdges(roots: LayoutNode[]): Array<{ from: LayoutNode; to: LayoutNode }> {
  const edges: Array<{ from: LayoutNode; to: LayoutNode }> = []
  function dfs(n: LayoutNode) {
    n.children.forEach((c) => {
      edges.push({ from: n, to: c })
      dfs(c)
    })
  }
  roots.forEach(dfs)
  return edges
}

/**
 * 把 QAAtomMeta + LayoutNode 转换成规范化 NodeData。
 * 状态推断：streamingAtoms 包含 → 'running'，否则默认 'done'。
 * 节点 4.3 P2 阶段还没有 paused 语义，先保留三选一接口。
 */
function toNodeData(
  layout: LayoutNode,
  isStreaming: boolean
): NodeData {
  const { atom, x, y } = layout
  const totalTokens = atom.usage
    ? atom.usage.input_tokens + atom.usage.output_tokens
    : undefined
  // 父节点 id：去掉 [[ ]] wiki link 包裹
  const parent = atom.prev
    ? atom.prev.replace(/^\[\[|\]\]$/g, '')
    : null
  return {
    id: atom.id,
    parent,
    time: atom.timestamp,
    status: isStreaming ? 'running' : 'done',
    q: atom.summary || atom.id,
    aPreview: atom.aPreview || '…',
    pos: { x, y },
    tokens: totalTokens,
  }
}

export function BranchTree() {
  const atoms = useStore((s) => s.atoms)
  // 仍读 selectedAtomId 用于 ChatView 联动；同时把选中事件写入 canvasSlice
  const selectedAtomId = useStore((s) => s.selectedAtomId)
  const selectedNodeId = useStore((s) => s.selectedNodeId)
  const selectAtom = useStore((s) => s.selectAtom)
  const setSelectedNode = useStore((s) => s.setSelectedNode)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  // Node-F-051-C-1: subscribe to streaming atoms for spinner display
  const streamingAtoms = useStore((s) => s.streamingAtoms)
  // canvas 视图变换持久化到 store（模式切换后位置保留）
  const canvasTransform = useStore((s) => s.canvasTransform)
  const updateCanvasTransform = useStore((s) => s.updateCanvasTransform)

  // Project filtering
  const filteredAtoms = useMemo<Record<string, QAAtomMeta>>(() => {
    if (!selectedProjectId) return atoms
    const proj = projects.find((p) => p.id === selectedProjectId)
    if (!proj) return atoms
    const allowed = new Set(proj.atomIds)
    const filtered: Record<string, QAAtomMeta> = {}
    for (const [id, atom] of Object.entries(atoms)) {
      if (allowed.has(id)) filtered[id] = atom
    }
    return filtered
  }, [atoms, selectedProjectId, projects])

  const allAtomsArr = useMemo(
    () => Object.values(filteredAtoms),
    [filteredAtoms],
  )

  // Average total tokens across atoms that have usage — for high-consumption badge
  const treeAvgTokens = useMemo(() => {
    const withUsage = allAtomsArr.filter((a) => a.usage)
    if (withUsage.length === 0) return 0
    return withUsage.reduce((s, a) => s + (a.usage!.input_tokens + a.usage!.output_tokens), 0) / withUsage.length
  }, [allAtomsArr])

  // Layout
  const { allNodes, edges, canvasW, canvasH } = useMemo(() => {
    const roots = buildLayoutTree(filteredAtoms)
    assignX(roots)
    const allNodes = collectNodes(roots)
    const edges = collectEdges(roots)
    const maxX = allNodes.reduce((m, n) => Math.max(m, n.x + NODE_W / 2), 0)
    const maxY = allNodes.reduce((m, n) => Math.max(m, n.y + NODE_H), 0)
    return {
      allNodes,
      edges,
      canvasW: maxX + GAP_X + 40,
      canvasH: maxY + GAP_Y + 40,
    }
  }, [filteredAtoms])

  // Token expand state
  const [expandedTokenId, setExpandedTokenId] = useState<string | null>(null)

  const toggleTokenExpand = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedTokenId((prev) => (prev === id ? null : id))
  }, [])

  // 选中节点：同时更新 canvasSlice（视觉层）和 conversationSlice（语义层）
  const handleSelect = useCallback(
    (id: string) => {
      setSelectedNode(id)
      selectAtom(id)
    },
    [setSelectedNode, selectAtom],
  )

  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const wheelHandler = (e: WheelEvent) => { e.preventDefault() }
    el.addEventListener('wheel', wheelHandler, { passive: false })

    // macOS 触控板捏合会触发 gesturechange；阻止它避免整页缩放干扰画布。
    let gestureLastScale = 1
    const gestureStartHandler = (e: Event) => {
      e.preventDefault()
      gestureLastScale = (e as any).scale ?? 1
    }
    const gestureChangeHandler = (e: Event) => {
      e.preventDefault()
      const ge = e as any
      const currentScale = ge.scale ?? 1
      const factor = currentScale / gestureLastScale
      gestureLastScale = currentScale
      const rect = el.getBoundingClientRect()
      const mx = (ge.clientX ?? rect.left + rect.width / 2) - rect.left
      const my = (ge.clientY ?? rect.top + rect.height / 2) - rect.top
      const prev = useStore.getState().canvasTransform
      const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, prev.scale * factor))
      updateCanvasTransform({
        x: mx - (mx - prev.x) * (newScale / prev.scale),
        y: my - (my - prev.y) * (newScale / prev.scale),
        scale: newScale,
      })
    }

    el.addEventListener('gesturestart', gestureStartHandler)
    el.addEventListener('gesturechange', gestureChangeHandler)

    return () => {
      el.removeEventListener('wheel', wheelHandler)
      el.removeEventListener('gesturestart', gestureStartHandler)
      el.removeEventListener('gesturechange', gestureChangeHandler)
    }
  }, [updateCanvasTransform])

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only start drag on the container itself (not nodes)
    const target = e.target as HTMLElement
    if (target.closest('.bt-node')) return
    dragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.style.cursor = 'grabbing'
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    const prev = useStore.getState().canvasTransform
    updateCanvasTransform({ x: prev.x + dx, y: prev.y + dy })
  }, [updateCanvasTransform])

  const stopDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    dragging.current = false
    e.currentTarget.style.cursor = 'grab'
  }, [])

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey) {
      // macOS pinch → 缩放（系统将捏合映射为 ctrlKey=true 的 wheel 事件）
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const prev = useStore.getState().canvasTransform
      const delta = e.deltaY < 0 ? 1.1 : 0.9
      const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, prev.scale * delta))
      updateCanvasTransform({
        x: mx - (mx - prev.x) * (newScale / prev.scale),
        y: my - (my - prev.y) * (newScale / prev.scale),
        scale: newScale,
      })
    } else {
      // 双指滑动 → 平移
      const prev = useStore.getState().canvasTransform
      updateCanvasTransform({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      })
    }
  }, [updateCanvasTransform])

  const zoom = useCallback((factor: number) => {
    const prev = useStore.getState().canvasTransform
    const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, prev.scale * factor))
    updateCanvasTransform({ scale: newScale })
  }, [updateCanvasTransform])

  if (allNodes.length === 0) {
    return (
      <div className="bt-container">
        <div className="bt-empty">暂无对话节点</div>
      </div>
    )
  }

  return (
    <div
      className="bt-container"
      ref={containerRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
      onWheel={onWheel}
    >
      {/* Inner canvas */}
      <div
        className="bt-canvas"
        style={{
          transform: `translate(${canvasTransform.x}px, ${canvasTransform.y}px) scale(${canvasTransform.scale})`,
          width: canvasW,
          height: canvasH,
        }}
      >
        {/* SVG edge layer */}
        <svg
          className="bt-edges"
          width={canvasW}
          height={canvasH}
        >
          {edges.map(({ from, to }, i) => {
            const x1 = from.x
            const y1 = from.y + NODE_H
            const x2 = to.x
            const y2 = to.y
            const my = (y1 + y2) / 2
            return (
              <path
                key={i}
                d={`M ${x1},${y1} C ${x1},${my} ${x2},${my} ${x2},${y2}`}
                className="bt-edge-path"
                fill="none"
              />
            )
          })}
        </svg>

        {/* Node cards */}
        {allNodes.map((layout) => {
          // canvas 视觉选中 优先级 > conversation 语义选中（兜底）
          const selected =
            selectedNodeId !== null
              ? layout.atom.id === selectedNodeId
              : layout.atom.id === selectedAtomId
          // Node-F-051-C-2: check if this node is currently streaming
          const isStreaming = streamingAtoms.has(layout.atom.id)
          const nodeData = toNodeData(layout, isStreaming)
          const summary = nodeData.q

          return (
            <CanvasCard
              key={layout.atom.id}
              node={nodeData}
              isSelected={selected}
              onSelect={handleSelect}
              width={NODE_W}
              isStreaming={isStreaming}
            >
              {/* Q section */}
              <div className="bt-node__q">
                <span className="bt-node__role">U</span>
                <div className="bt-node__text">{summary}</div>
              </div>

              {/* Divider */}
              <div className="bt-node__divider" />

              {/* A section */}
              <div className="bt-node__a">
                <span className="bt-node__role">AI</span>
                <div className="bt-node__text">{summary}</div>
              </div>

              {/* Token badge */}
              <div
                className="bt-node__token"
                onClick={(e) => layout.atom.usage ? toggleTokenExpand(layout.atom.id, e) : undefined}
                style={{ cursor: layout.atom.usage ? 'pointer' : 'default' }}
              >
                {layout.atom.usage ? (
                  <span className={`token-badge${treeAvgTokens > 0 && (layout.atom.usage!.input_tokens + layout.atom.usage!.output_tokens) > treeAvgTokens * 1.5 ? ' token-badge--warn' : ''}`}>
                    {formatTokens(layout.atom.usage.input_tokens + layout.atom.usage.output_tokens)}
                    {treeAvgTokens > 0 && (layout.atom.usage!.input_tokens + layout.atom.usage!.output_tokens) > treeAvgTokens * 1.5 && ' ⚠'}
                  </span>
                ) : (
                  <span className="token-badge token-badge--empty">-</span>
                )}
                {expandedTokenId === layout.atom.id && layout.atom.usage && (
                  <div className="bt-node__token-detail">
                    <div className="bt-token-row">
                      <span className="bt-token-label">输入</span>
                      <span className="bt-token-val">{formatTokens(layout.atom.usage.input_tokens)}</span>
                    </div>
                    <div className="bt-token-row">
                      <span className="bt-token-label">输出</span>
                      <span className="bt-token-val">{formatTokens(layout.atom.usage.output_tokens)}</span>
                    </div>
                    {layout.atom.model && (
                      <div className="bt-token-row">
                        <span className="bt-token-label">模型</span>
                        <span className="bt-token-val bt-token-model">{layout.atom.model}</span>
                      </div>
                    )}
                    {(() => {
                      const avg = allAtomsArr.reduce((s, a) => s + (a.usage ? a.usage.input_tokens + a.usage.output_tokens : 0), 0) / (allAtomsArr.filter(a => a.usage).length || 1)
                      const total = layout.atom.usage.input_tokens + layout.atom.usage.output_tokens
                      const ratio = avg > 0 ? (total / avg).toFixed(1) : null
                      return ratio ? (
                        <div className="bt-token-row">
                          <span className="bt-token-label">相对平均</span>
                          <span className={`bt-token-val${parseFloat(ratio) > 1.5 ? ' bt-token-val--warn' : ''}`}>
                            {ratio}×
                          </span>
                        </div>
                      ) : null
                    })()}
                  </div>
                )}
              </div>
            </CanvasCard>
          )
        })}
      </div>

      {/* Zoom controls */}
      <div className="bt-zoom-controls">
        <button className="bt-zoom-btn" onClick={() => zoom(1.2)} title="放大">+</button>
        <button className="bt-zoom-btn" onClick={() => zoom(1 / 1.2)} title="缩小">−</button>
      </div>
    </div>
  )
}
