/**
 * paths.ts · v0.16 节点 R-2 重写
 *
 * 从 vaultSlice 派生 vault / QA / Projects 路径，替换原 import.meta.env.VITE_VAULT_* 编译期内联。
 *
 * 导出双轨：
 * - hook 系（React 组件用）：useVaultPath / useBasePath / useProjectsPath
 * - getter 系（非 React 上下文用）：getVaultPath / getBasePath / getProjectsPath / getVaultConfig
 * - 纯函数：buildFilePath / toFilePathFromSnapshot
 *
 * 路径派生规则（与 main 进程 vaultStore.ts 单源对齐）：
 * - 子目录为绝对路径（POSIX 以 '/' 开头 或 Windows 'C:\\' 等）→ 直接用
 * - 否则视为相对子目录名 → 拼接到 vaultRoot 下
 */

import { useStore } from '../store'
import { getVaultConfigSnapshot } from '../store/vaultSlice'
import type { VaultConfig } from '../types/vault'

// ─── 内部纯函数 ─────────────────────────────────────────────────────────────

function isAbsolutePath(p: string): boolean {
  // POSIX 绝对路径
  if (p.startsWith('/')) return true
  // Windows 绝对路径 (C:\ 或 C:/)
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true
  return false
}

function deriveQaDir(config: VaultConfig | null): string {
  if (!config || !config.vaultRoot) return ''
  const sub = config.qaSubdir || 'QA'
  return isAbsolutePath(sub) ? sub : `${config.vaultRoot}/${sub}`
}

function deriveProjectsDir(config: VaultConfig | null): string {
  if (!config || !config.vaultRoot) return ''
  const sub = config.projectsSubdir || 'Projects'
  return isAbsolutePath(sub) ? sub : `${config.vaultRoot}/${sub}`
}

// ─── React hook 系 ──────────────────────────────────────────────────────────

export function useVaultPath(): string {
  return useStore((s) => s.vaultConfig?.vaultRoot ?? '')
}

export function useBasePath(): string {
  return useStore((s) => deriveQaDir(s.vaultConfig))
}

export function useProjectsPath(): string {
  return useStore((s) => deriveProjectsDir(s.vaultConfig))
}

// ─── 纯函数 ────────────────────────────────────────────────────────────────

/**
 * 拼接 atom id 到 base path，生成 `.md` 文件全路径。
 * 任一入参为空字符串返回 ''。
 */
export function buildFilePath(basePath: string, id: string): string {
  if (!basePath || !id) return ''
  return `${basePath}/${id}.md`
}

// ─── 非 React 上下文 getter（供 agentEventDispatcher / conversationSlice 等）

export function getVaultConfig(): VaultConfig | null {
  return getVaultConfigSnapshot()
}

export function getVaultPath(): string {
  return getVaultConfigSnapshot()?.vaultRoot ?? ''
}

export function getBasePath(): string {
  return deriveQaDir(getVaultConfigSnapshot())
}

export function getProjectsPath(): string {
  return deriveProjectsDir(getVaultConfigSnapshot())
}

/**
 * 在非 React 上下文（如 agentEventDispatcher）用 id 一步生成全路径。
 * React 组件应优先用 useBasePath() + buildFilePath()。
 */
export function toFilePathFromSnapshot(id: string): string {
  return buildFilePath(getBasePath(), id)
}
