import type { FastifyInstance } from 'fastify'
import { persistence } from '../persistence/sqlite.js'
import { verifyBearerToken } from '../security/auth.js'

function authCheck(request: import('fastify').FastifyRequest): boolean {
  const auth = request.headers['authorization']
  return verifyBearerToken(Array.isArray(auth) ? auth[0] : auth)
}

export async function registerSessionsApi(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true, version: '0.15.0' }))

  app.get('/sessions', async (request, reply) => {
    if (!authCheck(request)) return reply.code(401).send({ error: 'Unauthorized' })
    const rows = persistence.listSessions()
    return {
      sessions: rows.map(r => ({
        id: r.id, nodeId: r.nodeId, status: r.status,
        startedAt: r.startedAt, completedAt: r.completedAt ?? undefined,
        lastEventAt: r.lastEventAt,
        tokenUsage: r.tokenUsage ? JSON.parse(r.tokenUsage) : undefined,
        error: r.error ?? undefined,
      }))
    }
  })

  app.get('/sessions/:id/replay', async (request, reply) => {
    if (!authCheck(request)) return reply.code(401).send({ error: 'Unauthorized' })
    const { id } = request.params as { id: string }
    const since = parseInt((request.query as Record<string, string>)['since'] ?? '0', 10)
    const events = persistence.getEventsSince(id, since)
    return {
      events: events.map(e => ({
        id: e.id, eventName: e.eventName,
        payload: JSON.parse(e.payload), createdAt: e.createdAt,
      }))
    }
  })
}
