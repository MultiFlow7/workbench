import { useStore } from '../store'

let _ws: WebSocket | null = null
let _pingTimer: ReturnType<typeof setInterval> | null = null
let _pongTimeout: ReturnType<typeof setTimeout> | null = null
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _reconnectAttempt = 0
let _pongMissed = 0
const MAX_RECONNECTS = 10
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000]

export function initServerConnection(): void {
  const { serverUrl, serverToken } = useStore.getState()
  if (!serverUrl) return
  _connect(serverUrl, serverToken)
}

function _connect(url: string, _token: string): void {
  const store = useStore.getState()
  store.setServerStatus('connecting')

  _ws = new WebSocket(url)
  _ws.onopen = () => {
    _reconnectAttempt = 0
    useStore.getState().setServerStatus('online')
    useStore.getState().setServerLastError(null)
    _startPing()
  }

  _ws.onmessage = (ev) => {
    if (ev.data === 'pong') {
      clearTimeout(_pongTimeout!)
      _pongMissed = 0
    }
  }

  _ws.onclose = () => {
    _cleanup()
    const { serverUrl: u, serverToken: t } = useStore.getState()
    _scheduleReconnect(u, t)
  }

  _ws.onerror = () => {
    useStore.getState().setServerLastError('连接失败')
    useStore.getState().setServerStatus('offline')
  }
}

function _startPing(): void {
  _pingTimer = setInterval(() => {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return
    _ws.send('ping')
    _pongTimeout = setTimeout(() => {
      // 连续 2 次超时（10s 间隔 × 2 = 20s）
      if (_pongMissed >= 1) {
        _ws?.close()
        useStore.getState().setServerStatus('offline')
      }
      _pongMissed++
    }, 10000)
  }, 10000)
}

function _cleanup(): void {
  clearInterval(_pingTimer!)
  clearTimeout(_pongTimeout!)
  _pingTimer = null
  _pongTimeout = null
  _pongMissed = 0
}

function _scheduleReconnect(url: string, token: string): void {
  if (_reconnectAttempt >= MAX_RECONNECTS) {
    useStore.getState().setServerLastError('连接失败，已停止重试')
    return
  }
  const delay = RECONNECT_DELAYS[Math.min(_reconnectAttempt, RECONNECT_DELAYS.length - 1)]
  _reconnectAttempt++
  _reconnectTimer = setTimeout(() => _connect(url, token), delay)
}

export function disconnectServer(): void {
  clearTimeout(_reconnectTimer!)
  _cleanup()
  _ws?.close()
  _ws = null
  useStore.getState().setServerStatus('offline')
}
