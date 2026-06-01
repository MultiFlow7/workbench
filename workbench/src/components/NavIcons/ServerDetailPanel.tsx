/**
 * ServerDetailPanel · v0.15.1 节点 3.2
 *
 * 服务器详情 overlay 弹窗。
 * 复用 SettingsPanel 的 overlay 壳样式（settings-overlay / settings-panel）。
 *
 * 内容：
 *   - 标题「服务器详情」
 *   - 服务器地址：serverUrl（mono 字体灰色小字）
 *   - 连接状态：在线 / 离线 / 连接中 / 未配置（与按钮颜色对应）
 *   - 延迟：「--」（v0.15 未采集 ping，留 TODO）
 *   - 「修改配置」入口：直接挂载 v0.15 已有的 <ServerConfig />
 *
 * 验证锚点：T-V151-C2（overlay + <ServerConfig> 同时出现）
 */

import { useStore } from '../../store'
import { ServerConfig } from '../ServerConfig/ServerConfig'

interface ServerDetailPanelProps {
  onClose: () => void
}

export function ServerDetailPanel({ onClose }: ServerDetailPanelProps) {
  const serverUrl = useStore((s) => s.serverUrl)
  const serverStatus = useStore((s) => s.serverStatus)

  const visualState: 'online' | 'offline' | 'connecting' | 'unconfigured' =
    serverUrl.trim() === '' ? 'unconfigured' : serverStatus

  const statusLabel = {
    online: '在线',
    offline: '离线',
    connecting: '连接中',
    unconfigured: '未配置',
  }[visualState]

  const statusColorVar = {
    online: 'var(--done)',
    offline: 'var(--err)',
    connecting: 'var(--pause)',
    unconfigured: 'var(--text-3)',
  }[visualState]

  return (
    <div className="settings-overlay" onClick={onClose} data-v151-node="3.2">
      <div className="settings-panel server-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel__header">
          <span className="settings-panel__title">服务器详情</span>
          <button className="settings-panel__close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="settings-panel__section">
          <div className="settings-panel__label">服务器地址</div>
          <div className="server-detail-panel__url">
            {serverUrl.trim() === '' ? '（未配置）' : serverUrl}
          </div>
        </div>

        <div className="settings-panel__section">
          <div className="settings-panel__label">连接状态</div>
          <div className="server-detail-panel__status">
            <span
              className="server-detail-panel__status-dot"
              style={{ background: statusColorVar }}
            />
            <span style={{ color: statusColorVar }}>{statusLabel}</span>
          </div>
        </div>

        <div className="settings-panel__section">
          <div className="settings-panel__label">延迟</div>
          {/* v0.15.1 不采集 ping，统一占位「--」，留待后续版本接入 */}
          <div className="server-detail-panel__latency">--</div>
        </div>

        <div className="settings-panel__section">
          {/* 复用 v0.15 节点 6.3 已建的完整服务器配置 UI */}
          <ServerConfig />
        </div>
      </div>
    </div>
  )
}
