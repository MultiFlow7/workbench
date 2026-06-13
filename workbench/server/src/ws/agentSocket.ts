import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'node:http'
import { runSession } from '../sdk/runner.js'
import { persistence } from '../persistence/sqlite.js'
import { verifyBearerToken } from '../security/auth.js'

// 活跃客户端集合（用于广播）
const _clients = new Set<WebSocket>()

export function createWsServer(server: import('node:http').Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws/agent' })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // 认证
    const auth = req.headers['authorization']
    if (!verifyBearerToken(Array.isArray(auth) ? auth[0] : auth)) {
      ws.close(1008, 'Unauthorized')
      return
    }

    _clients.add(ws)

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>
        if (msg['type'] === 'agent:start') {
          const payload = msg['payload'] as Record<string, unknown>
          const sessionId = await runSession({
            prompt: String(payload['prompt'] ?? ''),
            nodeId: String(payload['nodeId'] ?? ''),
            maxTurns: payload['maxTurns'] as number | undefined,
          }, _clients)
          ws.send(JSON.stringify({ type: 'session:started', sessionId }))
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: String(err) }))
      }
    })

    ws.on('close', () => {
      _clients.delete(ws)
    })
  })

  return wss
}
