/**
 * NavSection — 节点 4.2
 *
 * P1 Nav 内容区，含：
 *   - WorkspacePicker（工作目录选择器）
 *   - 工作区（项目）列表
 *   - 对话列表（当前项目的根对话节点，活动对话脉冲 dot 标记）
 *
 * 列表项点击更新 Zustand store 中的 selectedAtomId / selectedProjectId。
 * 面板间通信只通过 Zustand store（frontend-patterns 规范）。
 */

import { useState } from 'react'
import { useStore } from '../../store'
import { WorkspacePicker } from './WorkspacePicker'
import './NavSection.css'

export function NavSection() {
  const atoms = useStore((s) => s.atoms)
  const projects = useStore((s) => s.projects)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const selectedAtomId = useStore((s) => s.selectedAtomId)
  const streamingAtoms = useStore((s) => s.streamingAtoms)
  const selectProject = useStore((s) => s.selectProject)
  const selectAtom = useStore((s) => s.selectAtom)
  const setMode = useStore((s) => s.setMode)
  const createProject = useStore((s) => s.createProject)

  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectLoading, setNewProjectLoading] = useState(false)
  const [newProjectError, setNewProjectError] = useState<string | null>(null)

  // Root atoms for selected project (prev === null), newest first
  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  const projectAtomIds = new Set(selectedProject?.atomIds ?? [])
  const rootAtoms = Object.values(atoms)
    .filter((a) => a.prev === null && projectAtomIds.has(a.id))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  const handleNewProject = async () => {
    const name = newProjectName.trim()
    if (!name) return
    setNewProjectLoading(true)
    setNewProjectError(null)
    try {
      await createProject(name)
      setShowNewProject(false)
      setNewProjectName('')
    } catch (e) {
      setNewProjectError(String(e))
    } finally {
      setNewProjectLoading(false)
    }
  }

  return (
    <div className="nav-section">
      {/* Workspace picker */}
      <div className="nav-section__workspace">
        <WorkspacePicker />
      </div>

      {/* Workspace / Project list */}
      <section className="nav-section__group">
        <div className="nav-section__group-header">
          <span className="nav-section__group-title">工作区</span>
          <button
            className="nav-section__add-btn"
            onClick={() => {
              setShowNewProject(true)
              setNewProjectName('')
              setNewProjectError(null)
            }}
            title="新建工作区"
          >
            +
          </button>
        </div>

        {showNewProject && (
          <div className="nav-section__inline-input">
            <input
              autoFocus
              className="nav-section__input-field"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="工作区名称"
              disabled={newProjectLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNewProject()
                if (e.key === 'Escape') {
                  setShowNewProject(false)
                  setNewProjectName('')
                  setNewProjectError(null)
                }
              }}
            />
            {newProjectError && (
              <div className="nav-section__error">{newProjectError}</div>
            )}
          </div>
        )}

        {projects.length === 0 ? (
          <p className="nav-section__empty">暂无工作区</p>
        ) : (
          <ul className="nav-section__list">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  className={`nav-section__item${
                    selectedProjectId === project.id
                      ? ' nav-section__item--active'
                      : ''
                  }`}
                  onClick={() => selectProject(project.id)}
                  title={project.name}
                >
                  <span className="nav-section__item-icon">◫</span>
                  <span className="nav-section__item-name">{project.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Conversation list */}
      <section className="nav-section__group">
        <div className="nav-section__group-header">
          <span className="nav-section__group-title">对话</span>
        </div>

        {rootAtoms.length === 0 ? (
          <p className="nav-section__empty">暂无对话</p>
        ) : (
          <ul className="nav-section__list">
            {rootAtoms.map((atom) => {
              const isActive = selectedAtomId === atom.id
              const isStreaming = streamingAtoms.has(atom.id)
              const title = atom.summary
                ? atom.summary.slice(0, 28) +
                  (atom.summary.length > 28 ? '…' : '')
                : '新对话'
              return (
                <li key={atom.id}>
                  <button
                    className={`nav-section__item${
                      isActive ? ' nav-section__item--active' : ''
                    }`}
                    onClick={() => {
                      selectAtom(atom.id)
                      setMode('chat')
                    }}
                    title={atom.summary || '新对话'}
                  >
                    {/* Pulse dot for active/streaming sessions */}
                    <span
                      className={`nav-section__dot${
                        isActive || isStreaming
                          ? isStreaming
                            ? ' nav-section__dot--pulse'
                            : ' nav-section__dot--active'
                          : ''
                      }`}
                    />
                    <span className="nav-section__item-name">{title}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
