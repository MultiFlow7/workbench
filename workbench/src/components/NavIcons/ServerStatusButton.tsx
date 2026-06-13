/**
 * ServerStatusButton · v0.15.1 节点 3.1
 *
 * ActivityBar 顶部独立服务器状态按钮。
 * 取代 r1 实现里 nav-icons__bottom 中的 `.status-pill.server`（硬编码"在线"文案）。
 *
 * 四态映射（serverStatus + serverUrl 派生）：
 *   - online      → 绿点（var(--done)）
 *   - offline     → 红点（var(--err)）
 *   - connecting  → 黄点 + 脉冲（var(--pause)）
 *   - unconfigured（serverUrl === ''）→ 灰点（var(--text-3)）
 *
 * 验证锚点：T-V151-C1（className 含 --online / --offline / --connecting / --unconfigured）
 */

import { useStore } from '../../store'

interface ServerStatusButtonProps {
  onClick: () => void
}

export function ServerStatusButton({ onClick }: ServerStatusButtonProps) {
  const serverStatus = useStore((s) => s.serverStatus)
  const serverUrl = useStore((s) => s.serverUrl)

  // 「未配置」优先于 status：URL 为空时不论 status 如何都视作未配置
  const visualState: 'online' | 'offline' | 'connecting' | 'unconfigured' =
    serverUrl.trim() === '' ? 'unconfigured' : serverStatus

  const labelMap = {
    online: '服务器在线',
    offline: '服务器离线',
    connecting: '服务器连接中…',
    unconfigured: '服务器未配置',
  } as const

  return (
    <button
      className={`nav-icon-btn server-status-btn server-status-btn--${visualState}`}
      onClick={onClick}
      title={labelMap[visualState]}
      aria-label={labelMap[visualState]}
      data-v151-node="3.1"
    >
      <span className={`server-status-btn__dot server-status-btn__dot--${visualState}`} />
    </button>
  )
}
