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
  const {
    p1ListVisible,
    p2Visible,
    p4Visible,
    toggleP2,
    toggleP4,
    p1IconsVisible,
    toggleP1,
    p2Width,
    setP2Width,
  } = useStore()

  // Left region is fully collapsed when both p1Icons and p1List are hidden
  const leftCollapsed = !p1IconsVisible && !p1ListVisible

  const dragStartX = useRef(0)
  const dragStartW = useRef(0)

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
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
    },
    [p2Width, setP2Width]
  )

  return (
    <div className="app-shell">
      {/* TopBar */}
      <div className="app-shell__topbar">{topBar}</div>

      {/* Main content row */}
      <div className="app-shell__body">

        {/* Left region: ActivityBar (p1Icons) + P1 Nav (p1List) — collapses together */}
        <div
          className={`app-shell__left${leftCollapsed ? ' app-shell__left--collapsed' : ''}`}
          onClick={leftCollapsed ? toggleP1 : undefined}
        >
          {leftCollapsed ? (
            <div className="panel-strip-indicator">
              <span className="panel-strip-dot" />
            </div>
          ) : (
            <>
              {/* ActivityBar */}
              <div
                className={`panel panel--p1-icons${p1IconsVisible ? '' : ' panel--collapsed'}`}
              >
                <div
                  className="panel-inner"
                  style={{ visibility: p1IconsVisible ? 'visible' : 'hidden' }}
                >
                  {p1Icons}
                </div>
              </div>

              {/* P1 List */}
              <div
                className={`panel panel--p1-list${p1ListVisible ? '' : ' panel--p1-list-collapsed'}`}
              >
                <div className="panel-inner">{p1List}</div>
              </div>
            </>
          )}
        </div>

        {/* P2 */}
        <div
          className={`panel panel--p2${p2Visible ? '' : ' panel--collapsed'}`}
          style={p2Visible ? { width: p2Width } : undefined}
          onClick={p2Visible ? undefined : toggleP2}
        >
          <div
            className="panel-inner"
            style={{ visibility: p2Visible ? 'visible' : 'hidden' }}
          >
            {p2}
          </div>
          {!p2Visible && (
            <div className="panel-strip-indicator">
              <span className="panel-strip-dot" />
            </div>
          )}
          {p2Visible && (
            <>
              <button
                className="panel-toggle-btn panel-toggle-btn--p2"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleP2()
                }}
                title="折叠 P2"
              >
                ‹
              </button>
              <div className="panel-resize-handle" onMouseDown={onResizeStart} />
            </>
          )}
        </div>

        {/* P3 — main workspace */}
        <div className="panel panel--p3">{p3}</div>

        {/* P4 */}
        <div
          className={`panel panel--p4${p4Visible ? '' : ' panel--collapsed'}`}
          onClick={p4Visible ? undefined : toggleP4}
        >
          <div
            className="panel-inner"
            style={{ visibility: p4Visible ? 'visible' : 'hidden' }}
          >
            {p4}
          </div>
          {!p4Visible && (
            <div className="panel-strip-indicator">
              <span className="panel-strip-dot" />
            </div>
          )}
          {p4Visible && (
            <button
              className="panel-toggle-btn panel-toggle-btn--p4"
              onClick={(e) => {
                e.stopPropagation()
                toggleP4()
              }}
              title="折叠 P4"
            >
              ›
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
