import { useEffect, useState } from 'react'
import './AgentRegistry.css'

export interface AgentInfo {
  role: string
  description: string
  running_count: number
  awaiting_count: number
  failed_count: number
}

const BACKEND_URL = 'http://43.135.174.27:8081'

type DotStatus = 'idle' | 'running' | 'awaiting' | 'failed'

function getDotStatus(agent: AgentInfo): DotStatus {
  if (agent.failed_count > 0) return 'failed'
  if (agent.awaiting_count > 0) return 'awaiting'
  if (agent.running_count > 0) return 'running'
  return 'idle'
}

function getTaskSummary(agent: AgentInfo): string {
  const parts: string[] = []
  if (agent.running_count > 0) parts.push(`${agent.running_count} 个运行中`)
  if (agent.awaiting_count > 0) parts.push(`${agent.awaiting_count} 个等待决策`)
  if (agent.failed_count > 0) parts.push(`${agent.failed_count} 个失败`)
  if (parts.length === 0) return '当前无活跃任务'
  return '当前任务：' + parts.join('，')
}

interface AgentListProps {
  selectedRole: string | null
  onSelect: (role: string) => void
}

export function AgentList({ selectedRole, onSelect }: AgentListProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`${BACKEND_URL}/agents/registry`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<Array<{ id: string; path: string; status: string; description: string }>>
      })
      .then((data) => {
        setAgents(data.map((a) => ({
          role: a.id,
          description: a.description,
          running_count: 0,
          awaiting_count: 0,
          failed_count: 0,
        })))
      })
      .catch((e: unknown) => {
        console.error('[AgentList] fetch failed:', e)
        setError('暂无 Agent 数据，请检查 registry.yaml')
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="agent-list">
      <div className="agent-list__header">
        <h3 className="agent-list__title">Agent 团队</h3>
      </div>
      <div className="agent-list__content">
        {loading && <div className="agent-list__loading">加载中...</div>}
        {error && <div className="agent-list__error">{error}</div>}
        {!loading && !error && agents.length === 0 && (
          <div className="agent-list__empty">暂无注册 Agent</div>
        )}
        {!loading && !error && agents.map((agent) => {
          const dot = getDotStatus(agent)
          const taskSummary = getTaskSummary(agent)
          return (
            <div
              key={agent.role}
              className={`agent-card${selectedRole === agent.role ? ' agent-card--selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(agent.role)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(agent.role)
                }
              }}
            >
              <span className={`agent-card__dot agent-card__dot--${dot}`} />
              <div className="agent-card__info">
                <div className="agent-card__role">{agent.role}</div>
                <div className="agent-card__desc">{agent.description}</div>
                <div className="agent-card__tasks">{taskSummary}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
