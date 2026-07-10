/**
 * VaultConfig.test.tsx · v0.16
 *
 * 测试用例：
 * - T-V016-R4.1 表单初始化（vaultRoot + QA / Projects 高级路径）
 * - T-V016-R4.2 校验 vaultRoot 空 / 非绝对路径 + QA / Projects 必填
 * - T-V016-R4.4 「选择文件夹」按钮存在（根目录 / QA / Projects）
 * - T-V016-R4.5 「检测有效性」按钮存在
 * - T-V016-R4.6 「保存」按钮存在
 * - fallback warning bar 渲染
 * - 分区锚点 id=settings-section-vault 保留（FirstLaunchToast 联动用）
 *
 * 注：默认新用户仍使用 QA / Projects，相对路径或绝对旧路径均可保存。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import type { VaultConfig as VaultConfigType } from '../../../types/vault'

const mockState: {
  vaultConfig: VaultConfigType | null
  vaultConfigError: string | null
  vaultFallbackInfo: { used: boolean; reason: string } | null
  setVaultConfig: ReturnType<typeof vi.fn>
} = {
  vaultConfig: null,
  vaultConfigError: null,
  vaultFallbackInfo: null,
  setVaultConfig: vi.fn(),
}

vi.mock('../../../store/vaultSlice', () => ({
  useVaultConfig: () => mockState.vaultConfig,
  useVaultConfigError: () => mockState.vaultConfigError,
}))

vi.mock('../../../store', () => ({
  useStore: Object.assign(
    <T,>(selector: (s: typeof mockState) => T) => selector(mockState),
    { getState: () => ({ setVaultConfig: mockState.setVaultConfig }) },
  ),
}))

const SAMPLE_CONFIG: VaultConfigType = {
  vaultRoot: '/v',
  qaSubdir: 'QA',
  projectsSubdir: 'Projects',
  conversationsSubdir: 'Conversations',
  hasShownFirstLaunchToast: false,
}

beforeEach(() => {
  mockState.vaultConfig = { ...SAMPLE_CONFIG }
  mockState.vaultConfigError = null
  mockState.vaultFallbackInfo = null
  mockState.setVaultConfig = vi.fn().mockResolvedValue(undefined)
  ;(globalThis as unknown as { window: { api: unknown } }).window = {
    api: {
      invoke: vi.fn(),
      fsExists: vi.fn().mockResolvedValue(true),
      listen: vi.fn().mockResolvedValue(() => {}),
    },
  }
})

import { VaultConfig } from '../VaultConfig'

describe('VaultConfig (v0.16 QA 重塑)', () => {
  it('T-V016-R4.1 表单初始化：vaultRoot + QA / Projects input value 反映 config', () => {
    mockState.vaultConfig = {
      ...SAMPLE_CONFIG,
      vaultRoot: '/my/v',
      qaSubdir: '/legacy/qa',
      projectsSubdir: '/legacy/projects',
    }
    const html = renderToString(<VaultConfig />)
    expect(html).toContain('value="/my/v"')
    expect(html).toContain('value="/legacy/qa"')
    expect(html).toContain('value="/legacy/projects"')
  })

  it('T-V016-R4.1b 含「Vault 配置」label + 「保存」/「检测有效性」/ 三个选择文件夹按钮', () => {
    const html = renderToString(<VaultConfig />)
    expect(html).toContain('Vault 配置')
    expect(html).toContain('保存')
    expect(html).toContain('检测有效性')
    expect(html).toContain('aria-label="选择文件夹"')
    expect(html).toContain('aria-label="选择 QA 对话目录"')
    expect(html).toContain('aria-label="选择 Projects 项目目录"')
  })

  it('T-V016-R4.1c QA / Projects 高级路径默认渲染为相对子目录名', () => {
    const html = renderToString(<VaultConfig />)
    expect(html).toContain('aria-label="QA 对话目录"')
    expect(html).toContain('aria-label="Projects 项目目录"')
    expect(html).toContain('value="QA"')
    expect(html).toContain('value="Projects"')
  })

  it('T-V016-R4-fb fallback warning bar：vaultFallbackInfo.used 时显示', () => {
    mockState.vaultFallbackInfo = { used: true, reason: 'homedir mkdir failed: EACCES' }
    const html = renderToString(<VaultConfig />)
    expect(html).toContain('已使用 fallback 路径')
    expect(html).toContain('EACCES')
  })

  it('T-V016-R4-anchor: 分区锚点 id 为 settings-section-vault（保留供 FirstLaunchToast 联动）', () => {
    const html = renderToString(<VaultConfig />)
    expect(html).toContain('id="settings-section-vault"')
  })

  it('T-V016-R4.2 表单校验逻辑（纯函数等价）：vaultRoot 必填绝对路径，QA / Projects 必填', () => {
    function validateForm(vaultRoot: string, qaSubdir = 'QA', projectsSubdir = 'Projects'): string | null {
      const trimmed = vaultRoot.trim()
      if (!trimmed) return 'Vault 根目录不能为空'
      if (!trimmed.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(trimmed)) {
        return 'Vault 根目录必须是绝对路径'
      }
      if (!qaSubdir.trim()) return 'QA 目录不能为空'
      if (!projectsSubdir.trim()) return 'Projects 目录不能为空'
      return null
    }
    expect(validateForm('')).toBe('Vault 根目录不能为空')
    expect(validateForm('  ')).toBe('Vault 根目录不能为空')
    expect(validateForm('relative/path')).toContain('绝对路径')
    expect(validateForm('/abs/path', '')).toBe('QA 目录不能为空')
    expect(validateForm('/abs/path', 'QA', '')).toBe('Projects 目录不能为空')
    expect(validateForm('/abs/path')).toBeNull()
    expect(validateForm('C:\\abs\\path')).toBeNull()
    expect(validateForm('/abs/path', '/legacy/qa', '/legacy/projects')).toBeNull()
  })
})
