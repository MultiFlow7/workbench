import './TaskOverview.css'

export interface TaskRecord {
  task_id: string
  task_type: string
  role: string
  status: string
  project: string
  version: string
  input_context: string
  title?: string
  output?: string | null
  blocking_on?: string | null
  created_at: string
  updated_at: string
}

interface TaskCardProps {
  task: TaskRecord
  selected: boolean
  onSelect: (id: string) => void
}

const STATUS_LABELS: Record<string, string> = {
  Pending: '待执行',
  Running: '运行中',
  Blocked: '阻塞',
  AwaitingDecision: '等待决策',
  Completed: '已完成',
  Failed: '失败',
}

const STATUS_CLASS: Record<string, string> = {
  Pending: 'task-card__status--pending',
  Running: 'task-card__status--running',
  Blocked: 'task-card__status--blocked',
  AwaitingDecision: 'task-card__status--awaiting',
  Completed: 'task-card__status--completed',
  Failed: 'task-card__status--failed',
}

function formatElapsed(createdAt: string): string {
  const diff = Date.now() - new Date(createdAt).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  return `${Math.floor(hr / 24)} 天前`
}

export function TaskCard({ task, selected, onSelect }: TaskCardProps) {
  const displayTitle =
    task.title ||
    (task.input_context ? task.input_context.slice(0, 50) : '(无描述)')

  const statusLabel = STATUS_LABELS[task.status] ?? task.status
  const statusClass = STATUS_CLASS[task.status] ?? ''

  return (
    <div
      className={`task-card${selected ? ' task-card--selected' : ''}`}
      onClick={() => onSelect(task.task_id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(task.task_id)
        }
      }}
    >
      <div className="task-card__header">
        <span className="task-card__role">{task.role}</span>
        <span className={`task-card__status ${statusClass}`}>{statusLabel}</span>
        <span className="task-card__time">{formatElapsed(task.created_at)}</span>
      </div>
      <div className="task-card__title">{displayTitle}</div>
      <div className="task-card__meta">
        <span className="task-card__project">{task.project}</span>
        {task.version && (
          <span className="task-card__version">{task.version}</span>
        )}
      </div>
    </div>
  )
}
