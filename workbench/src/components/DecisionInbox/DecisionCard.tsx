import type { MouseEvent } from 'react'
import type { DecisionRecord, DecisionOption } from '../../store/decisionsSlice'
import './DecisionCard.css'


interface DecisionCardProps {
  decision: DecisionRecord
  selected: boolean
  onSelect: (id: string) => void
  onResolve: (id: string, resolution: string) => void
  onSnooze: (id: string) => void
}

function formatWaitTime(createdAt: string): string {
  const created = new Date(createdAt)
  const now = new Date()
  const diffMs = now.getTime() - created.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} 小时前`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay} 天前`
}

function riskLabel(level: DecisionRecord['risk_level']): string {
  switch (level) {
    case 'High': return 'HIGH'
    case 'Medium': return 'MEDIUM'
    case 'Low': return 'LOW'
  }
}

export function DecisionCard({ decision, selected, onSelect, onResolve, onSnooze }: DecisionCardProps) {
  const { decision_id, agent_role, question, options, risk_level, created_at } = decision

  const riskKey = riskLabel(risk_level)

  const handleCardClick = (e: MouseEvent) => {
    // Prevent click from buttons propagating to card
    if ((e.target as HTMLElement).closest('.decision-card__actions')) return
    onSelect(decision_id)
  }

  const handleResolve = (e: MouseEvent, optionKey: string) => {
    e.stopPropagation()
    onResolve(decision_id, optionKey)
  }

  return (
    <div
      className={`decision-card decision-card--${riskKey}${selected ? ' decision-card--selected' : ''}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(decision_id)
        }
      }}
    >
      <div className="decision-card__header">
        <span className="decision-card__agent-tag">{agent_role}</span>
        <span className={`decision-card__risk-badge decision-card__risk-badge--${riskKey}`}>
          {riskKey}
        </span>
        <span className="decision-card__wait-time">{formatWaitTime(created_at)}</span>
      </div>

      <div className="decision-card__question">{question}</div>

      {options.some((o) => o.description) && (
        <div className="decision-card__options">
          {options.map((opt: DecisionOption) => (
            opt.description ? (
              <div key={opt.key} className="decision-card__option-row">
                <span className="decision-card__option-label">{opt.label}：</span>
                <span className="decision-card__option-desc">{opt.description}</span>
              </div>
            ) : null
          ))}
        </div>
      )}

      <div className="decision-card__actions">
        {options.map((opt: DecisionOption, idx: number) => (
          <button
            key={opt.key}
            className={`decision-card__btn ${idx === 0 ? 'decision-card__btn--primary' : 'decision-card__btn--secondary'}`}
            onClick={(e) => handleResolve(e, opt.key)}
          >
            {opt.label}
          </button>
        ))}
        <button
          className="decision-card__btn decision-card__btn--snooze"
          onClick={(e) => { e.stopPropagation(); onSnooze(decision_id) }}
          title="暂时隐藏，稍后再处理"
        >
          稍后处理
        </button>
      </div>
    </div>
  )
}
