import { useState } from 'react'
import { useStore } from '../../store'
import { initServerConnection, disconnectServer } from '../../lib/serverHeartbeat'
import './ServerConfig.css'

export function ServerConfig() {
  const { serverUrl, serverToken, serverStatus, serverLastError, setServerConfig } = useStore()
  const [url, setUrl] = useState(serverUrl)
  const [token, setToken] = useState(serverToken)

  const statusColor = {
    offline: 'var(--err)',
    connecting: 'var(--pause)',
    online: 'var(--done)',
  }[serverStatus]

  const statusLabel = {
    offline: '离线',
    connecting: '连接中...',
    online: '已连接',
  }[serverStatus]

  const handleSave = () => {
    setServerConfig(url.trim(), token.trim())
    disconnectServer()
    if (url.trim()) {
      setTimeout(initServerConnection, 100)
    }
  }

  return (
    <div className="server-config">
      <h3 className="server-config__title">服务器配置</h3>

      <div className="server-config__status">
        <span className="server-config__status-dot" style={{ background: statusColor }} />
        <span className="server-config__status-label" style={{ color: statusColor }}>{statusLabel}</span>
        {serverLastError && (
          <span className="server-config__error">{serverLastError}</span>
        )}
      </div>

      <label className="server-config__label">
        WebSocket 地址
        <input
          className="server-config__input"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="ws://your-server:3001/ws/agent"
        />
      </label>

      <label className="server-config__label">
        Bearer Token
        <input
          className="server-config__input"
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="your-server-token"
        />
      </label>

      <div className="server-config__actions">
        <button className="server-config__btn" onClick={handleSave}>
          保存并重连
        </button>
        {serverStatus === 'online' && (
          <button className="server-config__btn server-config__btn--disconnect" onClick={disconnectServer}>
            断开连接
          </button>
        )}
      </div>
    </div>
  )
}
