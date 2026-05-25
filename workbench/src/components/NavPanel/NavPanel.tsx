import { useStore } from '../../store'
import './NavPanel.css'

const MODES = [
  { id: 'chat' as const,    icon: '⬡', label: '对话',   enabled: true  },
  { id: 'tools' as const,   icon: '◈', label: '工具',   enabled: false },
  { id: 'console' as const, icon: '▶', label: '控制台', enabled: false },
] as const

export function NavPanel() {
  const { currentMode, setMode } = useStore()

  return (
    <nav className="nav-panel">
      {MODES.map(({ id, icon, label, enabled }) => (
        <button
          key={id}
          className={`nav-btn${currentMode === id ? ' nav-btn--active' : ''}`}
          onClick={() => enabled && setMode(id)}
          disabled={!enabled}
          title={enabled ? label : undefined}
        >
          {icon}
          {!enabled && (
            <span className="nav-btn__tooltip">v0.2 即将支持</span>
          )}
        </button>
      ))}
    </nav>
  )
}
