/**
 * WorkspacePicker — 节点 4.2
 *
 * 点击触发 dialog:pickFolder IPC，显示当前已选工作目录路径。
 * 路径持久化到 Zustand layoutSlice 的 workspaceCwd 字段（按需扩充）。
 * IPC handler `dialog:pickFolder` 由节点 1.4 已实现。
 */

import { useState, useEffect } from 'react'
import { useStore } from '../../store'
import './WorkspacePicker.css'

export function WorkspacePicker() {
  const [cwd, setCwd] = useState<string>('')
  const [picking, setPicking] = useState(false)
  const loadAtoms = useStore((s) => s.loadAtoms)
  const loadProjects = useStore((s) => s.loadProjects)

  useEffect(() => {
    window.api
      .invoke<string | null>('workspace:getCwd')
      .then((path) => { if (path) setCwd(path) })
      .catch(() => {})
  }, [])

  const handlePick = async () => {
    if (picking) return
    setPicking(true)
    try {
      const selected = await window.api.invoke<string | null>('dialog:pickFolder')
      if (selected) {
        setCwd(selected)
        await Promise.all([loadProjects(), loadAtoms()])
      }
    } catch (e) {
      console.error('[WorkspacePicker] dialog:pickFolder error:', e)
    } finally {
      setPicking(false)
    }
  }

  return (
    <button
      className={`workspace-picker${picking ? ' workspace-picker--loading' : ''}`}
      onClick={handlePick}
      title={cwd || '点击选择工作目录'}
      disabled={picking}
    >
      <span className="workspace-icon">◫</span>
      <div className="workspace-info">
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-path">{cwd || '未选择目录'}</div>
      </div>
      <span className="workspace-arrow">›</span>
    </button>
  )
}
