/**
 * Vault 配置类型定义（renderer 端复刻）
 *
 * 与 main 进程 `electron/store/vaultStore.ts` 的 VaultConfigSchema['vaultConfig']
 * 保持单源对齐（v0.16 req-063）。main 与 renderer 各自从自身一侧导入，
 * 物理隔离但语义同形。
 */

export interface VaultConfig {
  /** Vault 根目录绝对路径 */
  vaultRoot: string
  /** 相对子目录名（推荐，如 'QA'）或绝对路径 */
  qaSubdir: string
  /** 相对子目录名（推荐，如 'Projects'）或绝对路径 */
  projectsSubdir: string
  /** 相对子目录名（推荐，如 'Conversations'）或绝对路径 */
  conversationsSubdir: string
  /** 首次启动 toast 是否已显示（lifecycle 一次） */
  hasShownFirstLaunchToast: boolean
}

/**
 * `vault:get-config` IPC response 形态：vaultConfig 字段 + 边带 __fallbackInfo
 * （非持久化、仅当次响应有效，由 main 进程 M-4 模块 getLastFallbackInfo() 拼装）
 */
export interface VaultConfigWithFallback extends VaultConfig {
  __fallbackInfo?: { used: boolean; reason: string }
}

/**
 * `vault:config-changed` 广播 payload 形态
 * - fallbackUsed / fallbackReason：M-4 fallback 命中时附带
 * - triggerSource：M-4 条件 4（全新安装）命中时附带，固定值 'fresh-install'
 */
export interface VaultConfigChangedPayload {
  config: VaultConfig
  fallbackUsed?: boolean
  fallbackReason?: string
  triggerSource?: 'fresh-install'
}
