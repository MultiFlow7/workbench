import { useEffect, useState } from 'react'
import type { AgentInfo } from './AgentList'
import './AgentRegistry.css'

const BACKEND_URL = 'http://43.135.174.27:8081'

interface AgentTask {
  task_id: string
  role: string
  status: string
  title: string | null
  input_context: string
}

interface AgentDetailProps {
  agent: AgentInfo | null
}

export function AgentDetail({ agent }: AgentDetailProps) {
  const [doc, setDoc] = useState<string | null>(null)
  const [docLoading, setDocLoading] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<AgentTask[]>([])

  useEffect(() => {
    if (!agent) return
    // Fetch AGENT.md doc
    setDocLoading(true)
    setDocError(null)
    setDoc(null)
    fetch(`${BACKEND_URL}/agents/${encodeURIComponent(agent.role)}/doc`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((text) => setDoc(text))
      .catch((e: unknown) => {
        console.error('[AgentDetail] doc fetch failed:', e)
        setDocError('无法加载该 Agent 的文档')
      })
      .finally(() => setDocLoading(false))

    // Fetch current tasks for this agent
    fetch(
      `${BACKEND_URL}/api/tasks?role=${encodeURIComponent(agent.role)}`
    )
      .then((res) => {
        if (!res.ok) return []
        return res.json() as Promise<AgentTask[]>
      })
      .then((data) => {
        const active = data.filter(
          (t) =>
            t.status === 'Running' ||
            t.status === 'AwaitingDecision' ||
            t.status === 'Failed'
        )
        setTasks(active)
      })
      .catch(() => setTasks([]))
  }, [agent?.role])

  if (!agent) {
    return (
      <div className="agent-detail">
        <div className="agent-detail__placeholder">选择左侧 Agent 查看详情</div>
      </div>
    )
  }

  return (
    <div className="agent-detail">
      <div className="agent-detail__header">
        <h3 className="agent-detail__role">{agent.role}</h3>
        <p className="agent-detail__desc">{agent.description}</p>
      </div>

      <div className="agent-detail__content">
        {/* Current tasks */}
        <p className="agent-detail__section-title">当前任务</p>
        {tasks.length === 0 ? (
          <p className="agent-detail__no-tasks">无活跃任务</p>
        ) : (
          <div className="agent-detail__tasks-list">
            {tasks.map((t) => (
              <div key={t.task_id} className="agent-detail__task-item">
                <span className={`agent-detail__task-status agent-detail__task-status--${t.status}`}>
                  {t.status}
                </span>
                <span>{t.title ?? t.input_context.slice(0, 40)}</span>
              </div>
            ))}
          </div>
        )}

        {/* AGENT.md */}
        <p className="agent-detail__section-title">Agent 文档</p>
        {docLoading && (
          <p className="agent-detail__doc-loading">加载文档中...</p>
        )}
        {docError && !docLoading && (
          <div className="agent-detail__doc-missing">
            <p className="agent-detail__doc-missing-hint">
              服务器上未找到该 Agent 的 AGENT.md 文档文件。
            </p>
            {agent.description && (
              <p className="agent-detail__doc-desc-fallback">{agent.description}</p>
            )}
          </div>
        )}
        {doc && (
          <pre className="agent-detail__doc">{doc}</pre>
        )}
      </div>
    </div>
  )
}
