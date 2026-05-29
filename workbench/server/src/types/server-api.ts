// schema 锁定：v0.15 → v0.16 API 合约，变更需走 review

export interface SessionSummary {
  id: string
  nodeId: string
  status: 'running' | 'done' | 'failed' | 'paused'
  startedAt: string
  completedAt?: string
  lastEventAt: string
  tokenUsage?: { in: number; out: number; cache: number }
  error?: string
}

export interface SessionsResponse {
  sessions: SessionSummary[]
}

export interface ReplayEvent {
  id: number
  eventName: string
  payload: unknown
  createdAt: string
}

export interface ReplayResponse {
  events: ReplayEvent[]
}
