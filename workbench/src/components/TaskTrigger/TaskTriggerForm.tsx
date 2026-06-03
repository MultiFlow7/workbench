import { useState } from 'react'
import './TaskTriggerForm.css'

// Hardcoded agent list (will be replaced by /agents/registry in v0.7)
const AGENT_ROLES = [
  'workbench-ceo',
  'workbench-product',
  'review-agent',
  'frontend-ui',
  'backend-agent',
  'tauri-platform',
]

const TASK_TYPES = [
  { value: 'ProductPlanning', label: '产品规划' },
  { value: 'Review', label: '质检/审核' },
  { value: 'Engineering', label: '工程实现' },
  { value: 'Memory', label: '记忆整理' },
  { value: 'Custom', label: '自定义' },
]

const PRIORITIES = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

interface TaskTriggerFormProps {
  onClose: () => void
}

export function TaskTriggerForm({ onClose }: TaskTriggerFormProps) {
  const [role, setRole] = useState('')
  const [taskType, setTaskType] = useState('Custom')
  const [inputContext, setInputContext] = useState('')
  const [project, setProject] = useState('')
  const [version, setVersion] = useState('')
  const [priority, setPriority] = useState('medium')
  const [fileRefs, setFileRefs] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const parseFileRefs = (raw: string): string[] =>
    raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

  const canSubmit = role.trim() !== '' && inputContext.trim() !== '' && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setSuccessMsg(null)
    try {
      await window.api.invoke('create_task', {
        taskReq: {
          role: role.trim(),
          input_context: inputContext.trim(),
          task_type: taskType,
          project: project.trim() || '工作台',
          version: version.trim() || 'v0.7',
          file_refs: parseFileRefs(fileRefs),
          trigger_reason: 'manual',
        },
      })
      setSuccessMsg('任务已加入队列（pending），调度器将在 5 秒内自动接取')
    } catch (e) {
      console.error('[TaskTriggerForm] create_task failed:', e)
      setSuccessMsg(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="task-trigger-form">
      <div className="task-trigger-form__header">
        <h3 className="task-trigger-form__title">触发任务</h3>
        <button
          className="task-trigger-form__close-btn"
          onClick={onClose}
          aria-label="关闭"
        >
          ×
        </button>
      </div>

      <div className="task-trigger-form__body">
        {/* 执行角色 */}
        <div className="task-trigger-form__field">
          <label className="task-trigger-form__label task-trigger-form__label--required">
            执行角色
          </label>
          <select
            className="task-trigger-form__select"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="">请选择 Agent 角色</option>
            {AGENT_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        {/* 任务类型 */}
        <div className="task-trigger-form__field">
          <label className="task-trigger-form__label task-trigger-form__label--required">
            任务类型
          </label>
          <div className="task-trigger-form__radio-group">
            {TASK_TYPES.map(({ value, label }) => (
              <label key={value} className="task-trigger-form__radio-label">
                <input
                  type="radio"
                  className="task-trigger-form__radio-input"
                  name="task-type"
                  value={value}
                  checked={taskType === value}
                  onChange={() => setTaskType(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* 任务描述 */}
        <div className="task-trigger-form__field">
          <label className="task-trigger-form__label task-trigger-form__label--required">
            任务描述
          </label>
          <textarea
            className="task-trigger-form__textarea"
            placeholder="描述 Agent 需要完成的任务（最多 2000 字符）"
            maxLength={2000}
            value={inputContext}
            onChange={(e) => setInputContext(e.target.value)}
            rows={4}
          />
        </div>

        {/* 所属项目 */}
        <div className="task-trigger-form__field">
          <label className="task-trigger-form__label">所属项目</label>
          <input
            type="text"
            className="task-trigger-form__input"
            placeholder="如：工作台"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          />
        </div>

        {/* 所属版本 */}
        <div className="task-trigger-form__field">
          <label className="task-trigger-form__label">所属版本</label>
          <input
            type="text"
            className="task-trigger-form__input"
            placeholder="如：v0.6"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
        </div>

        {/* 优先级 */}
        <div className="task-trigger-form__field">
          <label className="task-trigger-form__label">优先级</label>
          <div className="task-trigger-form__radio-group">
            {PRIORITIES.map(({ value, label }) => (
              <label key={value} className="task-trigger-form__radio-label">
                <input
                  type="radio"
                  className="task-trigger-form__radio-input"
                  name="priority"
                  value={value}
                  checked={priority === value}
                  onChange={() => setPriority(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* 文件引用 */}
        <div className="task-trigger-form__field">
          <label className="task-trigger-form__label">文件引用（file_refs）</label>
          <textarea
            className="task-trigger-form__textarea task-trigger-form__textarea--filerefs"
            placeholder={"每行一个文件路径，例如：\nchangelog/v0.7/technical.md\nchangelog/v0.7/product.md"}
            value={fileRefs}
            onChange={(e) => setFileRefs(e.target.value)}
            rows={3}
          />
        </div>

        <p className="task-trigger-form__hint">
          v0.7：提交后任务将加入队列（pending），Dispatch Manager 将在 5 秒内自动接取执行。
        </p>
      </div>

      <div className="task-trigger-form__footer">
        {successMsg && (
          <div className="task-trigger-form__success">{successMsg}</div>
        )}
        <button
          className="task-trigger-form__submit-btn"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {submitting ? '提交中...' : '提交任务'}
        </button>
      </div>
    </div>
  )
}
