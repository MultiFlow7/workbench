/**
 * 主进程 Vault 配置持久化（v0.16 节点 M-1，req-063）
 *
 * 使用 electron-store 持久化 vault 配置（顶层 key `vaultConfig` 嵌套对象）。
 * 与 workspaceStore 共享默认 `<userData>/config.json` 文件，通过顶层 key
 * 命名空间隔离（workspaceStore 用 `'workspace.cwd'` 顶层扁平 key，
 * vaultStore 用 `'vaultConfig'` 顶层嵌套对象 key）。
 *
 * 设计原则（仿 workspaceStore.ts）：
 * - main 端唯一持有 electron-store 实例（renderer 通过 IPC 访问）
 * - 单文件 + 单 schema + 单 store 实例（lazy init）
 * - 暴露同步 API（electron-store 本身是同步的）
 * - setVaultConfig 实现 partial merge（读出整对象 → 合入 patch → 写回），
 *   避免 dot-notation 单字段写时丢失其他字段
 *
 * 关联：v0.16 product.md「设计方案 · 1」/ technical.md「数据模型 · vaultStore Schema」
 */

import Store from 'electron-store'

export type VaultConfig = {
  /** Vault 根目录绝对路径；'' 表示未配置 */
  vaultRoot: string
  /** QA 子目录名（推荐相对名，如 'QA'）或绝对路径 */
  qaSubdir: string
  /** Projects 子目录名（推荐相对名，如 'Projects'）或绝对路径 */
  projectsSubdir: string
  /** 首次启动 toast 是否已显示（lifecycle 一次） */
  hasShownFirstLaunchToast: boolean
}

export type VaultStoreSchema = {
  vaultConfig: VaultConfig
}

const DEFAULT_VAULT_CONFIG: VaultConfig = {
  vaultRoot: '',
  qaSubdir: 'QA',
  projectsSubdir: 'Projects',
  hasShownFirstLaunchToast: false,
}

let _store: Store<VaultStoreSchema> | null = null

/**
 * 测试期可注入的 store 配置覆写（默认无覆写，运行期走 electron-store 默认 path resolution）。
 * 单元测试通过 __setStoreOptionsForTesting 注入 cwd + projectName，避开 app.getPath 依赖。
 */
let _storeOptionsOverride: { cwd?: string; projectName?: string } | null = null

function getStore(): Store<VaultStoreSchema> {
  if (!_store) {
    _store = new Store<VaultStoreSchema>({
      defaults: {
        vaultConfig: { ...DEFAULT_VAULT_CONFIG },
      },
      ...(_storeOptionsOverride ?? {}),
    })
  }
  return _store
}

/**
 * 获取当前持久化的完整 vault 配置对象（含 4 字段）。
 * 未写入时返回 defaults 的拷贝。
 */
export function getVaultConfig(): VaultConfig {
  // electron-store 返回的是引用，但 schema 默认值在首次 get 时会被注入；
  // 这里浅拷贝一份避免外部意外修改污染 store 内部状态
  const current = getStore().get('vaultConfig', DEFAULT_VAULT_CONFIG)
  return { ...DEFAULT_VAULT_CONFIG, ...current }
}

/**
 * 部分更新 vault 配置（partial merge），返回合并后的完整对象。
 * 实现策略：read → merge → write 整个 vaultConfig，避免 dot-notation 写丢字段。
 */
export function setVaultConfig(patch: Partial<VaultConfig>): VaultConfig {
  const current = getVaultConfig()
  const merged: VaultConfig = { ...current, ...patch }
  getStore().set('vaultConfig', merged)
  return merged
}

/**
 * 是否已完成 vault 配置（vaultRoot 非空即视为已配置）。
 */
export function isVaultConfigured(): boolean {
  return getVaultConfig().vaultRoot.length > 0
}

/**
 * 标记首次启动 toast 已显示（等价 setVaultConfig({ hasShownFirstLaunchToast: true })）。
 */
export function markFirstLaunchToastShown(): void {
  setVaultConfig({ hasShownFirstLaunchToast: true })
}

/**
 * `.env.local` 兼容迁移（v0.16 节点 M-5，req-063）。
 *
 * 读取 `process.env.VITE_VAULT_ROOT` / `VITE_VAULT_QA_PATH` / `VITE_VAULT_PROJECTS_PATH`，
 * 仅当 electron-store 内 vaultConfig.vaultRoot 为空时执行迁移（幂等）。
 *
 * 字段映射：
 *   VITE_VAULT_ROOT          → vaultRoot
 *   VITE_VAULT_QA_PATH       → qaSubdir（env 旧值通常为绝对路径，paths.ts 派生时按绝对优先）
 *   VITE_VAULT_PROJECTS_PATH → projectsSubdir（同上）
 *
 * @returns true 表示发生了迁移；false 表示无变化（无 env 或 store 已有）
 */
export function migrateFromEnv(): boolean {
  // 幂等：store 已有 vaultRoot 则不迁移
  if (isVaultConfigured()) return false

  const envRoot = process.env.VITE_VAULT_ROOT
  const envQa = process.env.VITE_VAULT_QA_PATH
  const envProj = process.env.VITE_VAULT_PROJECTS_PATH

  if (!envRoot || envRoot.length === 0) return false

  const patch: Partial<VaultConfig> = { vaultRoot: envRoot }
  if (envQa && envQa.length > 0) patch.qaSubdir = envQa
  if (envProj && envProj.length > 0) patch.projectsSubdir = envProj

  setVaultConfig(patch)
  // 一次性弃用警告（文案与 product.md 严格一致）
  console.warn(
    '[vault] VITE_VAULT_* env vars are deprecated and will be ignored in future versions. Migrated to electron-store.'
  )
  return true
}

/**
 * 测试钩子：重置内部 store 单例（仅供单元测试使用）。
 * 调用后下一次 getStore() 会重建实例，便于在测试中切换不同的 store 文件。
 */
export function __resetStoreForTesting(): void {
  _store = null
}

/**
 * 测试钩子：注入 store 构造选项（cwd / projectName），避开 electron app.getPath 依赖。
 * 仅供单元测试使用；运行期不应调用。
 */
export function __setStoreOptionsForTesting(options: { cwd?: string; projectName?: string } | null): void {
  _storeOptionsOverride = options
  _store = null
}
