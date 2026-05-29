/**
 * IPC Handler 注册中心（v0.15 节点 1.2）
 *
 * 所有 ipcMain.handle('cmd', fn) 在此集中注册。
 * 节点 1.3 起按功能扩充 fs:* / dialog:* / agent:* 等通道。
 *
 * 注意：本节点的 handler 实现是映射层——将来自 renderer 的调用
 * 转发给 Electron 内置 API 或本地 Node.js 模块。
 * Tauri 原有的 Rust 命令（如 stream_ai / list_tasks 等后台业务逻辑）
 * 在 Phase 2 之前以「noop / stub」形式占位，不抛错，返回空值，
 * 确保 renderer 可正常挂载而不崩溃。
 */

import { ipcMain } from 'electron'
import { join } from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'

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

  // ── AI 流式对话（stub，Phase 2 接入 Claude Code SDK）────────────────────
  stubOk('stream_ai')
  stubOk('cancel_stream')
  stubOk('execute_tool', '')

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

  // ── fs:exists（供 ChatView generateNewAtomId 使用）────────────────────────
  ipcMain.handle('fs:exists', (_e, args: { path: string }) => {
    try {
      return fs.existsSync(args.path)
    } catch {
      return false
    }
  })
}
