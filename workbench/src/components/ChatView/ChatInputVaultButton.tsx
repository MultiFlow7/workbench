/**
 * ChatInputVaultButton · v0.16 节点 R-6
 *
 * Chat 输入框上方的 Vault 文件夹切换按钮。点击调 vault:pick-folder IPC，
 * 用户选定路径后写入 vaultSlice（vault:set-config），切换成功 toast 反馈。
 *
 * 两态：
 *   - 未配置（vaultRoot=''）：显示「未配置」，hover tooltip「点击配置 Vault」
 *   - 已配置：显示 vault 文件夹名（getVaultFolderName），hover tooltip 显示完整路径（中部省略）
 *
 * Toast 反馈复用 notificationsSlice + TopBar 既有 3s autoDismiss。
 *
 * 边界 case：
 *   - 取消选目录（null / { cancelled: true }）：静默 return
 *   - 无访问权限 / 无效目录 / setVaultConfig 失败：error toast
 */

import { useState } from 'react'
import { useVaultRoot } from '../../store/vaultSlice'
import { useStore } from '../../store'
import { truncateMiddle, getVaultFolderName } from '../../utils/pathDisplay'

export const PATH_TRUNCATE_LEN = 40

/**
 * 内部 helper：执行 vault 切换的核心交互序列。
 * 抽取为纯函数便于单元测试（T-V016-R6.11 ~ R6.16）。
 *
 * 参数注入式而非依赖 module-global，方便测试 mock invoke/setVaultConfig/addToast。
 */
export interface VaultSwitchDeps {
  invoke: <T>(channel: string, args?: unknown) => Promise<T>
  setVaultConfig: (patch: { vaultRoot: string }) => Promise<void>
  addToast: (toast: {
    id: string
    type: 'success' | 'error' | 'info'
    message: string
    autoDismiss: boolean
  }) => void
}

export async function performVaultSwitch(deps: VaultSwitchDeps): Promise<void> {
  try {
    const result = await deps.invoke<string | { cancelled: true } | null>(
      'vault:pick-folder',
      { title: '切换 Vault 根目录' },
    )
    if (result === null) return
    if (typeof result === 'object' && result !== null && 'cancelled' in result) return
    if (typeof result !== 'string') return
    await deps.setVaultConfig({ vaultRoot: result })
    const newFolderName = getVaultFolderName(result)
    const newPath = truncateMiddle(result, PATH_TRUNCATE_LEN)
    deps.addToast({
      id: `vault-switched-${Date.now()}`,
      type: 'success',
      message: `Vault 已切换到 ${newFolderName}(${newPath})`,
      autoDismiss: true,
    })
  } catch (e) {
    deps.addToast({
      id: `vault-switch-error-${Date.now()}`,
      type: 'error',
      message: `Vault 切换失败:${String(e)}`,
      autoDismiss: true,
    })
  }
}

// 内联 SVG FolderIcon，仿 NavIcons 风格（14×14 显示，18×18 viewBox 保留描边一致性）
function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M2 5.5a1 1 0 0 1 1-1h3.6l1.4 1.5h6.5a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ChatInputVaultButton() {
  const vaultRoot = useVaultRoot()
  const setVaultConfig = useStore((s) => s.setVaultConfig)
  const addToast = useStore((s) => s.addToast)
  const [hovering, setHovering] = useState(false)

  const isConfigured = vaultRoot !== ''
  const folderName = isConfigured ? getVaultFolderName(vaultRoot) : '未配置'
  const tooltipText = isConfigured
    ? truncateMiddle(vaultRoot, PATH_TRUNCATE_LEN)
    : '点击配置 Vault'

  function handleClick() {
    void performVaultSwitch({
      invoke: window.api.invoke.bind(window.api),
      setVaultConfig,
      addToast,
    })
  }

  return (
    <button
      type="button"
      className="chat-input-vault-btn"
      onClick={handleClick}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      aria-label="切换 Vault 根目录"
      title={tooltipText}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'transparent',
        border: 'none',
        padding: '4px 8px',
        cursor: 'pointer',
        fontSize: 12,
        fontFamily: 'var(--font-ui, Inter, sans-serif)',
        color: hovering ? 'var(--accent, #2563eb)' : 'var(--text-3, #71717a)',
        transition: 'color 0.15s ease',
        borderRadius: 4,
      }}
    >
      <FolderIcon />
      <span>{folderName}</span>
    </button>
  )
}
