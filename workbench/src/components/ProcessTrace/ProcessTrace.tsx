/**
 * ProcessTrace — v0.15 节点 4.5 / 4.6
 *
 * 展示 AI 执行过程的三层折叠结构：
 *   1. 整体折叠层（processCollapsed）
 *   2. 内部：思维链 group（thinkingGroupCollapsed）+ 工具 group（toolGroupCollapsed）
 *   3. 每项 thinking / tool 可被 thinkOverrides / toolOverrides 单独覆盖
 *
 * rounds 为 null 时（旧 atom 无 ## Steps）：return null
 * rounds 存在时：使用持久化数据
 * rounds 未传入时：从 store.liveRounds 读取流式数据
 */

import { useStore } from '../../store'
import type { Round, Tool, Intervention } from '../../lib/atomParser'
import './ProcessTrace.css'

// ─── ToolCard ─────────────────────────────────────────────────────────────────

interface ToolCardProps {
  tool: Tool & { _toolUseId?: string }
  toolId: string
}

function ToolCard({ tool, toolId }: ToolCardProps) {
  const toolOverrides = useStore((s) => s.toolOverrides)
  const toggleToolOverride = useStore((s) => s.toggleToolOverride)
  const collapsed = toolOverrides[toolId] ?? false

  return (
    <div className={`tool-card tool-card--${tool.status}`}>
      <button
        className="tool-card__header"
        onClick={() => toggleToolOverride(toolId)}
        aria-expanded={!collapsed}
      >
        <span className={`tool-card__status-dot tool-card__status-dot--${tool.status}`} />
        <span className="tool-card__name">{tool.name}</span>
        <span className="tool-card__chevron">{collapsed ? '▶' : '▼'}</span>
      </button>

      {!collapsed && (
        <div className="tool-card__body">
          {tool.input && (
            <div className="tool-card__section">
              <span className="tool-card__section-label">input</span>
              <pre className="tool-card__pre">{tool.input}</pre>
            </div>
          )}
          {tool.result && (
            <div className="tool-card__section">
              <span className="tool-card__section-label">result</span>
              <pre className="tool-card__pre">{tool.result}</pre>
            </div>
          )}
          {!tool.input && !tool.result && (
            <span className="tool-card__empty">running…</span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── RoundBlock ───────────────────────────────────────────────────────────────

interface RoundBlockProps {
  round: Round
  index: number
  isLast: boolean
  isStreaming: boolean
}

function RoundBlock({ round, index, isLast, isStreaming }: RoundBlockProps) {
  const thinkingGroupCollapsed = useStore((s) => s.thinkingGroupCollapsed)
  const toolGroupCollapsed = useStore((s) => s.toolGroupCollapsed)
  const thinkOverrides = useStore((s) => s.thinkOverrides)
  const toggleThinkOverride = useStore((s) => s.toggleThinkOverride)

  const thinkKey = String(index)
  // Single thinking item override: if set, use override; otherwise fall back to group state
  const thinkingCollapsed =
    thinkKey in thinkOverrides ? thinkOverrides[thinkKey] : thinkingGroupCollapsed

  const hasThinkling = round.thinking !== undefined && round.thinking !== ''
  const hasTools = round.tools.length > 0

  return (
    <div className="round-block">
      <div className="round-block__label">
        Round {index + 1}
        {isLast && isStreaming && (
          <span className="round-block__spinner" aria-label="running" />
        )}
      </div>

      {hasThinkling && (
        <div className="round-block__thinking">
          <button
            className="round-block__thinking-toggle"
            onClick={() => toggleThinkOverride(thinkKey)}
            aria-expanded={!thinkingCollapsed}
          >
            <span className="round-block__thinking-icon">🧠</span>
            <span>Thinking</span>
            <span className="round-block__chevron">{thinkingCollapsed ? '▶' : '▼'}</span>
          </button>
          {!thinkingCollapsed && (
            <pre className="round-block__thinking-content">{round.thinking}</pre>
          )}
        </div>
      )}

      {hasTools && !toolGroupCollapsed && (
        <div className="round-block__tools">
          {round.tools.map((tool, ti) => {
            const t = tool as Tool & { _toolUseId?: string }
            const toolId = t._toolUseId ?? `${index}-${ti}`
            return (
              <ToolCard key={toolId} tool={t} toolId={toolId} />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── InterventionRecord ───────────────────────────────────────────────────────

interface InterventionRecordProps {
  intervention: Intervention
}

function InterventionRecord({ intervention }: InterventionRecordProps) {
  return (
    <div className="intervention-record">
      <div className="intervention-record__header">
        <span className="intervention-record__icon">↩</span>
        <span className="intervention-record__label">用户干预</span>
        {intervention.timestamp && (
          <span className="intervention-record__time">{intervention.timestamp}</span>
        )}
      </div>
      <div className="intervention-record__text">{intervention.text}</div>
    </div>
  )
}

// ─── AIProcessProps ───────────────────────────────────────────────────────────

interface AIProcessProps {
  rounds: Round[] | null
  interventions: Intervention[]
  atomId?: string
}

// ─── ProcessTrace (main) ──────────────────────────────────────────────────────

export function ProcessTrace({ rounds, interventions, atomId }: AIProcessProps) {
  const processCollapsed = useStore((s) => s.processCollapsed)
  const thinkingGroupCollapsed = useStore((s) => s.thinkingGroupCollapsed)
  const toolGroupCollapsed = useStore((s) => s.toolGroupCollapsed)
  const toggleProcess = useStore((s) => s.toggleProcess)
  const toggleThinkingGroup = useStore((s) => s.toggleThinkingGroup)
  const toggleToolGroup = useStore((s) => s.toggleToolGroup)
  const liveRounds = useStore((s) => s.liveRounds)
  const streamingAtoms = useStore((s) => s.streamingAtoms)

  // rounds prop null → 旧 atom 无过程，不渲染
  if (rounds === null) return null

  // Use persistent rounds if available, otherwise fall back to live stream
  const displayRounds = rounds.length > 0 ? rounds : liveRounds
  const isStreaming = atomId ? streamingAtoms.has(atomId) : false

  // Nothing to show
  if (displayRounds.length === 0 && interventions.length === 0 && !isStreaming) {
    return null
  }

  // Build interleaved list: rounds + interventions sorted by round position
  const interventionsByRound = new Map<number, Intervention[]>()
  for (const iv of interventions) {
    const list = interventionsByRound.get(iv.afterRound) ?? []
    list.push(iv)
    interventionsByRound.set(iv.afterRound, list)
  }

  return (
    <div className="process-trace">
      {/* Layer 1: header toggle */}
      <button
        className="process-trace__header"
        onClick={toggleProcess}
        aria-expanded={!processCollapsed}
      >
        <span className="process-trace__title">AI 执行过程</span>
        <span className="process-trace__chevron">{processCollapsed ? '▶' : '▼'}</span>
      </button>

      {/* Layer 2: body */}
      {!processCollapsed && (
        <div className="process-trace__body">
          {/* Group toggles row */}
          <div className="process-trace__group-row">
            <button
              className={`process-trace__group-btn${thinkingGroupCollapsed ? '' : ' process-trace__group-btn--active'}`}
              onClick={toggleThinkingGroup}
              aria-pressed={!thinkingGroupCollapsed}
            >
              🧠 思维链 {thinkingGroupCollapsed ? '▶' : '▼'}
            </button>
            <button
              className={`process-trace__group-btn${toolGroupCollapsed ? '' : ' process-trace__group-btn--active'}`}
              onClick={toggleToolGroup}
              aria-pressed={!toolGroupCollapsed}
            >
              🔧 工具调用 {toolGroupCollapsed ? '▶' : '▼'}
            </button>
          </div>

          {/* Rounds + Interventions interleaved */}
          {displayRounds.map((round, i) => (
            <div key={i}>
              <RoundBlock
                round={round}
                index={i}
                isLast={i === displayRounds.length - 1}
                isStreaming={isStreaming}
              />
              {(interventionsByRound.get(i + 1) ?? []).map((iv, j) => (
                <InterventionRecord key={j} intervention={iv} />
              ))}
            </div>
          ))}

          {/* Interventions after round 0 (before any rounds) */}
          {(interventionsByRound.get(0) ?? []).map((iv, j) => (
            <InterventionRecord key={`pre-${j}`} intervention={iv} />
          ))}
        </div>
      )}
    </div>
  )
}
