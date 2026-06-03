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
import { createRunner } from '../sdk/runnerFactory'
import type { ServerConfig } from '../sdk/RemoteRunner'
import type { AgentRunner } from '../sdk/AgentRunner'
import { readApiKeysFromDisk, findKeyForModel } from '../store/settingsKeys'

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

const _activeRunners = new Map<number, AgentRunner>()

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

  // ── QA Atom 读写 ─────────────────────────────────────────────────────────
  // list_qa_atoms: 扫描 conversationDir，atom ID = 文件名（无 .md 后缀）
  ipcMain.handle('list_qa_atoms', async (_e, args: { conversationDir: string }) => {
    const dir = args?.conversationDir
    if (!dir) return []
    try {
      const files = await fsp.readdir(dir).catch(() => [] as string[])
      const atoms: unknown[] = []
      for (const file of files) {
        if (!file.endsWith('.md')) continue
        try {
          const raw = await fsp.readFile(join(dir, file), 'utf-8')
          const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
          if (!fmMatch) continue
          const fm = fmMatch[1]

          // atom ID = 完整文件名（无后缀），与 children/prev 的 [[xxx]] 引用保持一致
          const atomId = file.replace(/\.md$/, '')

          // 单行字段读取（去引号）
          const scalar = (key: string) => {
            const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
            return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : undefined
          }

          const timestamp = scalar('timestamp') ?? ''
          const model = scalar('model')

          // prev：YAML null → null；Obsidian link 保留原始字符串（selectAtom 会 strip [[]]）
          const prevRaw = scalar('prev')
          const prev = (!prevRaw || prevRaw === 'null') ? null : prevRaw

          // children：支持多行列表和单行 [] 两种格式
          const childrenMulti = [...fm.matchAll(/^\s+-\s+"?(\[\[[^\]]+\]\])"?/gm)].map((m) => m[1])
          let children: string[] = childrenMulti
          if (children.length === 0) {
            const inlinePart = fm.match(/^children:\s*\[([^\]]*)\]/m)
            if (inlinePart) {
              children = inlinePart[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
            }
          }
          // 只保留 children 中真正属于 children: 块的条目（排除 projects: 块）
          const childrenBlock = fm.match(/^children:\s*\n((?:\s+-\s+.+\n?)*)/m)
          if (childrenBlock) {
            children = [...childrenBlock[1].matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => `[[${m[1]}]]`)
          }

          // summary from ## Q, aPreview from ## A
          const fileSections = ('\n' + raw).split(/\n## /)
          const qPart = fileSections.find((p) => /^Q[\s\r\n]/.test(p))
          const aPart = fileSections.find((p) => /^A[\s\r\n]/.test(p))
          const summary = qPart
            ? qPart.split('\n').slice(1).map((l) => l.trim()).find((l) => l.length > 0)?.slice(0, 80) ?? ''
            : ''
          const aPreview = aPart
            ? aPart.split('\n').slice(1).map((l) => l.trim()).find((l) => l.length > 0)?.slice(0, 80) ?? ''
            : ''

          atoms.push({ id: atomId, prev, children, summary, aPreview, timestamp, model })
        } catch { /* skip bad file */ }
      }
      return atoms
    } catch { return [] }
  })

  // read_qa_atom: returns QAAtom object（meta + question + answer 全字段解析）
  // v0.15.1 P3 验收修订（2026-06-03，r10）：原 stub 把整文件塞进 answer、meta 全空，
  // 导致 DetailPanel 渲染空 id / Invalid Date / 整 markdown 作为 answer；
  // ChatViewV2 仅"巧合"工作（因为 parseAtom 能处理带 frontmatter 的整文件）。
  // 改为镜像 src-tauri/src/commands/qa_atoms.rs::read_qa_atom：
  //   - frontmatter 提取 id / prev / children / timestamp / summary / model / usage / context_*
  //   - body 提取 ## Q / ## A 内容（## Steps / ## Intervention 由 renderer 端 parseAtom 处理）
  ipcMain.handle('read_qa_atom', (_e, args: { filePath: string }) => {
    const emptyResp = () => ({
      meta: { id: '', prev: null, children: [], summary: '', timestamp: new Date().toISOString() },
      question: '',
      answer: '',
      raw: '',
    })
    try {
      if (!fs.existsSync(args.filePath)) return emptyResp()
      const raw = fs.readFileSync(args.filePath, 'utf-8')
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (!fmMatch) return { ...emptyResp(), answer: raw, raw }
      const fm = fmMatch[1]

      const fileId = args.filePath.replace(/^.*[\\/]/, '').replace(/\.md$/, '')
      const scalar = (key: string): string | undefined => {
        const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
        return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : undefined
      }
      const num = (key: string): number | undefined => {
        const v = scalar(key)
        if (v === undefined) return undefined
        const n = parseInt(v, 10)
        return Number.isFinite(n) ? n : undefined
      }
      const id = scalar('id') ?? fileId
      const timestamp = scalar('timestamp') ?? ''
      const prevRaw = scalar('prev')
      const prev = (!prevRaw || prevRaw === 'null') ? null : prevRaw
      const model = scalar('model')
      const inputTokens = num('input_tokens')
      const outputTokens = num('output_tokens')
      const contextTokensUsed = num('context_tokens_used')
      const contextWindowLimit = num('context_window_limit')

      // children：与 list_qa_atoms 同款解析（多行 - "[[xxx]]" 块优先，回退 inline []）
      let children: string[] = []
      const childrenBlock = fm.match(/^children:\s*\n((?:\s+-\s+.+\n?)*)/m)
      if (childrenBlock) {
        children = [...childrenBlock[1].matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => `[[${m[1]}]]`)
      } else {
        const inlinePart = fm.match(/^children:\s*\[([^\]]*)\]/m)
        if (inlinePart) {
          children = inlinePart[1]
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean)
        }
      }

      // body：按 ## 顶层切片提取 Q / A
      const bodyStart = fmMatch[0].length
      const body = raw.slice(bodyStart).replace(/^\s*\n/, '')
      const extractSection = (header: 'Q' | 'A'): string => {
        const re = new RegExp(`(?:^|\\n)## ${header}\\s*\\n([\\s\\S]*?)(?=\\n## [A-Za-z\\u4e00-\\u9fa5]|$)`)
        const m = body.match(re)
        return m ? m[1].trim() : ''
      }
      const question = extractSection('Q')
      const answer = extractSection('A')
      const summary = scalar('summary') ?? question.slice(0, 50)

      const usage = (inputTokens !== undefined && outputTokens !== undefined)
        ? { input_tokens: inputTokens, output_tokens: outputTokens }
        : undefined

      return {
        meta: {
          id,
          prev,
          children,
          summary,
          timestamp,
          ...(model ? { model } : {}),
          ...(usage ? { usage } : {}),
          ...(contextTokensUsed !== undefined ? { context_tokens_used: contextTokensUsed } : {}),
          ...(contextWindowLimit !== undefined ? { context_window_limit: contextWindowLimit } : {}),
        },
        question,
        answer,
        // raw: 完整文件内容（含 frontmatter），供 renderer 端 parseAtom 解析 ## Steps / ## Intervention
        raw,
      }
    } catch { /* ignore */ }
    return emptyResp()
  })

  // write_qa_atom: args = { filePath: string, atom: object }
  // v0.15.1 P2 验收修订（2026-06-02）：原 noop stub 导致新对话不落盘 → 重新打开看不到历史。
  // 实现与 src-tauri/src/commands/qa_atoms.rs::write_qa_atom 等效的原子写入。
  ipcMain.handle('write_qa_atom', async (_e, args: { filePath: string; atom: {
    meta: {
      id: string
      prev: string | null
      children: string[]
      summary?: string
      timestamp: string
      model?: string
      usage?: { input_tokens: number; output_tokens: number }
      context_tokens_used?: number
      context_window_limit?: number
    }
    question: string
    answer: string
  } }) => {
    const { filePath, atom } = args
    if (!filePath || !atom?.meta?.id) return null
    const prevYaml = atom.meta.prev ? `"${atom.meta.prev}"` : 'null'
    const childrenStr = atom.meta.children && atom.meta.children.length > 0
      ? `children:\n${atom.meta.children.map((c) => `  - "${c}"`).join('\n')}`
      : 'children: []'
    const tokenYaml = atom.meta.usage
      ? `model: "${atom.meta.model ?? ''}"\ninput_tokens: ${atom.meta.usage.input_tokens}\noutput_tokens: ${atom.meta.usage.output_tokens}\ncontext_tokens_used: ${atom.meta.context_tokens_used ?? 0}\ncontext_window_limit: ${atom.meta.context_window_limit ?? 0}\n`
      : ''
    const content = `---\nid: ${atom.meta.id}\nprev: ${prevYaml}\n${childrenStr}\ntimestamp: "${atom.meta.timestamp}"\n${tokenYaml}status: done\n---\n\n## Q\n\n${atom.question}\n\n## A\n\n${atom.answer}\n`
    // 原子写入：tmp → rename
    const tmpPath = `${filePath}.tmp`
    try {
      await fsp.writeFile(tmpPath, content, 'utf-8')
      await fsp.rename(tmpPath, filePath)
    } catch (e) {
      await fsp.unlink(tmpPath).catch(() => {})
      throw e
    }
    return null
  })

  // ── 项目管理 ──────────────────────────────────────────────────────────────
  // list_projects: 扫描 projectsDir 下 .md 文件，atomIds 从 ## 对话索引 提取
  ipcMain.handle('list_projects', async (_e, args: { projectsDir: string }) => {
    const dir = args?.projectsDir
    if (!dir) return []
    try {
      const files = await fsp.readdir(dir).catch(() => [] as string[])
      const projects: unknown[] = []
      for (const file of files) {
        if (!file.endsWith('.md')) continue
        try {
          const raw = await fsp.readFile(join(dir, file), 'utf-8')
          const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
          if (!fmMatch) continue
          const fm = fmMatch[1]

          const scalar = (key: string) => {
            const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
            return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : undefined
          }
          const id = scalar('id')
          if (!id) continue
          const name = scalar('name') ?? file.replace(/\.md$/, '')
          const rootBranchId = scalar('rootBranchId') ?? ''
          const createdAt = scalar('createdAt') ?? ''

          // atomIds: split by ## and find 对话索引 section, extract [[xxx]] refs
          const sectionParts = ('\n' + raw).split(/\n## /)
          const dialogPart = sectionParts.find((p) => p.startsWith('\u5bf9\u8bdd\u7d22\u5f15'))
          const atomIds = dialogPart
            ? [...dialogPart.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim())
            : []

          projects.push({ id, name, rootBranchId, createdAt, atomIds })
        } catch { /* skip bad file */ }
      }
      return projects
    } catch { return [] }
  })
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

  // ── AI 流式对话：v0.15.1 P4 r13 整体撤除 stream_ai / cancel_stream / execute_tool
  // 替代路径：agent:start / agent:stop / agent:pause / agent:resume + agent:event
  // 旧 IPC 名保留为显式 throw，防止 renderer 漏改后悄悄走 stubOk noop 黑洞
  ipcMain.handle('stream_ai', () => {
    throw new Error('stream_ai retired in v0.15.1 P4 — use window.api.agent.start()')
  })
  ipcMain.handle('cancel_stream', () => {
    throw new Error('cancel_stream retired in v0.15.1 P4 — use window.api.agent.stop()')
  })
  ipcMain.handle('execute_tool', () => {
    throw new Error('execute_tool retired in v0.15.1 P4 — tools handled by SDK directly')
  })

  // ── agent:start（节点 2.1 + 2.6 + 6.4，v0.15.1 P5 r14 注入 apiKey）──────
  // 根据 location 选择 LocalRunner（本地）或 RemoteRunner（服务器）。
  // args: { prompt, options?, model?, location?, serverConfig? }
  //
  // r14：renderer 把当前选中的 model 传过来，main 进程按 model 反查 settings.apiKeys，
  // 把命中的 apiKey + baseUrl 透传给 SDKBridge（再注入到 claude CLI 子进程的 env）。
  // 反查失败（apiKeys 为空）时直接 push 一个清晰的 error 事件到 renderer，不抛异常，
  // 让 ChatViewV2 错误区显示「请先在设置中配置 API Key」。
  ipcMain.handle(
    'agent:start',
    async (
      event,
      args: {
        prompt: string
        options?: SDKOptions
        model?: string
        location?: 'local' | 'remote'
        serverConfig?: ServerConfig
      }
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

      // ─── r14：按 model 从 settings.apiKeys 反查 apiKey + baseUrl ─────────
      // 本地路径（location !== 'remote'）才需要注入 API key；远程路径走服务器侧鉴权。
      const effectiveOptions: SDKOptions = { ...(args.options ?? {}) }
      if ((args.location ?? 'local') === 'local') {
        const apiKeys = readApiKeysFromDisk()
        if (apiKeys.length === 0) {
          // 没有任何配置 — 立即广播错误，不启动 runner
          if (!win.isDestroyed()) {
            win.webContents.send('agent:event', {
              type: 'error',
              message: '请先在设置中配置 API Key（ActivityBar → 设置 → API Keys）',
            })
          }
          return null
        }
        const model = args.model ?? ''
        const keyEntry = findKeyForModel(apiKeys, model)
        if (!keyEntry) {
          // 极端情况：apiKeys 非空但 findKeyForModel 兜底也没命中（逻辑上不该发生）
          if (!win.isDestroyed()) {
            win.webContents.send('agent:event', {
              type: 'error',
              message: `未找到 model "${model}" 对应的 API Key 配置，请检查设置`,
            })
          }
          return null
        }
        // 注入：renderer 已通过 useChatSend 把 keyEntry.baseUrl 放进 options.baseUrl，
        // 这里以反查结果为准（覆盖 renderer 端可能的过期值），保持单一真源
        effectiveOptions.apiKey = keyEntry.key
        if (keyEntry.baseUrl && keyEntry.baseUrl.length > 0) {
          effectiveOptions.baseUrl = keyEntry.baseUrl
        }
      }

      const runner = createRunner(
        args.location ?? 'local',
        win,
        args.serverConfig
      )
      _activeRunners.set(webContentsId, runner)

      // 异步启动，不 await（事件通过 IPC 推送到 renderer）
      runner
        .start(args.prompt, effectiveOptions)
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

  // ── agent:pause（节点 5.3）───────────────────────────────────────────────
  // renderer 请求暂停：在下一个 tool_use 前暂停，等待 agent:resume。
  // 仅 LocalRunner 支持 pause/resume；RemoteRunner 忽略。
  ipcMain.handle('agent:pause', (event) => {
    const runner = _activeRunners.get(event.sender.id)
    if (runner instanceof LocalRunner) {
      runner.pause()
    }
    return null
  })

  // ── agent:resume（节点 5.3）──────────────────────────────────────────────
  // renderer 提交干预文本并恢复 agent loop。
  // args: { interventionText: string | null }
  ipcMain.handle('agent:resume', (event, args: { interventionText: string | null }) => {
    const runner = _activeRunners.get(event.sender.id)
    if (runner instanceof LocalRunner) {
      runner.resume(args.interventionText)
    }
    return null
  })

  // ── 后端健康检查：尝试 ping Python ai-service(:8765)，不可达时也返回 true
  // v0.15 主路径是 Claude Code SDK，Python service 可选
  ipcMain.handle('check_backend_health', async () => {
    try {
      const res = await fetch('http://127.0.0.1:8765/health', { signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch {
      return true  // SDK 路径不依赖 Python service，不显示离线 banner
    }
  })

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
