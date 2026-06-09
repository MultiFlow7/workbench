/**
 * pathDisplay.test.ts · 路径辅助纯函数单元测试
 *
 * 覆盖 T-V016-R6.1 ~ T-V016-R6.8（8 个用例）。
 * v0.16 R-6 已撤销，但纯函数保留服务 req-065（v0.17 任务 cwd 选择器）。
 */

import { describe, it, expect } from 'vitest'
import { truncateMiddle, getVaultFolderName } from '../pathDisplay'

describe('truncateMiddle', () => {
  it('T-V016-R6.1 短路径不截断', () => {
    expect(truncateMiddle('/Users/m/v', 40)).toBe('/Users/m/v')
    expect(truncateMiddle('/short', 40)).toBe('/short')
  })

  it('T-V016-R6.2 超长路径中部省略：长度 ≤ maxLen 且含 "..." 且尾部含 vault 文件夹名', () => {
    const long =
      '/Users/morgan/Desktop/Morgan工作仓库/Morgan工作仓库/01-Vibe项目区/工作台/workbench/Workbench-Vault'
    const result = truncateMiddle(long, 40)
    expect(result.length).toBeLessThanOrEqual(40)
    expect(result).toContain('...')
    // 尾部保留特征字符（确认尾部含 Workbench-Vault 关键字）
    expect(result).toMatch(/Workbench-Vault$/)
  })

  it('T-V016-R6.3 边界：长度 === maxLen 原样返回；长度 === maxLen + 1 触发截断', () => {
    const exact = 'a'.repeat(40)
    expect(truncateMiddle(exact, 40)).toBe(exact)
    expect(truncateMiddle(exact, 40).length).toBe(40)

    const over = 'a'.repeat(41)
    const truncated = truncateMiddle(over, 40)
    expect(truncated).not.toBe(over)
    expect(truncated).toContain('...')
    expect(truncated.length).toBeLessThanOrEqual(40)
  })

  it('T-V016-R6.4 空字符串返回空字符串', () => {
    expect(truncateMiddle('', 40)).toBe('')
  })
})

describe('getVaultFolderName', () => {
  it('T-V016-R6.5 mac 路径取最后一段', () => {
    expect(getVaultFolderName('/Users/m/Workbench-Vault')).toBe('Workbench-Vault')
    expect(getVaultFolderName('/tmp/v1')).toBe('v1')
  })

  it('T-V016-R6.6 尾部斜杠去尾后取最后一段', () => {
    expect(getVaultFolderName('/Users/m/Workbench-Vault/')).toBe('Workbench-Vault')
    expect(getVaultFolderName('/Users/m/Workbench-Vault///')).toBe('Workbench-Vault')
  })

  it('T-V016-R6.7 win 路径支持反斜杠分隔符', () => {
    expect(getVaultFolderName('C:\\Users\\m\\Workbench-Vault')).toBe('Workbench-Vault')
    expect(getVaultFolderName('C:\\Users\\m\\Workbench-Vault\\')).toBe('Workbench-Vault')
  })

  it('T-V016-R6.8 空 / 单分隔符返回空', () => {
    expect(getVaultFolderName('')).toBe('')
    expect(getVaultFolderName('/')).toBe('')
    expect(getVaultFolderName('\\')).toBe('')
  })
})
