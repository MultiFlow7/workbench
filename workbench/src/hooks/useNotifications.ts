import { useEffect } from 'react'
import { useStore } from '../store'

const BACKEND_URL = 'http://localhost:8081'

interface SseNotificationPayload {
  type: string
  task_id?: string
  role?: string
  title?: string
  summary?: string
  error_brief?: string
  rule_id?: string
  source_version?: string
  target_role?: string
  new_task_id?: string
  decision_id?: string
  risk_level?: string
  timestamp?: string
  // v0.8: token_granted 事件新增字段
  token_type?: string
  project?: string
  version?: string
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function useNotifications() {
  const { addToast, incrementPendingCount, setPendingDecisionCount, setLastTokenGranted } = useStore()

  useEffect(() => {
    const url = `${BACKEND_URL}/sse/notifications`
    const es = new EventSource(url)

    const handleMessage = (event: MessageEvent) => {
      let payload: SseNotificationPayload
      try {
        payload = JSON.parse(event.data) as SseNotificationPayload
      } catch {
        return
      }

      switch (payload.type) {
        case 'task_completed': {
          const role = payload.role ?? ''
          const title = payload.title ?? ''
          const msg = title
            ? `✓ 完成：${role} — ${title}`
            : `✓ 任务完成：${role}`
          addToast({
            id: generateId(),
            type: 'success',
            message: msg,
            autoDismiss: true,
          })
          break
        }

        case 'task_failed': {
          const role = payload.role ?? ''
          const brief = payload.error_brief ?? ''
          const msg = brief
            ? `✗ 失败：${role} — ${brief}`
            : `✗ 任务失败：${role}`
          addToast({
            id: generateId(),
            type: 'error',
            message: msg,
            autoDismiss: false,
          })
          break
        }

        case 'pipeline_triggered': {
          const ruleId = payload.rule_id ?? ''
          const targetRole = payload.target_role ?? ''
          addToast({
            id: generateId(),
            type: 'info',
            message: `流水线触发 [${ruleId}]：${targetRole}`,
            autoDismiss: true,
          })
          break
        }

        case 'decision_requested': {
          // Reuse existing decision count logic
          incrementPendingCount()
          break
        }

        case 'token_granted': {
          // v0.8: 触发 DecisionInbox 令牌状态实时刷新
          if (
            payload.token_type &&
            payload.project &&
            payload.version &&
            payload.task_id &&
            payload.timestamp
          ) {
            setLastTokenGranted({
              token_type: payload.token_type,
              project: payload.project,
              version: payload.version,
              task_id: payload.task_id,
              timestamp: payload.timestamp,
            })
          }
          addToast({
            id: generateId(),
            type: 'success',
            message: `令牌颁发：${payload.token_type ?? ''} [${payload.project ?? ''}@${payload.version ?? ''}]`,
            autoDismiss: true,
          })
          break
        }

        case 'task_blocked': {
          // v0.8: 任务阻塞通知，也触发决策计数
          incrementPendingCount()
          addToast({
            id: generateId(),
            type: 'info',
            message: `任务等待令牌：${payload.task_id ?? ''}`,
            autoDismiss: true,
          })
          break
        }

        default:
          break
      }
    }

    es.onmessage = handleMessage

    // Named events (SSE event: field)
    es.addEventListener('task_completed', handleMessage)
    es.addEventListener('task_failed', handleMessage)
    es.addEventListener('pipeline_triggered', handleMessage)
    es.addEventListener('decision_requested', handleMessage)
    es.addEventListener('token_granted', handleMessage)
    es.addEventListener('task_blocked', handleMessage)

    es.onerror = () => {
      // EventSource auto-reconnects; no special handling needed
      console.warn('[useNotifications] SSE connection error, will auto-retry')
    }

    return () => {
      es.close()
    }
  }, [addToast, incrementPendingCount, setPendingDecisionCount, setLastTokenGranted])
}
