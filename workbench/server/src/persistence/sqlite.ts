import Database from 'better-sqlite3'
import * as path from 'node:path'
import * as fs from 'node:fs'

const DB_DIR = process.env.WORKBENCH_DATA_DIR ?? '/var/lib/workbench-agent'
const DB_PATH = path.join(DB_DIR, 'sessions.db')

// 开发模式（非 production）使用本地路径
const resolvedPath = process.env.NODE_ENV === 'production'
  ? DB_PATH
  : path.join(process.cwd(), 'data', 'sessions.db')

// 确保目录存在
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })

export const db = new Database(resolvedPath)

// WAL 模式 + 建表
db.exec(`
  PRAGMA journal_mode=WAL;

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    nodeId TEXT NOT NULL,
    status TEXT NOT NULL,
    startedAt TEXT NOT NULL,
    completedAt TEXT,
    lastEventAt TEXT NOT NULL,
    tokenUsage TEXT,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId TEXT NOT NULL,
    eventName TEXT NOT NULL,
    payload TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (sessionId) REFERENCES sessions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_events_session ON events(sessionId, id);
`)

// Prepared statements
const stmts = {
  insertSession: db.prepare(
    `INSERT INTO sessions (id, nodeId, status, startedAt, lastEventAt)
     VALUES (@id, @nodeId, @status, @startedAt, @lastEventAt)`
  ),
  updateSessionStatus: db.prepare(
    `UPDATE sessions SET status=@status, completedAt=@completedAt, error=@error WHERE id=@id`
  ),
  updateSessionLastEvent: db.prepare(
    `UPDATE sessions SET lastEventAt=@lastEventAt, tokenUsage=@tokenUsage WHERE id=@id`
  ),
  insertEvent: db.prepare(
    `INSERT INTO events (sessionId, eventName, payload, createdAt)
     VALUES (@sessionId, @eventName, @payload, @createdAt)`
  ),
  getSession: db.prepare(`SELECT * FROM sessions WHERE id=?`),
  listSessions: db.prepare(`SELECT * FROM sessions ORDER BY startedAt DESC LIMIT 100`),
  getEventsSince: db.prepare(
    `SELECT * FROM events WHERE sessionId=? AND id>? ORDER BY id ASC`
  ),
  getStaleRunningSessions: db.prepare(
    `SELECT id FROM sessions WHERE status='running'`
  ),
  hasResultEvent: db.prepare(
    `SELECT id FROM events WHERE sessionId=? AND eventName='result' LIMIT 1`
  ),
}

export interface SessionRow {
  id: string; nodeId: string; status: string; startedAt: string
  completedAt: string | null; lastEventAt: string
  tokenUsage: string | null; error: string | null
}

export interface EventRow {
  id: number; sessionId: string; eventName: string
  payload: string; createdAt: string
}

export const persistence = {
  createSession(id: string, nodeId: string): void {
    const now = new Date().toISOString()
    stmts.insertSession.run({ id, nodeId, status: 'running', startedAt: now, lastEventAt: now })
  },
  appendEvent(sessionId: string, eventName: string, payload: unknown): void {
    stmts.insertEvent.run({
      sessionId, eventName,
      payload: JSON.stringify(payload),
      createdAt: new Date().toISOString(),
    })
  },
  completeSession(id: string, error?: string): void {
    stmts.updateSessionStatus.run({
      id, status: error ? 'failed' : 'done',
      completedAt: new Date().toISOString(),
      error: error ?? null,
    })
  },
  updateHeartbeat(id: string, tokenUsage?: { in: number; out: number; cache: number }): void {
    stmts.updateSessionLastEvent.run({
      id, lastEventAt: new Date().toISOString(),
      tokenUsage: tokenUsage ? JSON.stringify(tokenUsage) : null,
    })
  },
  getSession(id: string): SessionRow | undefined {
    return stmts.getSession.get(id) as SessionRow | undefined
  },
  listSessions(): SessionRow[] {
    return stmts.listSessions.all() as SessionRow[]
  },
  getEventsSince(sessionId: string, since: number): EventRow[] {
    return stmts.getEventsSince.all(sessionId, since) as EventRow[]
  },
  recoverStaleSessions(): void {
    const stale = stmts.getStaleRunningSessions.all() as Array<{ id: string }>
    for (const { id } of stale) {
      const hasResult = stmts.hasResultEvent.get(id)
      stmts.updateSessionStatus.run({
        id,
        status: hasResult ? 'done' : 'failed',
        completedAt: new Date().toISOString(),
        error: hasResult ? null : 'Server crashed during execution',
      })
    }
  },
}
