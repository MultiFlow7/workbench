import React, { useRef, useCallback } from 'react'
import { useStore } from '../../store'
import './Layout.css'

interface LayoutProps {
  topBar: React.ReactNode
  p1Icons: React.ReactNode
  p1List: React.ReactNode
  p2: React.ReactNode
  p3: React.ReactNode
  p4: React.ReactNode
}

export function Layout({ topBar, p1Icons, p1List, p2, p3, p4 }: LayoutProps) {
  const { p1ListVisible, p2Visible, p4Visible, toggleP2, toggleP4, p1IconsVisible, toggleP1, p2Width, setP2Width } = useStore()

  const dragStartX = useRef(0)
  const dragStartW = useRef(0)

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartX.current = e.clientX
    dragStartW.current = p2Width
    const onMove = (me: MouseEvent) => {
      setP2Width(dragStartW.current + me.clientX - dragStartX.current)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [p2Width, setP2Width])

  return (
    <div className="workspace-root">
      {topBar}

      <div className="workspace">
        {/* p1-icons: 固定 52px，p1IconsVisible=false 时收起为 20px strip */}
        <div
          className={`panel panel--p1-icons${p1IconsVisible ? '' : ' panel--collapsed'}`}
          style={p1IconsVisible ? undefined : { cursor: 'pointer' }}
          onClick={p1IconsVisible ? undefined : toggleP1}
        >
          <div style={{ visibility: p1IconsVisible ? 'visible' : 'hidden', height: '100%' }}>
            {p1Icons}
          </div>
          {!p1IconsVisible && <span className="panel-strip">›</span>}
        </div>

        {/* p1-list: 可折叠 200px */}
        <div className={`panel panel--p1-list${p1ListVisible ? '' : ' panel--p1-list-collapsed'}`}>
          <div className="panel-inner">
            {p1List}
          </div>
        </div>

        <div
          className={`panel panel--p2${p2Visible ? '' : ' panel--collapsed'}`}
          style={p2Visible ? { width: p2Width } : undefined}
          onClick={p2Visible ? undefined : toggleP2}
        >
          <div className="panel-inner" style={{ visibility: p2Visible ? 'visible' : 'hidden' }}>
            {p2}
          </div>
          {!p2Visible && <span className="panel-strip">›</span>}
          {p2Visible && (
            <>
              <button
                className="panel-toggle-btn"
                onClick={(e) => { e.stopPropagation(); toggleP2() }}
                title="折叠"
              >‹</button>
              <div className="panel-resize-handle" onMouseDown={onResizeStart} />
            </>
          )}
        </div>

        <div className="panel panel--p3">{p3}</div>

        <div
          className={`panel panel--p4${p4Visible ? '' : ' panel--collapsed'}`}
          onClick={p4Visible ? undefined : toggleP4}
        >
          {/* 始终保留 DOM，collapsed 时 visibility:hidden 保留 state */}
          <div className="panel-inner" style={{ visibility: p4Visible ? 'visible' : 'hidden' }}>
            {p4}
          </div>
          {!p4Visible && <span className="panel-strip">‹</span>}
          {p4Visible && (
            <button
              className="panel-toggle-btn"
              onClick={(e) => { e.stopPropagation(); toggleP4() }}
              title="折叠"
            >›</button>
          )}
        </div>
      </div>
    </div>
  )
}
