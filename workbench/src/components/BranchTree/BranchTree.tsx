import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { useStore } from '../../store'
import type { QAAtomMeta } from '../../store/conversationSlice'
import { formatTokens } from '../../utils/tokenFormat'
import './BranchTree.css'

const NODE_W = 140
const NODE_H = 60   // layout spacing baseline (card height is fluid)
const GAP_X = 20
const GAP_Y = 100   // gap between levels

const SCALE_MIN = 0.3
const SCALE_MAX = 2.5

interface LayoutNode {
  atom: QAAtomMeta
  x: number  // center x
  y: number  // top y
  children: LayoutNode[]
}

function buildLayoutTree(
  atoms: Record<string, QAAtomMeta>
): LayoutNode[] {
  const roots = Object.values(atoms).filter((a) => a.prev === null)

  function makeNode(atom: QAAtomMeta, depth: number): LayoutNode {
    const children = Object.values(atoms)
      .filter((a) => {
        if (!a.prev) return false
        return a.prev.replace(/^\[\[|\]\]$/g, '') === atom.id
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

export function BranchTree() {
  const atoms = useStore((s) => s.atoms)
  const selectedAtomId = useStore((s) => s.selectedAtomId)
  const selectAtom = useStore((s) => s.selectAtom)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  // Node-F-051-C-1: subscribe to streaming atoms for spinner display
  const streamingAtoms = useStore((s) => s.streamingAtoms)

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

  // Pan + Zoom state
  const [transform, setTransform] = useState({ x: 40, y: 40, scale: 1 })
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const wheelHandler = (e: WheelEvent) => { e.preventDefault() }
    el.addEventListener('wheel', wheelHandler, { passive: false })

    // Tauri WKWebView fires gesturechange (not ctrlKey+wheel) for trackpad pinch
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
      setTransform((prev) => {
        const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, prev.scale * factor))
        return {
          x: mx - (mx - prev.x) * (newScale / prev.scale),
          y: my - (my - prev.y) * (newScale / prev.scale),
          scale: newScale,
        }
      })
    }

    el.addEventListener('gesturestart', gestureStartHandler)
    el.addEventListener('gesturechange', gestureChangeHandler)

    return () => {
      el.removeEventListener('wheel', wheelHandler)
      el.removeEventListener('gesturestart', gestureStartHandler)
      el.removeEventListener('gesturechange', gestureChangeHandler)
    }
  }, [])

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
    setTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
  }, [])

  const stopDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    dragging.current = false
    e.currentTarget.style.cursor = 'grab'
  }, [])

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey) {
      // macOS pinch → 缩放（系统将捏合映射为 ctrlKey=true 的 wheel 事件）
      // 必须在 setTransform 外提前读取 rect/mx/my：合成事件的 currentTarget 在 handler 返回后被清空，
      // updater 函数异步执行时已为 null
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setTransform((prev) => {
        const delta = e.deltaY < 0 ? 1.1 : 0.9
        const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, prev.scale * delta))
        return {
          x: mx - (mx - prev.x) * (newScale / prev.scale),
          y: my - (my - prev.y) * (newScale / prev.scale),
          scale: newScale,
        }
      })
    } else {
      // 双指滑动 → 平移
      setTransform((prev) => ({
        ...prev,
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }))
    }
  }, [])

  const zoom = useCallback((factor: number) => {
    setTransform((prev) => {
      const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, prev.scale * factor))
      return { ...prev, scale: newScale }
    })
  }, [])

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
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
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
                stroke="#d4d4d8"
                strokeWidth={1.5}
                fill="none"
              />
            )
          })}
        </svg>

        {/* Node cards */}
        {allNodes.map((node) => {
          const selected = node.atom.id === selectedAtomId
          // Node-F-051-C-2: check if this node is currently streaming
          const isStreaming = streamingAtoms.has(node.atom.id)
          const left = node.x - NODE_W / 2
          const top = node.y
          const shortId = node.atom.id.slice(-4)
          const summary = node.atom.summary || node.atom.id

          return (
            <div
              key={node.atom.id}
              className={`bt-node${selected ? ' bt-node--selected' : ''}`}
              style={{ left, top }}
              onClick={() => selectAtom(node.atom.id)}
            >
              {/* Node ID badge */}
              <span className="bt-node__id">{shortId}</span>

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

              {/* Node-F-051-C-3: streaming pulse dot (top-right) */}
              {isStreaming && (
                <span className="bt-node__streaming-dot" aria-label="AI 生成中" />
              )}

              {/* Token badge */}
              <div
                className="bt-node__token"
                onClick={(e) => node.atom.usage ? toggleTokenExpand(node.atom.id, e) : undefined}
                style={{ cursor: node.atom.usage ? 'pointer' : 'default' }}
              >
                {node.atom.usage ? (
                  <span className={`token-badge${treeAvgTokens > 0 && (node.atom.usage!.input_tokens + node.atom.usage!.output_tokens) > treeAvgTokens * 1.5 ? ' token-badge--warn' : ''}`}>
                    {formatTokens(node.atom.usage.input_tokens + node.atom.usage.output_tokens)}
                    {treeAvgTokens > 0 && (node.atom.usage!.input_tokens + node.atom.usage!.output_tokens) > treeAvgTokens * 1.5 && ' ⚠'}
                  </span>
                ) : (
                  <span className="token-badge token-badge--empty">-</span>
                )}
                {expandedTokenId === node.atom.id && node.atom.usage && (
                  <div className="bt-node__token-detail">
                    <div className="bt-token-row">
                      <span className="bt-token-label">输入</span>
                      <span className="bt-token-val">{formatTokens(node.atom.usage.input_tokens)}</span>
                    </div>
                    <div className="bt-token-row">
                      <span className="bt-token-label">输出</span>
                      <span className="bt-token-val">{formatTokens(node.atom.usage.output_tokens)}</span>
                    </div>
                    {node.atom.model && (
                      <div className="bt-token-row">
                        <span className="bt-token-label">模型</span>
                        <span className="bt-token-val bt-token-model">{node.atom.model}</span>
                      </div>
                    )}
                    {(() => {
                      const avg = allAtomsArr.reduce((s, a) => s + (a.usage ? a.usage.input_tokens + a.usage.output_tokens : 0), 0) / (allAtomsArr.filter(a => a.usage).length || 1)
                      const total = node.atom.usage.input_tokens + node.atom.usage.output_tokens
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
            </div>
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
