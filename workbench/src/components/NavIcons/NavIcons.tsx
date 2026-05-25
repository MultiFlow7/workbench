import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../../store'
import { StoredApiKey } from '../../store/settingsSlice'
import './NavIcons.css'

const MODES = [
  { id: 'chat' as const,    icon: '⬡', label: '对话',   enabled: true  },
  { id: 'tools' as const,   icon: '◈', label: '工具',   enabled: true  },
  { id: 'console' as const, icon: '▶', label: '控制台', enabled: true  },
] as const

function DashboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="10" width="3.5" height="6.5" rx="0.5" fill="currentColor" />
      <rect x="7.25" y="6" width="3.5" height="10.5" rx="0.5" fill="currentColor" />
      <rect x="13.5" y="2" width="3.5" height="14.5" rx="0.5" fill="currentColor" />
    </svg>
  )
}

function AnalyticsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="9" width="3" height="7.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="7.5" y="5" width="3" height="11.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13.5" y="1.5" width="3" height="15" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

// Decisions inbox icon (SVG inbox shape)
function InboxIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="1.5" width="15" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.5 11.5H5.5L6.5 13.5H11.5L12.5 11.5H16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.4 3.4l1.4 1.4M13.2 13.2l1.4 1.4M14.6 3.4l-1.4 1.4M4.8 13.2l-1.4 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

type EditingKey = Partial<StoredApiKey> & { isNew?: boolean }

function KeyForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: EditingKey
  onSave: (entry: Omit<StoredApiKey, 'id'> & { id?: string }) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(initial.label ?? '')
  const [key, setKey] = useState(initial.key ?? '')
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl ?? '')
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<string[]>(initial.models ?? [])
  const [modelInput, setModelInput] = useState('')

  const canSave = label.trim() && key.trim()

  const addModel = () => {
    const m = modelInput.trim()
    if (m && !models.includes(m)) setModels(prev => [...prev, m])
    setModelInput('')
  }

  return (
    <>
      <div className="settings-panel__section">
        <div className="settings-panel__label">标签</div>
        <input
          className="settings-panel__input"
          type="text"
          placeholder="如：默认、公司账号、个人 Pro…"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          autoFocus
        />
      </div>
      <div className="settings-panel__section">
        <div className="settings-panel__label">API Key</div>
        <div className="settings-panel__input-row">
          <input
            className="settings-panel__input"
            type={showKey ? 'text' : 'password'}
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
          <button
            className="settings-panel__eye-btn"
            onClick={() => setShowKey((v) => !v)}
            title={showKey ? '隐藏' : '显示'}
          >
            {showKey ? '🙈' : '👁'}
          </button>
        </div>
      </div>
      <div className="settings-panel__section">
        <div className="settings-panel__label">
          Base URL <span className="settings-panel__optional">（可选）</span>
        </div>
        <input
          className="settings-panel__input"
          type="text"
          placeholder="默认官方端点，留空即可"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>
      <div className="settings-panel__section">
        <div className="settings-panel__label">
          可用模型 <span className="settings-panel__optional">（可选，留空则显示全部默认）</span>
        </div>
        {models.length > 0 && (
          <div className="model-tags">
            {models.map(m => (
              <span key={m} className="model-tag">
                {m}
                <button className="model-tag__remove" onClick={() => setModels(prev => prev.filter(x => x !== m))}>×</button>
              </span>
            ))}
          </div>
        )}
        <div className="settings-panel__input-row">
          <input
            className="settings-panel__input"
            type="text"
            placeholder="输入模型名，回车添加…"
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addModel() } }}
          />
          <button
            className="settings-panel__eye-btn"
            onClick={addModel}
            disabled={!modelInput.trim()}
            title="添加"
          >+</button>
        </div>
        <div className="settings-panel__hint">如：claude-sonnet-4-6、gemini-2.5-pro</div>
      </div>
      <div className="settings-panel__actions">
        <button className="settings-panel__btn--clear" onClick={onCancel}>取消</button>
        <button
          className="settings-panel__btn--save"
          onClick={() => onSave({
            id: initial.id,
            label: label.trim(),
            key: key.trim(),
            baseUrl: baseUrl.trim() || undefined,
            models,
          })}
          disabled={!canSave}
        >
          保存
        </button>
      </div>
    </>
  )
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { apiKeys, addApiKey, updateApiKey, removeApiKey } = useStore()
  const [editing, setEditing] = useState<EditingKey | null>(null)

  const handleSave = (entry: Omit<StoredApiKey, 'id'> & { id?: string }) => {
    if (entry.id) {
      updateApiKey(entry as StoredApiKey)
    } else {
      addApiKey(entry)
    }
    setEditing(null)
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel__header">
          {editing ? (
            <button className="settings-panel__back" onClick={() => setEditing(null)}>
              ← API Keys
            </button>
          ) : (
            <span className="settings-panel__title">设置</span>
          )}
          <button className="settings-panel__close" onClick={onClose}>×</button>
        </div>

        {editing ? (
          <KeyForm
            initial={editing}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <>
            <div className="settings-panel__section">
              <div className="settings-panel__label">API Keys</div>
              {apiKeys.length === 0 ? (
                <div className="settings-panel__hint">尚未添加任何 API Key</div>
              ) : (
                <div className="key-list">
                  {apiKeys.map((k) => (
                    <div key={k.id} className="key-list__row">
                      <div className="key-list__info">
                        <span className="key-list__label">{k.label}</span>
                        <span className="key-list__preview">
                          {k.key.slice(0, 8)}…
                          {k.models.length > 0 && <span className="key-list__url"> · {k.models.length} 个模型</span>}
                          {k.baseUrl && <span className="key-list__url"> · {k.baseUrl.replace(/^https?:\/\//, '').slice(0, 14)}</span>}
                        </span>
                      </div>
                      <div className="key-list__actions">
                        <button
                          className="key-list__btn"
                          title="编辑"
                          onClick={() => setEditing(k)}
                        >✎</button>
                        <button
                          className="key-list__btn key-list__btn--danger"
                          title="删除"
                          onClick={() => removeApiKey(k.id)}
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                className="key-list__add-btn"
                onClick={() => setEditing({ isNew: true })}
              >
                + 添加 API Key
              </button>
            </div>

            <div className="settings-panel__section settings-panel__section--muted">
              <div className="settings-panel__hint">
                每个 Key 的模型会合并到对话选择器<br/>
                发送时自动匹配对应 Key
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function NavIcons() {
  const { currentMode, setMode, pendingDecisionCount } = useStore()
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <nav className="nav-icons">
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      <div className="nav-icons__modes">
        {MODES.map(({ id, icon, label, enabled }) => (
          <button
            key={id}
            className={`nav-icon-btn${currentMode === id ? ' nav-icon-btn--active' : ''}`}
            onClick={() => {
              if (!enabled) return
              const t0 = performance.now()
              setMode(id)
              invoke('write_event_log', { event: { event: 'mode_switch', timestamp: new Date().toISOString(), payload: { to_mode: id, latency_ms: Math.round(performance.now() - t0) } } }).catch(() => {})
            }}
            disabled={!enabled}
            title={enabled ? label : undefined}
          >
            {icon}
            {!enabled && (
              <span className="nav-icon-btn__tooltip">v0.2 即将支持</span>
            )}
          </button>
        ))}

        {/* v0.4: dashboard 模式入口 */}
        <button
          className={`nav-icon-btn${currentMode === 'dashboard' ? ' nav-icon-btn--active' : ''}`}
          onClick={() => {
            const t0 = performance.now()
            setMode('dashboard')
            invoke('write_event_log', { event: { event: 'mode_switch', timestamp: new Date().toISOString(), payload: { to_mode: 'dashboard', latency_ms: Math.round(performance.now() - t0) } } }).catch(() => {})
          }}
          title="Token 仪表盘"
          aria-label="Token 仪表盘"
        >
          <DashboardIcon />
        </button>

        {/* v0.3: analytics 模式入口 */}
        <button
          className={`nav-icon-btn${currentMode === 'analytics' ? ' nav-icon-btn--active' : ''}`}
          onClick={() => {
            const t0 = performance.now()
            setMode('analytics')
            invoke('write_event_log', { event: { event: 'mode_switch', timestamp: new Date().toISOString(), payload: { to_mode: 'analytics', latency_ms: Math.round(performance.now() - t0) } } }).catch(() => {})
          }}
          title="Token 统计"
          aria-label="Token 统计"
        >
          <AnalyticsIcon />
        </button>

        {/* v0.2: decisions 模式入口 */}
        <div className="nav-icon-wrapper">
          <button
            className={`nav-icon-btn${currentMode === 'decisions' ? ' nav-icon-btn--active' : ''}`}
            onClick={() => {
              const t0 = performance.now()
              setMode('decisions')
              invoke('write_event_log', { event: { event: 'mode_switch', timestamp: new Date().toISOString(), payload: { to_mode: 'decisions', latency_ms: Math.round(performance.now() - t0) } } }).catch(() => {})
            }}
            title="决策收件箱"
            aria-label="决策收件箱"
          >
            <InboxIcon />
          </button>
          {pendingDecisionCount > 0 && (
            <span className="decision-badge" aria-label={`${pendingDecisionCount} 个待决策`}>
              {pendingDecisionCount > 99 ? '99+' : pendingDecisionCount}
            </span>
          )}
        </div>
      </div>

      <div className="nav-icons__bottom">
        <button
          className="nav-icon-btn"
          title="设置"
          aria-label="设置"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon />
        </button>
      </div>
    </nav>
  )
}
