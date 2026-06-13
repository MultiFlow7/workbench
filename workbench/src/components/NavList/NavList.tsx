import { useState } from 'react'
import { useStore } from '../../store'
import './NavList.css'

export function NavList() {
  const {
    projects,
    selectedProjectId,
    selectProject,
    selectAtom,
    setMode,
    createProject,
    selectedAtomId,
  } = useStore()

  // T-10: 细粒度订阅 atoms，避免整个 store 引用变化触发无谓重渲染
  const atoms = useStore((s) => s.atoms)

  // T-7/T-8/T-9: 内联新建项目 state
  const [showNewProjectInput, setShowNewProjectInput] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectError, setNewProjectError] = useState<string | null>(null)
  const [newProjectLoading, setNewProjectLoading] = useState(false)

  // 内存优先策略：先解锁 textarea，再异步处理项目关联和磁盘写入
  const handleNewConversation = async () => {
    // 清除选中状态，切换到对话模式；不预创建占位 atom，
    // 第一条消息发送时 ChatView 会将 Q&A atom 本身作为根节点写入
    useStore.setState({ selectedAtomId: null, currentPath: [] })
    setMode('chat')

    // 确保有选中的项目（没有则创建今日项目）
    if (!selectedProjectId) {
      const now = new Date()
      const pad2 = (n: number) => String(n).padStart(2, '0')
      const dateName = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
      try {
        await createProject(dateName)
      } catch (e) {
        const errMsg = String(e)
        if (errMsg.includes('已存在')) {
          const existing = projects.find((p) => p.name === dateName)
          if (existing) selectProject(existing.id)
        } else {
          console.error('[NavList] createProject failed:', errMsg)
        }
      }
    }
  }

  // T-7/T-8/T-9: handleNewProject handler
  const handleNewProject = async () => {
    const trimmed = newProjectName.trim()
    if (!trimmed) return
    setNewProjectLoading(true)
    setNewProjectError(null)
    try {
      await createProject(trimmed)
      setShowNewProjectInput(false)
      setNewProjectName('')
    } catch (e) {
      setNewProjectError(String(e))
    } finally {
      setNewProjectLoading(false)
    }
  }

  // T-10: 派生 rootAtoms（当前项目内 prev === null 的根节点，按 timestamp 倒序）
  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  const projectAtomIds = new Set(selectedProject?.atomIds ?? [])

  const rootAtoms = Object.values(atoms)
    .filter((a) => a.prev === null && projectAtomIds.has(a.id))
    .sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

  return (
    <div className="nav-list">
      {/* 新建对话 */}
      <div className="nav-list__new">
        <button className="nav-list__new-btn" onClick={handleNewConversation}>
          + 新建对话
        </button>
      </div>

      {/* 最近 */}
      <section className="nav-list__section">
        <h3 className="nav-list__heading">最近</h3>
        <p className="nav-list__empty">暂无最近对话</p>
      </section>

      {/* T-11/T-12: 对话 section 渲染 rootAtoms */}
      <section className="nav-list__section">
        <h3 className="nav-list__heading">对话</h3>
        {rootAtoms.length === 0 ? (
          <p className="nav-list__empty">暂无对话</p>
        ) : (
          <ul className="nav-list__items">
            {rootAtoms.map((atom) => {
              const title = atom.summary
                ? atom.summary.slice(0, 30) + (atom.summary.length > 30 ? '…' : '')
                : '新对话'
              return (
                <li key={atom.id}>
                  <button
                    className={`nav-list__item${
                      selectedAtomId === atom.id ? ' nav-list__item--active' : ''
                    }`}
                    onClick={() => {
                      selectAtom(atom.id)
                      setMode('chat')
                    }}
                    title={atom.summary || '新对话'}
                  >
                    <span
                      className={`nav-list__pip${
                        selectedAtomId === atom.id ? ' nav-list__pip--active' : ''
                      }`}
                    />
                    <span className="nav-list__item-name">{title}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* T-7/T-8/T-9: 项目 section 标题改为 flex header + + 按钮 + 内联输入框 */}
      <section className="nav-list__section">
        <div className="nav-list__section-header">
          <h3 className="nav-list__heading">项目</h3>
          <button
            className="nav-list__section-add"
            onClick={() => {
              setShowNewProjectInput(true)
              setNewProjectError(null)
              setNewProjectName('')
            }}
            title="新建项目"
          >
            +
          </button>
        </div>

        {showNewProjectInput && (
          <div className="nav-list__inline-input">
            <input
              autoFocus
              className="nav-list__inline-field"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="项目名称"
              disabled={newProjectLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNewProject()
                if (e.key === 'Escape') {
                  setShowNewProjectInput(false)
                  setNewProjectName('')
                  setNewProjectError(null)
                }
              }}
            />
            {newProjectError && (
              <div className="nav-list__error">{newProjectError}</div>
            )}
          </div>
        )}

        {/* T-13: 项目列表原有渲染逻辑保持不变 */}
        {projects.length === 0 ? (
          <p className="nav-list__empty">暂无项目</p>
        ) : (
          <ul className="nav-list__items">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  className={`nav-list__item${selectedProjectId === project.id ? ' nav-list__item--active' : ''}`}
                  onClick={() => selectProject(project.id)}
                  title={project.name}
                >
                  <span className="nav-list__folder-icon">◫</span>
                  <span className="nav-list__item-name">{project.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
