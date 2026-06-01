/**
 * ServerStatusButton.test.tsx · v0.15.1 节点 4.1
 *
 * 覆盖四态颜色映射（online / offline / connecting / unconfigured）。
 * useStore 在 SSR 模式下走 server snapshot，使用 vi.mock 驱动不同 (serverStatus, serverUrl) 组合。
 *
 * 验证锚点：T-V151-C1（className 含 --online / --offline / --connecting / --unconfigured）
 */

import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

const mockState = {
  serverStatus: 'online' as 'online' | 'offline' | 'connecting',
  serverUrl: 'ws://localhost:8081',
}

vi.mock('../../../store', () => ({
  useStore: <T,>(selector: (s: typeof mockState) => T) => selector(mockState),
}))

import { ServerStatusButton } from '../ServerStatusButton'

describe('ServerStatusButton · 四态颜色映射', () => {
  it('online → server-status-btn--online', () => {
    mockState.serverStatus = 'online'
    mockState.serverUrl = 'ws://localhost:8081'
    const html = renderToString(<ServerStatusButton onClick={() => {}} />)
    expect(html.includes('server-status-btn--online')).toBe(true)
    expect(html.includes('aria-label="服务器在线"')).toBe(true)
  })

  it('offline → server-status-btn--offline', () => {
    mockState.serverStatus = 'offline'
    mockState.serverUrl = 'ws://localhost:8081'
    const html = renderToString(<ServerStatusButton onClick={() => {}} />)
    expect(html.includes('server-status-btn--offline')).toBe(true)
    expect(html.includes('aria-label="服务器离线"')).toBe(true)
  })

  it('connecting → server-status-btn--connecting', () => {
    mockState.serverStatus = 'connecting'
    mockState.serverUrl = 'ws://localhost:8081'
    const html = renderToString(<ServerStatusButton onClick={() => {}} />)
    expect(html.includes('server-status-btn--connecting')).toBe(true)
    expect(html.includes('aria-label="服务器连接中…"')).toBe(true)
  })

  it('unconfigured（serverUrl="" 优先于 status）→ --unconfigured', () => {
    mockState.serverStatus = 'online'  // 即使 status=online，URL 为空也视作 unconfigured
    mockState.serverUrl = ''
    const html = renderToString(<ServerStatusButton onClick={() => {}} />)
    expect(html.includes('server-status-btn--unconfigured')).toBe(true)
    expect(html.includes('aria-label="服务器未配置"')).toBe(true)
  })
})
