/**
 * v0.15 节点 1.1 临时 renderer 入口（占位）
 *
 * 仅渲染骨架就绪指示。
 *
 * 演进路径：
 *  - 节点 1.2 完成 IPC 通道替换后，切回 src/main.tsx 作为入口
 *  - 此文件届时删除
 */

import React from 'react'
import ReactDOM from 'react-dom/client'

declare global {
  interface Window {
    api?: {
      version: string
      ping: () => string
    }
  }
}

function Skeleton() {
  const api = typeof window !== 'undefined' ? window.api : undefined
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
        background: '#f5f5f5',
        color: '#27272a',
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 600 }}>工作台 v0.15</div>
      <div style={{ fontSize: 13, color: '#71717a' }}>
        Electron 骨架就绪 · 节点 1.1
      </div>
      <div
        style={{
          fontSize: 12,
          color: api ? '#16a34a' : '#dc2626',
          fontFamily: '"JetBrains Mono", "SF Mono", monospace',
        }}
      >
        window.api: {api ? `ok (v${api.version}, ping=${api.ping()})` : 'missing'}
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Skeleton />
  </React.StrictMode>,
)
