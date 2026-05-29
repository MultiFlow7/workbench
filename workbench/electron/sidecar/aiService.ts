/**
 * Python ai-service sidecar 管理（v0.15 节点 1.5）
 *
 * 职责：
 *  - 通过 child_process.spawn 启动 Python ai-service
 *  - 固定监听 127.0.0.1:8765（与 sub2api :8080 / API Layer :8000 错开）
 *  - 启动后轮询 GET /health 直到 200，再向 renderer 广播 service-ready
 *  - 应用退出时 SIGTERM 清理子进程
 *
 * 路径策略：
 *  - 开发模式：ai-service 在工作台仓库根 `ai-service/` 目录（相对 workbench/ 上一级）
 *  - 生产模式：electron-builder 配置 asarUnpack: ['ai-service/**']，运行时位于
 *    `process.resourcesPath/app.asar.unpacked/ai-service/`
 *
 * 端点契约（节点 1.5 仅需 /health；节点 2.4 实现 POST /v1/messages）：
 *  - GET  /health        → { status: 'ok', version: string }
 *  - POST /v1/messages   → Anthropic 兼容 SSE 流（节点 2.4）
 */

import { spawn, ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, BrowserWindow } from 'electron'
import * as http from 'node:http'

export const AI_SERVICE_HOST = '127.0.0.1'
export const AI_SERVICE_PORT = 8765
export const AI_SERVICE_BASE_URL = `http://${AI_SERVICE_HOST}:${AI_SERVICE_PORT}`

/**
 * 健康探测超时（毫秒）。
 * 完成标志要求"6 秒内含 Python 解释器启动 + asar unpack 路径解析开销"内就绪，
 * 这里取 30s 上限避免冷启动慢的极端环境直接 fail。
 */
const HEALTH_PROBE_TIMEOUT_MS = 30_000
const HEALTH_PROBE_INTERVAL_MS = 250

let _childProcess: ChildProcess | null = null
let _serviceReady = false

/**
 * 解析 ai-service 目录路径。
 * - 开发：`<workbench>/../ai-service`
 * - 生产：`<resourcesPath>/app.asar.unpacked/ai-service`
 */
function resolveAiServiceDir(): string {
  if (app.isPackaged) {
    // electron-builder 解压后位置
    return join(process.resourcesPath, 'app.asar.unpacked', 'ai-service')
  }
  // 开发：从 electron/sidecar/ 出发往上找 workbench/ 再往上找 ai-service/
  // __dirname 在 electron-vite dev 模式下指向 out/main/，回退两级到 workbench/
  // 再回退一级到工作台根目录
  const workbenchRoot = resolve(__dirname, '..', '..')
  return join(workbenchRoot, '..', 'ai-service')
}

/**
 * 解析 Python 可执行文件路径。
 * - 开发：优先用 `python3`（PATH）
 * - 生产：electron-builder 打包 python-runtime/ 与 ai-service/ 平级
 *   （后续 v0.15.0-rc 阶段提供 python-runtime/ 内嵌 Python；本节点仅占位读取，
 *   缺失时 fallback 到 `python3`）
 */
function resolvePythonExecutable(): string {
  if (app.isPackaged) {
    const candidate =
      process.platform === 'win32'
        ? join(process.resourcesPath, 'app.asar.unpacked', 'python-runtime', 'python.exe')
        : join(process.resourcesPath, 'app.asar.unpacked', 'python-runtime', 'bin', 'python3')
    if (existsSync(candidate)) return candidate
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

/**
 * 探测 ai-service /health 直至 200 或超时。
 */
async function probeHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolveProbe) => {
      const req = http.get(
        {
          hostname: AI_SERVICE_HOST,
          port: AI_SERVICE_PORT,
          path: '/health',
          timeout: 1_000,
          // 显式禁用代理：sidecar 永远是本机回环连接
          agent: false,
        },
        (res) => {
          res.resume() // 排空 body
          resolveProbe(res.statusCode === 200)
        }
      )
      req.on('error', () => resolveProbe(false))
      req.on('timeout', () => {
        req.destroy()
        resolveProbe(false)
      })
    })
    if (ok) return true
    await new Promise((r) => setTimeout(r, HEALTH_PROBE_INTERVAL_MS))
  }
  return false
}

/**
 * 启动 Python ai-service sidecar。
 *
 * @returns 服务就绪 Promise（resolve true 表示 /health 返回 200，false 表示超时）
 */
export async function startAiService(): Promise<boolean> {
  if (_childProcess && !_childProcess.killed) {
    // 已启动，直接返回当前 ready 状态
    return _serviceReady
  }

  const cwd = resolveAiServiceDir()
  if (!existsSync(cwd)) {
    console.error(`[ai-service] directory not found: ${cwd}`)
    return false
  }

  const pythonExec = resolvePythonExecutable()
  const args = [
    '-m',
    'uvicorn',
    'main:app',
    '--host',
    AI_SERVICE_HOST,
    '--port',
    String(AI_SERVICE_PORT),
    '--log-level',
    'warning',
  ]

  console.log(`[ai-service] spawn ${pythonExec} ${args.join(' ')} (cwd=${cwd})`)

  _childProcess = spawn(pythonExec, args, {
    cwd,
    env: {
      ...process.env,
      PORT: String(AI_SERVICE_PORT),
      HOST: AI_SERVICE_HOST,
      // 避免 .pyc 文件污染 asar unpack 目录
      PYTHONDONTWRITEBYTECODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  _childProcess.stdout?.on('data', (chunk) => {
    process.stdout.write(`[ai-service] ${chunk}`)
  })
  _childProcess.stderr?.on('data', (chunk) => {
    process.stderr.write(`[ai-service] ${chunk}`)
  })
  _childProcess.on('exit', (code, signal) => {
    console.log(`[ai-service] exited code=${code} signal=${signal}`)
    _serviceReady = false
    _childProcess = null
    broadcastServiceEvent('service-exit', { code, signal })
  })
  _childProcess.on('error', (err) => {
    console.error('[ai-service] spawn error:', err)
    _serviceReady = false
  })

  const ok = await probeHealth(HEALTH_PROBE_TIMEOUT_MS)
  _serviceReady = ok
  if (ok) {
    broadcastServiceEvent('service-ready', {
      baseUrl: AI_SERVICE_BASE_URL,
      port: AI_SERVICE_PORT,
    })
  } else {
    console.error(
      `[ai-service] health probe timed out after ${HEALTH_PROBE_TIMEOUT_MS}ms`
    )
    broadcastServiceEvent('service-error', {
      reason: 'health-probe-timeout',
      timeoutMs: HEALTH_PROBE_TIMEOUT_MS,
    })
  }
  return ok
}

/**
 * 停止 sidecar 进程（应用退出前调用）。
 */
export function stopAiService(): void {
  if (!_childProcess) return
  try {
    if (process.platform === 'win32') {
      // Windows: tree-kill 行为由 spawn 隐式 detached=false 保证子进程随 parent 结束
      _childProcess.kill()
    } else {
      _childProcess.kill('SIGTERM')
      // 兜底：1.5s 后仍未退出则 SIGKILL
      const child = _childProcess
      setTimeout(() => {
        if (child && !child.killed) {
          child.kill('SIGKILL')
        }
      }, 1_500)
    }
  } catch (err) {
    console.error('[ai-service] stop error:', err)
  }
  _childProcess = null
  _serviceReady = false
}

export function isAiServiceReady(): boolean {
  return _serviceReady
}

/**
 * 向所有 BrowserWindow 广播 sidecar 事件。
 * renderer 通过 window.api.listen('service-ready' | 'service-error' | 'service-exit', cb) 订阅。
 */
function broadcastServiceEvent(
  channel: 'service-ready' | 'service-error' | 'service-exit',
  payload: unknown
): void {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) {
      w.webContents.send(channel, payload)
    }
  })
}
