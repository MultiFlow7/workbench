import { useEffect, useState } from 'react'
import type { TaskRecord } from './TaskCard'
import './TaskOverview.css'

const BACKEND_URL = 'http://localhost:8081'

interface UiEvent {
  event_id: string
  event_name: string
  payload: Record<string, unknown>
  created_at: string
}

const EVENT_LABELS: Record<string, string> = {
  agent_dispatch_triggered: '调度触发',
  agent_dispatch_completed: '执行完成',
  agent_dispatch_failed: '执行失败',
  context_build_duration: '上下文构建',
  pipeline_rule_triggered: '流水线触发',
  main_conversation_protected: '主对话保护',
}

const EVENT_ICON: Record<string, string> = {
  agent_dispatch_triggered: '▶',
  agent_dispatch_completed: '✓',
  agent_dispatch_failed: '✗',
  context_build_duration: '⚙',
  pipeline_rule_triggered: '⚡',
  main_conversation_protected: '🛡',
}

const EVENT_CLASS: Record<string, string> = {
  agent_dispatch_triggered: 'stream-event--triggered',
  agent_dispatch_completed: 'stream-event--completed',
  agent_dispatch_failed: 'stream-event--failed',
  context_build_duration: 'stream-event--context',
  pipeline_rule_triggered: 'stream-event--pipeline',
  main_conversation_protected: 'stream-event--protected',
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function payloadSummary(event_name: string, payload: Record<string, unknown>): string {
  switch (event_name) {
    case 'context_build_duration':
      return `构建耗时 ${payload.build_ms ?? '?'}ms，约 ${payload.context_tokens ?? '?'} tokens`
    case 'agent_dispatch_triggered':
      return `角色：${payload.role ?? '?'}，等待 ${payload.queue_wait_seconds ?? '?'}s`
    case 'agent_dispatch_completed':
      return `输出 ${payload.output_tokens ?? '?'} tokens，耗时 ${payload.duration_seconds ?? '?'}s`
    case 'agent_dispatch_failed':
      return String(payload.error ?? payload.reason ?? '未知错误')
    case 'pipeline_rule_triggered':
      return `规则 ${payload.rule ?? '?'} → 创建任务 ${String(payload.new_task_id ?? '').slice(0, 8)}...`
    case 'main_conversation_protected':
      return '后台任务已完成，主对话未受影响'
    default:
      return JSON.stringify(payload).slice(0, 80)
  }
}

interface ExecutionStreamProps {
  task: TaskRecord
  onBack: () => void
}

export function ExecutionStream({ task, onBack }: ExecutionStreamProps) {
  const [events, setEvents] = useState<UiEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`${BACKEND_URL}/api/tasks/${encodeURIComponent(task.task_id)}/events`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<UiEvent[]>
      })
      .then((data) => setEvents(data))
      .catch((e: unknown) => {
        console.error('[ExecutionStream] fetch failed:', e)
        setError('无法加载执行流数据')
      })
      .finally(() => setLoading(false))
  }, [task.task_id])

  const displayTitle = task.title || task.input_context.slice(0, 50)

  return (
    <div className="execution-stream">
      <div className="execution-stream__header">
        <button className="execution-stream__back-btn" onClick={onBack}>
          ← 返回
        </button>
        <div className="execution-stream__task-info">
          <span className="execution-stream__task-role">{task.role}</span>
          <span className="execution-stream__task-title">{displayTitle}</span>
        </div>
      </div>

      <div className="execution-stream__content">
        {loading && (
          <div className="task-overview__loading">加载执行流...</div>
        )}
        {error && (
          <div className="task-overview__empty">{error}</div>
        )}
        {!loading && !error && events.length === 0 && (
          <div className="task-overview__empty">暂无执行记录（任务可能尚未开始）</div>
        )}
        {!loading && !error && events.map((ev) => (
          <div
            key={ev.event_id}
            className={`stream-event ${EVENT_CLASS[ev.event_name] ?? ''}`}
          >
            <div className="stream-event__icon">
              {EVENT_ICON[ev.event_name] ?? '·'}
            </div>
            <div className="stream-event__body">
              <div className="stream-event__name">
                {EVENT_LABELS[ev.event_name] ?? ev.event_name}
              </div>
              <div className="stream-event__summary">
                {payloadSummary(ev.event_name, ev.payload)}
              </div>
            </div>
            <div className="stream-event__time">{formatTime(ev.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
