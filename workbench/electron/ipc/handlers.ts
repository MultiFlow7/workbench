/**
 * IPC Handler 注册中心（v0.15 节点 1.3 + 1.4 + 1.5）
 *
 * 所有 ipcMain.handle('cmd', fn) 在此集中注册。
 * 节点 1.3: 实现完整 fs:* IPC 通道，含路径越界保护。
 * 节点 1.4: dialog:pickFolder + workspace:* + electron-store 持久化 cwd。
 * 节点 1.5: sidecar:status 暴露 Python ai-service 健康状态。
 *
 * 注意：本节点的 handler 实现是映射层——将来自 renderer 的调用
 * 转发给 Electron 内置 API 或本地 Node.js 模块。
 * Tauri 原有的 Rust 命令（如 stream_ai / list_tasks 等后台业务逻辑）
 * 在 Phase 2 之前以「noop / stub」形式占位，不抛错，返回空值，
 * 确保 renderer 可正常挂载而不崩溃。
 */

import { BrowserWindow, dialog, ipcMain } from 'electron'
import { join, resolve } from 'node:path'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import {
  assertInWorkspace,
  getWorkspaceCwd as _getWorkspaceCwd,
  setWorkspaceCwd as _setWorkspaceCwd,
} from './fsGuard'
import { getPersistedCwd, setPersistedCwd } from '../store/workspaceStore'
import {
  AI_SERVICE_BASE_URL,
  AI_SERVICE_PORT,
  isAiServiceReady,
} from '../sidecar/aiService'
import { LocalRunner } from '../sdk/LocalRunner'
import type { SDKOptions } from '../sdk/SDKBridge'

// ─── 工作区 cwd 状态（节点 1.4 已接入 electron-store 持久化）─────────────────
//
// 启动时优先从 electron-store 恢复持久化的 cwd；store 为空时保留 homedir 作为
// 安全占位（fsGuard 仍生效），由 main process 在 ready-to-show 后通过
// ensureWorkspaceCwd() 触发首次 dialog 让用户选择。

const persistedCwd = getPersistedCwd()
_setWorkspaceCwd(persistedCwd ?? os.homedir())

/**
 * 标记当前 cwd 是否来自持久化（vs 默认 homedir 占位）。
 * main process 在 ready-to-show 后据此决定是否弹出首次 dialog。
 */
export function hasPersistedWorkspaceCwd(): boolean {
  return persistedCwd !== null
}

/**
 * 获取当前工作目录（供 main/index.ts 或 dialog handler 使用）
 */
export const getWorkspaceCwd = _getWorkspaceCwd

/**
 * 设置工作目录（节点 1.4 dialog:pickFolder 调用后更新）
 */
export const setWorkspaceCwd = _setWorkspaceCwd

// ─── Agent Runner 状态（节点 2.1 / 2.6）──────────────────────────────────────
//
// 每个 BrowserWindow 对应一个活跃的 LocalRunner 实例。
// 简化版：单窗口场景用 Map 管理（webContentsId → runner）。

const _activeRunners = new Map<number, LocalRunner>()

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function stubOk(channel: string, returnValue: unknown = null) {
  ipcMain.handle(channel, () => returnValue)
}

function stubEmpty<T>(channel: string, empty: T) {
  ipcMain.handle(channel, () => empty)
}

// ─── 注册函数（由 main/index.ts 在 app.whenReady 后调用）────────────────────

export function registerIpcHandlers(): void {

  // ── hello-world ping（验证 IPC 通道完整性）──────────────────────────────
  ipcMain.handle('ping', () => 'pong from main')

  // ── sidecar:status（节点 1.5）─────────────────────────────────────────
  // renderer 查询 Python ai-service 是否就绪 + base URL + 端口。
  // 事件订阅（service-ready / service-error / service-exit）由 sidecar 模块
  // 在状态变更时自动广播；renderer 用 window.api.listen 订阅即可。
  ipcMain.handle('sidecar:status', () => ({
    ready: isAiServiceReady(),
    baseUrl: AI_SERVICE_BASE_URL,
    port: AI_SERVICE_PORT,
  }))

  // ── workspace:getCwd / setCwd（节点 1.4）──────────────────────────────
  // renderer 不直接访问 electron-store；通过 IPC 拿到当前 cwd（首屏初始化）。
  ipcMain.handle('workspace:getCwd', () => _getWorkspaceCwd())

  // setCwd 用于用户在 P1 顶部 picker 选定目录后写入。
  // 内部同时更新 fsGuard 内存值 + electron-store 持久化值。
  // 写入后向所有 BrowserWindow 广播 `workspace:changed` 事件，
  // 触发 renderer 重新加载工作区/对话列表（节点 4.2 P1 NavSection 订阅）。
  ipcMain.handle('workspace:setCwd', (_e, args: { cwd: string }) => {
    const normalized = resolve(args.cwd)
    _setWorkspaceCwd(normalized)
    setPersistedCwd(normalized)
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.send('workspace:changed', { cwd: normalized })
    })
    return normalized
  })

  // ── dialog:pickFolder（节点 1.4）──────────────────────────────────────
  // 弹出系统目录选择对话框。用户取消时返回 null；选定时返回绝对路径。
  // 注意：本 handler 不直接写入 cwd——renderer 拿到路径后再调
  // `workspace:setCwd`，这样 picker 组件可以在写入前做额外校验
  // （如目录是否包含 .obsidian、是否可读等）。
  ipcMain.handle('dialog:pickFolder', async () => {
    const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = focused
      ? await dialog.showOpenDialog(focused, {
          properties: ['openDirectory'],
          title: '选择工作目录',
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory'],
          title: '选择工作目录',
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ── fs:read — 读取文件内容（UTF-8 文本）─────────────────────────────────
  // args: { path: string }
  // returns: string（文件内容）
  ipcMain.handle('fs:read', async (_e, args: { path: string }) => {
    const safePath = assertInWorkspace(args.path)
    return fsp.readFile(safePath, 'utf-8')
  })

  // ── fs:write — 写入文件内容（原子写：tmp → rename）──────────────────────
  // args: { path: string; content: string }
  // returns: null
  ipcMain.handle('fs:write', async (_e, args: { path: string; content: string }) => {
    const safePath = assertInWorkspace(args.path)
    const tmpPath = `${safePath}.tmp-${process.pid}`
    await fsp.writeFile(tmpPath, args.content, 'utf-8')
    await fsp.rename(tmpPath, safePath)
    return null
  })

  // ── fs:list — 列举目录内容（非递归）────────────────────────────────────
  // args: { path: string }
  // returns: string[]（子项名称列表）
  ipcMain.handle('fs:list', async (_e, args: { path: string }) => {
    const safePath = assertInWorkspace(args.path)
    return fsp.readdir(safePath)
  })

  // ── fs:exists — 检查路径是否存在（无越界保护，仅供只读探测）─────────────
  // args: { path: string }
  // returns: boolean
  //
  // 设计说明：fs:exists 故意不做 workspace 校验——renderer 在生成新 atomId
  // 时需探测文件是否存在，路径由前端自行构造（来自 toFilePath 工具函数，
  // 已确保在工作区内）。若强制越界保护，generateNewAtomId 会因工作区
  // 未初始化而误抛 EPERM。
  ipcMain.handle('fs:exists', (_e, args: { path: string }) => {
    try {
      return fs.existsSync(resolve(args.path))
    } catch {
      return false
    }
  })

  // ── fs:mkdir — 创建目录（recursive）────────────────────────────────────
  // args: { path: string }
  // returns: null
  ipcMain.handle('fs:mkdir', async (_e, args: { path: string }) => {
    const safePath = assertInWorkspace(args.path)
    await fsp.mkdir(safePath, { recursive: true })
    return null
  })

  // ── 版本信息 ──────────────────────────────────────────────────────────────
  ipcMain.handle('get_version', () => '0.15.0-dev')

  // ── 事件日志（stub，Phase 6 持久化时接入 SQLite）────────────────────────
  ipcMain.handle('write_event_log', (_e, _args) => {
    // no-op stub：仅防止 renderer 报错
    return null
  })

  // ── 设置文件读写（stub，Phase 1.4 接入 electron-store）─────────────────
  // write_settings: args = { data: string }
  ipcMain.handle('write_settings', (_e, args: { data: string }) => {
    try {
      const settingsPath = join(os.homedir(), '.workbench', 'settings.json')
      fs.mkdirSync(join(os.homedir(), '.workbench'), { recursive: true })
      fs.writeFileSync(settingsPath, args.data, 'utf-8')
    } catch {
      // ignore write errors in dev
    }
    return null
  })

  // read_settings: returns JSON string
  ipcMain.handle('read_settings', () => {
    try {
      const settingsPath = join(os.homedir(), '.workbench', 'settings.json')
      if (fs.existsSync(settingsPath)) {
        return fs.readFileSync(settingsPath, 'utf-8')
      }
    } catch {
      // ignore read errors
    }
    return '{}'
  })

  // ── QA Atom 读写（stub，Phase 1.3 接入真实 fs IPC）─────────────────────
  // list_qa_atoms: returns QAAtomMeta[]
  stubEmpty('list_qa_atoms', [])

  // read_qa_atom: returns QAAtom object
  ipcMain.handle('read_qa_atom', (_e, args: { filePath: string }) => {
    try {
      if (fs.existsSync(args.filePath)) {
        const raw = fs.readFileSync(args.filePath, 'utf-8')
        // minimal parse: return raw content as answer
        return { meta: { id: '', prev: null, children: [], summary: '', timestamp: '' }, question: '', answer: raw }
      }
    } catch { /* ignore */ }
    return { meta: { id: '', prev: null, children: [], summary: '', timestamp: new Date().toISOString() }, question: '', answer: '' }
  })

  // write_qa_atom: args = { filePath: string, atom: object }
  ipcMain.handle('write_qa_atom', (_e, args: { filePath: string; atom: unknown }) => {
    void args
    return null
  })

  // ── 项目管理（stubs）─────────────────────────────────────────────────────
  stubEmpty('list_projects', [])
  ipcMain.handle('create_project', (_e, _args) => ({
    id: crypto.randomUUID(),
    name: '',
    rootBranchId: '',
    createdAt: new Date().toISOString(),
    atomIds: [],
  }))
  stubOk('add_atom_to_project')

  // ── 分支 ID 生成（stub）──────────────────────────────────────────────────
  ipcMain.handle('next_branch_id', () => {
    return String(Date.now()).slice(-4)
  })

  // ── AI 流式对话（原 stub 保留兼容，Phase 2 通过 agent:start/stop 接入）────
  stubOk('stream_ai')
  stubOk('cancel_stream')
  stubOk('execute_tool', '')

  // ── agent:start（节点 2.1 + 2.6）─────────────────────────────────────────
  // 创建 LocalRunner 实例（包装 SDKBridge），启动 Claude Code SDK。
  // args: { prompt: string; options?: SDKOptions }
  // 启动为异步后台任务，立即返回 null；进度事件通过 'agent:event' IPC 推送。
  ipcMain.handle(
    'agent:start',
    async (
      event,
      args: { prompt: string; options?: SDKOptions }
    ) => {
      const webContentsId = event.sender.id
      const win =
        BrowserWindow.fromWebContents(event.sender) ??
        BrowserWindow.getAllWindows()[0]

      if (!win) return { error: 'no BrowserWindow available' }

      // 若已有 runner，先停止
      const existing = _activeRunners.get(webContentsId)
      if (existing) {
        existing.stop()
        _activeRunners.delete(webContentsId)
      }

      const runner = new LocalRunner(win)
      _activeRunners.set(webContentsId, runner)

      // 异步启动，不 await（事件通过 IPC 推送到 renderer）
      runner
        .start(args.prompt, args.options ?? {})
        .catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err)
          if (!win.isDestroyed()) {
            win.webContents.send('agent:event', {
              type: 'error',
              message: errMsg,
            })
          }
        })
        .finally(() => {
          _activeRunners.delete(webContentsId)
        })

      return null
    }
  )

  // ── agent:stop（节点 2.1）────────────────────────────────────────────────
  // 取消当前正在执行的 agent。
  ipcMain.handle('agent:stop', (event) => {
    const webContentsId = event.sender.id
    const runner = _activeRunners.get(webContentsId)
    if (runner) {
      runner.stop()
      _activeRunners.delete(webContentsId)
    }
    return null
  })

  // ── 后端健康检查（stub）──────────────────────────────────────────────────
  ipcMain.handle('check_backend_health', () => false)

  // ── 后台 SSE 订阅（stub）─────────────────────────────────────────────────
  stubOk('start_backend_sse')
  stubOk('stop_backend_sse')

  // ── 决策系统（stubs）─────────────────────────────────────────────────────
  stubEmpty('list_decisions', [])
  stubOk('resolve_decision')

  // ── 任务系统（stubs）─────────────────────────────────────────────────────
  stubEmpty('list_tasks', [])
  stubOk('create_task')

  // ── 令牌管理（stubs）─────────────────────────────────────────────────────
  stubEmpty('list_capability_tokens', [])
  stubOk('create_capability_token')
  stubOk('revoke_capability_token')

  // ── 仪表盘 / 统计（stubs）────────────────────────────────────────────────
  stubEmpty('get_token_stats_from_gateway', [])
  ipcMain.handle('get_llm_stats', () => ({
    total_calls: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
  }))

}
