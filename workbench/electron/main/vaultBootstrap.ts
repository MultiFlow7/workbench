/**
 * Vault 启动引导（v0.16 节点 M-4 + M-5，req-063）
 *
 * `ensureDefaultVault()` 由 main/index.ts 在 registerVaultIpc() 之后、createWindow() 之前
 * 调用。判定逻辑严格对齐 product.md「触发条件与执行逻辑」表格 4 个条件的短路求值：
 *
 *   1) electron-store 已有非空 vaultRoot → return（不触碰文件系统）
 *   2) process.env.VITE_VAULT_ROOT 非空   → 调 migrateFromEnv() → return
 *   3) ~/Workbench-Vault 目录存在          → 引用该目录 + 补建子目录
 *   4) 全新安装                            → 尝试创建 ~/Workbench-Vault；失败 fallback
 *                                          到 app.getPath('userData')/Workbench-Vault
 *
 * fallback 信息 + triggerSource 通过 main 进程内存模块变量缓存，由 M-2 vault:get-config
 * handler 边带返回 / M-3 createWindow 后补偿广播两条通路送达 renderer。
 */

import { app } from 'electron'
import { dirname, join } from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import {
  getVaultConfig,
  isVaultConfigured,
  migrateFromEnv,
  setVaultConfig,
} from '../store/vaultStore'

// ─── 模块状态（M-4 写入；M-2 / M-3 读取后通过 IPC 透传给 renderer）─────────

let __lastFallbackInfo: { used: boolean; reason: string } = {
  used: false,
  reason: '',
}
let __lastTriggerSource: 'fresh-install' | null = null

export function getLastFallbackInfo(): { used: boolean; reason: string } {
  return { ...__lastFallbackInfo }
}

export function getLastTriggerSource(): 'fresh-install' | null {
  return __lastTriggerSource
}

/**
 * 测试钩子：清空模块状态（仅供单元测试用）。
 */
export function __resetVaultBootstrapForTesting(): void {
  __lastFallbackInfo = { used: false, reason: '' }
  __lastTriggerSource = null
}

/**
 * 同步 workspace.cwd 与新 vaultRoot（由 M-4 条件 2/3/4 写入 vaultRoot 后调用）。
 *
 * 接「关键技术决策 §7」过渡策略：v0.16 不动 workspace.cwd 但保证 vaultRoot 写入
 * 后 fsGuard 越界保护根锚点与 vault 一致。
 *
 * 抽到独立函数后，main/index.ts 接线时可直接调用，避免循环依赖：
 * vaultBootstrap → handlers 反向依赖会形成环（handlers 依赖 vaultBootstrap.ensureDefaultVault
 * 已是反向，反之 vaultBootstrap 引 handlers 会再循环）。
 * 因此本模块通过 callback 接收 setWorkspaceCwd / setPersistedCwd，由 main/index.ts 注入。
 */
export type WorkspaceSyncFns = {
  getCurrentCwd: () => string
  setWorkspaceCwd: (cwd: string) => void
  setPersistedCwd: (cwd: string) => void
}

let _workspaceSync: WorkspaceSyncFns | null = null

/**
 * 由 main/index.ts 在 app.whenReady() 内调一次（registerVaultIpc 之前即可）。
 * 注入工作目录同步函数，让 ensureDefaultVault 在写入 vaultRoot 后能同步 cwd。
 */
export function setWorkspaceSyncFns(fns: WorkspaceSyncFns): void {
  _workspaceSync = fns
}

function syncCwdToVaultRoot(newVaultRoot: string): void {
  if (!_workspaceSync) return
  const currentCwd = _workspaceSync.getCurrentCwd()
  if (currentCwd === newVaultRoot) return
  _workspaceSync.setWorkspaceCwd(newVaultRoot)
  _workspaceSync.setPersistedCwd(newVaultRoot)
}

/**
 * 安全的「目录是否存在」检查（不抛错）。
 */
function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * 安全的 mkdir -p；成功返回 null，失败返回 error.code（如 'EACCES'）。
 */
function tryMkdir(p: string): string | null {
  try {
    fs.mkdirSync(p, { recursive: true })
    return null
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? 'UNKNOWN'
    return code
  }
}

/**
 * 在 vaultRoot 下创建 QA / Projects / Conversations 子目录（已存在则 no-op）。
 */
function ensureSubdirs(vaultRoot: string, qaSub: string, projSub: string, convSub: string): void {
  // 子目录可能是绝对路径或相对名；仅当为相对名时拼接到 vaultRoot
  const qaIsAbs = /^([a-zA-Z]:[\\/]|[/\\])/.test(qaSub)
  const projIsAbs = /^([a-zA-Z]:[\\/]|[/\\])/.test(projSub)
  const convIsAbs = /^([a-zA-Z]:[\\/]|[/\\])/.test(convSub)
  const qaDir = qaIsAbs ? qaSub : join(vaultRoot, qaSub)
  const projDir = projIsAbs ? projSub : join(vaultRoot, projSub)
  const convDir = convIsAbs
    ? convSub
    : convSub === 'Conversations' && qaIsAbs && projIsAbs && dirname(qaSub) === dirname(projSub)
      ? join(dirname(qaSub), 'Conversations')
      : join(vaultRoot, convSub)
  tryMkdir(qaDir)
  tryMkdir(projDir)
  tryMkdir(convDir)
}

/**
 * 主入口：M-4 + M-5 联合实现。
 *
 * 由 main/index.ts 在 app.whenReady() 内 registerVaultIpc() 之后、
 * createWindow() 之前调用（await）。
 */
export async function ensureDefaultVault(): Promise<void> {
  // 条件 1：store 已有非空 vaultRoot → return
  if (isVaultConfigured()) {
    return
  }

  // 条件 2：.env.local 迁移路径
  if (process.env.VITE_VAULT_ROOT && process.env.VITE_VAULT_ROOT.length > 0) {
    const migrated = migrateFromEnv()
    if (migrated) {
      // 同步 cwd 与新 vaultRoot
      syncCwdToVaultRoot(getVaultConfig().vaultRoot)
      return
    }
    // migrateFromEnv 返回 false 罕见（不会发生在此 if 块内，因为 env 已存在）
  }

  // 条件 3：~/Workbench-Vault 已存在 → 引用 + 补建子目录
  const defaultRoot = join(os.homedir(), 'Workbench-Vault')
  if (dirExists(defaultRoot)) {
    setVaultConfig({ vaultRoot: defaultRoot })
    const cfg = getVaultConfig()
    ensureSubdirs(defaultRoot, cfg.qaSubdir, cfg.projectsSubdir, cfg.conversationsSubdir)
    syncCwdToVaultRoot(defaultRoot)
    return
  }

  // 条件 4：全新安装路径
  const cfg = getVaultConfig()
  const primaryErr = tryMkdir(defaultRoot)
  if (primaryErr === null) {
    // 主路径成功
    ensureSubdirs(defaultRoot, cfg.qaSubdir, cfg.projectsSubdir, cfg.conversationsSubdir)
    setVaultConfig({ vaultRoot: defaultRoot })
    __lastTriggerSource = 'fresh-install'
    syncCwdToVaultRoot(defaultRoot)
    return
  }

  // fallback：app.getPath('userData')/Workbench-Vault
  const fallbackRoot = join(app.getPath('userData'), 'Workbench-Vault')
  const fallbackErr = tryMkdir(fallbackRoot)
  if (fallbackErr === null) {
    ensureSubdirs(fallbackRoot, cfg.qaSubdir, cfg.projectsSubdir, cfg.conversationsSubdir)
    setVaultConfig({ vaultRoot: fallbackRoot })
    __lastFallbackInfo = {
      used: true,
      reason: `homedir mkdir failed: ${primaryErr}`,
    }
    __lastTriggerSource = 'fresh-install'
    syncCwdToVaultRoot(fallbackRoot)
    return
  }

  // 两路都失败 — 极端情况，记录但不抛错（renderer 仍可手动配置）
  __lastFallbackInfo = {
    used: true,
    reason: `homedir mkdir failed: ${primaryErr}; fallback mkdir failed: ${fallbackErr}`,
  }
  __lastTriggerSource = 'fresh-install'
  // 不写 vaultRoot；renderer 进入 Settings 手动选目录
}
