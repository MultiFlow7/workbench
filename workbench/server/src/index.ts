import Fastify from 'fastify'
import { createServer } from 'node:http'
import { registerSessionsApi } from './http/sessionsApi.js'
import { createWsServer } from './ws/agentSocket.js'
import { persistence } from './persistence/sqlite.js'

const PORT = parseInt(process.env.PORT ?? '3001', 10)

async function main(): Promise<void> {
  // 崩溃恢复：标记未完成的 sessions
  persistence.recoverStaleSessions()

  const app = Fastify({ logger: true })
  const server = app.server

  await registerSessionsApi(app)
  createWsServer(server)

  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`Workbench server listening on :${PORT}`)
}

main().catch(console.error)
