import { persistence } from '../persistence/sqlite.js'

const _activeSessions = new Map<string, { in: number; out: number; cache: number }>()

export function trackSession(sessionId: string): void {
  _activeSessions.set(sessionId, { in: 0, out: 0, cache: 0 })
}

export function updateTokenUsage(sessionId: string, usage: { in: number; out: number; cache: number }): void {
  _activeSessions.set(sessionId, usage)
}

export function untrackSession(sessionId: string): void {
  _activeSessions.delete(sessionId)
}

// 5 秒心跳：更新 sessions.lastEventAt
setInterval(() => {
  for (const [id, usage] of _activeSessions) {
    persistence.updateHeartbeat(id, usage)
  }
}, 5000)
