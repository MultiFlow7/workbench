import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { TaskCard } from './TaskCard'
import type { TaskRecord } from './TaskCard'
import { ExecutionStream } from './ExecutionStream'
import './TaskOverview.css'

type TabKey = 'pending' | 'running' | 'awaiting_decision' | 'completed' | 'failed'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'pending', label: '待执行' },
  { key: 'running', label: '运行中' },
  { key: 'awaiting_decision', label: '等待决策' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败' },
]

function statusToTabKey(status: string): TabKey | null {
  switch (status) {
    case 'Pending': return 'pending'
    case 'Running': return 'running'
    case 'AwaitingDecision': return 'awaiting_decision'
    case 'Completed': return 'completed'
    case 'Failed': return 'failed'
    default: return null
  }
}

interface TaskOverviewProps {
  onTriggerTask?: () => void
}

export function TaskOverview({ onTriggerTask }: TaskOverviewProps) {
  const taskRefreshTick = useStore((s) => s.taskRefreshTick)
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('pending')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const selectedTask = tasks.find((t) => t.task_id === selectedTaskId) ?? null

  const loadTasks = async () => {
    setLoading(true)
    try {
      const raw = await window.api.invoke<TaskRecord[]>('list_tasks', {
        status: null,
        role: null,
        project: null,
      })
      setTasks(raw)
    } catch (e) {
      console.error('[TaskOverview] list_tasks failed:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTasks()
  }, [taskRefreshTick])

  // If a task is selected, show execution stream view
  if (selectedTask !== null) {
    return (
      <ExecutionStream
        task={selectedTask}
        onBack={() => setSelectedTaskId(null)}
      />
    )
  }

  // Count per tab
  const counts: Record<TabKey, number> = {
    pending: 0,
    running: 0,
    awaiting_decision: 0,
    completed: 0,
    failed: 0,
  }
  for (const t of tasks) {
    const key = statusToTabKey(t.status)
    if (key) counts[key]++
  }

  const filtered = tasks.filter((t) => statusToTabKey(t.status) === activeTab)

  return (
    <div className="task-overview">
      <div className="task-overview__header">
        <h2 className="task-overview__title">任务总览</h2>
        {onTriggerTask && (
          <button
            className="task-overview__trigger-btn"
            onClick={onTriggerTask}
          >
            + 触发任务
          </button>
        )}
      </div>

      <div className="task-overview__tabs">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            className={`task-overview__tab${activeTab === key ? ' task-overview__tab--active' : ''}`}
            onClick={() => setActiveTab(key)}
          >
            {label}
            <span className="task-overview__tab-count">{counts[key]}</span>
          </button>
        ))}
      </div>

      <div className="task-overview__content">
        {loading ? (
          <div className="task-overview__loading">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="task-overview__empty">暂无</div>
        ) : (
          filtered.map((task) => (
            <TaskCard
              key={task.task_id}
              task={task}
              selected={selectedTaskId === task.task_id}
              onSelect={setSelectedTaskId}
            />
          ))
        )}
      </div>
    </div>
  )
}
