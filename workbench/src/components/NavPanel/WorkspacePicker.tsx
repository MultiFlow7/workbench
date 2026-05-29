/**
 * WorkspacePicker — 节点 4.2
 *
 * 点击触发 dialog:pickFolder IPC，显示当前已选工作目录路径。
 * 路径持久化到 Zustand layoutSlice 的 workspaceCwd 字段（按需扩充）。
 * IPC handler `dialog:pickFolder` 由节点 1.4 已实现。
 */

import { useState, useEffect } from 'react'
import './WorkspacePicker.css'

export function WorkspacePicker() {
  const [cwd, setCwd] = useState<string>('')
  const [picking, setPicking] = useState(false)

  // Read initial cwd from electron main process on mount
  useEffect(() => {
    window.api
      .invoke<string | null>('dialog:getCwd')
      .then((path) => {
        if (path) setCwd(path)
      })
      .catch(() => {/* handler may not exist yet — silent */ })
  }, [])

  const handlePick = async () => {
    if (picking) return
    setPicking(true)
    try {
      const selected = await window.api.invoke<string | null>(
        'dialog:pickFolder'
      )
      if (selected) setCwd(selected)
    } catch (e) {
      console.error('[WorkspacePicker] dialog:pickFolder error:', e)
    } finally {
      setPicking(false)
    }
  }

  const displayPath = cwd
    ? cwd.replace(/^.*[\\/]([^\\/]+)[\\/]?$/, '$1') || cwd
    : '选择工作目录'

  return (
    <button
      className={`workspace-picker${picking ? ' workspace-picker--loading' : ''}`}
      onClick={handlePick}
      title={cwd || '点击选择工作目录'}
      disabled={picking}
    >
      <span className="workspace-picker__icon">◫</span>
      <span className="workspace-picker__label">{displayPath}</span>
    </button>
  )
}
