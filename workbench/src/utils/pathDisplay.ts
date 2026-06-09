/**
 * pathDisplay.ts · 路径辅助纯函数
 *
 * 历史：v0.16 R-6 节点首次引入（ChatInputVaultButton 已撤销）。
 * 现状：纯函数保留以服务 req-065「任务 cwd 选择器」（v0.17 候选），
 *       用于在 cwd 切换按钮 / 显示控件中截断长路径、提取文件夹名。
 *       任何新增使用方仍可直接依赖本模块。
 *
 * 测试：见 __tests__/pathDisplay.test.ts（T-V016-R6.1 ~ R6.8 用例族）。
 */

/**
 * 中部省略：超长路径头尾保留、中部用「...」省略。
 *
 * @param path 完整路径
 * @param maxLen 触发阈值；<= maxLen 时原样返回，> maxLen 时截断
 * @returns 截断后的字符串
 *
 * 头部保留约 40% 的可用空间，尾部保留约 60%（尾部更重要，含 vault 文件夹名）。
 *
 * @example
 *   truncateMiddle('/short', 40) === '/short'
 *   truncateMiddle('/Users/.../Workbench-Vault', 40) → 头部 + '...' + 尾部，长度 ≤ 40
 */
export function truncateMiddle(path: string, maxLen: number): string {
  if (!path) return ''
  if (path.length <= maxLen) return path
  const ellipsis = '...'
  const available = maxLen - ellipsis.length
  if (available <= 0) return path.slice(0, maxLen)
  const headLen = Math.floor(available * 0.4)
  const tailLen = available - headLen
  return `${path.slice(0, headLen)}${ellipsis}${path.slice(-tailLen)}`
}

/**
 * 取路径最后一段作为「文件夹名」。
 * 兼容 mac/linux ('/') 与 windows ('\\') 路径分隔符。
 *
 * @param vaultRoot 完整路径
 * @returns 文件夹名；vaultRoot 为空返回 ''；以分隔符结尾时去尾后再取
 *
 * @example
 *   getVaultFolderName('/Users/m/Workbench-Vault') === 'Workbench-Vault'
 *   getVaultFolderName('/Users/m/Workbench-Vault/') === 'Workbench-Vault'
 *   getVaultFolderName('C:\\Users\\m\\Workbench-Vault') === 'Workbench-Vault'
 *   getVaultFolderName('') === ''
 *   getVaultFolderName('/') === ''
 */
export function getVaultFolderName(vaultRoot: string): string {
  if (!vaultRoot) return ''
  // 去除尾部分隔符
  const trimmed = vaultRoot.replace(/[/\\]+$/, '')
  if (!trimmed) return ''
  // 用 / 或 \ 切分，取最后一段
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || ''
}
