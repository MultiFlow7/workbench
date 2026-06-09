/**
 * ChatInputVaultButton.test.tsx · v0.16 节点 R-6 组件测试
 *
 * 覆盖 T-V016-R6.9 ~ T-V016-R6.16（8 个用例）
 *
 * 测试策略：
 *   - R6.9 / R6.10 渲染分支：SSR (renderToString) + mock useVaultRoot 控制返回值
 *   - R6.11 / R6.13 / R6.14 / R6.15 / R6.16：测试 performVaultSwitch 内部交互逻辑
 *     （依赖注入式，无需 jsdom，纯函数 + 注入 invoke / setVaultConfig / addToast spy）
 *   - R6.12 广播实时更新：通过 mock useVaultRoot 切换返回值 + 两次 SSR 验证
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'

// ─── Mock store hook 返回值 ────────────────────────────────────────────────

const mockState: {
  vaultRoot: string
  setVaultConfig: ReturnType<typeof vi.fn>
  addToast: ReturnType<typeof vi.fn>
} = {
  vaultRoot: '',
  setVaultConfig: vi.fn(),
  addToast: vi.fn(),
}

vi.mock('../../../store/vaultSlice', () => ({
  useVaultRoot: () => mockState.vaultRoot,
}))

vi.mock('../../../store', () => ({
  useStore: Object.assign(
    (selector: (s: { setVaultConfig: typeof mockState.setVaultConfig; addToast: typeof mockState.addToast }) => unknown) =>
      selector({ setVaultConfig: mockState.setVaultConfig, addToast: mockState.addToast }),
    { getState: () => ({ setVaultConfig: mockState.setVaultConfig, addToast: mockState.addToast }) },
  ),
}))

import { ChatInputVaultButton, performVaultSwitch } from '../ChatInputVaultButton'

// ─── R6.9 / R6.10 / R6.12 渲染分支测试（SSR）──────────────────────────────

describe('ChatInputVaultButton · 渲染分支', () => {
  beforeEach(() => {
    mockState.setVaultConfig = vi.fn()
    mockState.addToast = vi.fn()
  })

  it('T-V016-R6.9 未配置态渲染：vaultRoot="" 时 button 文本含「未配置」且 title="点击配置 Vault"', () => {
    mockState.vaultRoot = ''
    const html = renderToString(<ChatInputVaultButton />)
    expect(html).toContain('未配置')
    expect(html).toContain('title="点击配置 Vault"')
    expect(html).toContain('aria-label="切换 Vault 根目录"')
  })

  it('T-V016-R6.10 已配置态渲染：button 文本含 vault 文件夹名 + title 含完整路径或截断版', () => {
    mockState.vaultRoot = '/Users/m/Workbench-Vault'
    const html = renderToString(<ChatInputVaultButton />)
    expect(html).toContain('Workbench-Vault')
    expect(html).toContain('/Users/m/Workbench-Vault')
  })

  it('T-V016-R6.12 vaultSlice 切换后渲染随之更新（mock 切换 + 两次 SSR）', () => {
    mockState.vaultRoot = '/old/path-old'
    const html1 = renderToString(<ChatInputVaultButton />)
    expect(html1).toContain('path-old')

    mockState.vaultRoot = '/new/Path-X'
    const html2 = renderToString(<ChatInputVaultButton />)
    expect(html2).toContain('Path-X')
    expect(html2).not.toContain('path-old')
  })
})

// ─── R6.11 / R6.13 / R6.14 / R6.15 / R6.16 交互逻辑测试 ─────────────────

describe('ChatInputVaultButton · performVaultSwitch 交互逻辑', () => {
  let invokeSpy: ReturnType<typeof vi.fn>
  let setVaultConfigSpy: ReturnType<typeof vi.fn>
  let addToastSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    invokeSpy = vi.fn()
    setVaultConfigSpy = vi.fn().mockResolvedValue(undefined)
    addToastSpy = vi.fn()
  })

  it('T-V016-R6.11 点击触发 IPC + setVaultConfig + 成功 toast', async () => {
    invokeSpy.mockResolvedValueOnce('/picked/new-vault')

    await performVaultSwitch({
      invoke: invokeSpy,
      setVaultConfig: setVaultConfigSpy,
      addToast: addToastSpy,
    })

    expect(invokeSpy).toHaveBeenCalledTimes(1)
    expect(invokeSpy).toHaveBeenCalledWith('vault:pick-folder', { title: '切换 Vault 根目录' })
    expect(setVaultConfigSpy).toHaveBeenCalledTimes(1)
    expect(setVaultConfigSpy).toHaveBeenCalledWith({ vaultRoot: '/picked/new-vault' })
    expect(addToastSpy).toHaveBeenCalledTimes(1)
    const toast = addToastSpy.mock.calls[0][0]
    expect(toast.type).toBe('success')
    expect(toast.autoDismiss).toBe(true)
    expect(toast.message).toContain('new-vault')
  })

  it('T-V016-R6.13 取消选目录不显示 toast（null）', async () => {
    invokeSpy.mockResolvedValueOnce(null)

    await performVaultSwitch({
      invoke: invokeSpy,
      setVaultConfig: setVaultConfigSpy,
      addToast: addToastSpy,
    })

    expect(setVaultConfigSpy).not.toHaveBeenCalled()
    expect(addToastSpy).not.toHaveBeenCalled()
  })

  it('T-V016-R6.14 取消选目录不显示 toast（对象形式 { cancelled: true }）', async () => {
    invokeSpy.mockResolvedValueOnce({ cancelled: true })

    await performVaultSwitch({
      invoke: invokeSpy,
      setVaultConfig: setVaultConfigSpy,
      addToast: addToastSpy,
    })

    expect(setVaultConfigSpy).not.toHaveBeenCalled()
    expect(addToastSpy).not.toHaveBeenCalled()
  })

  it('T-V016-R6.15 选无效目录（IPC reject）显示错误 toast', async () => {
    invokeSpy.mockRejectedValueOnce(new Error('permission-denied'))

    await performVaultSwitch({
      invoke: invokeSpy,
      setVaultConfig: setVaultConfigSpy,
      addToast: addToastSpy,
    })

    expect(setVaultConfigSpy).not.toHaveBeenCalled()
    expect(addToastSpy).toHaveBeenCalledTimes(1)
    const toast = addToastSpy.mock.calls[0][0]
    expect(toast.type).toBe('error')
    expect(toast.message).toContain('Vault 切换失败')
    expect(toast.message).toContain('permission-denied')
  })

  it('T-V016-R6.16 setVaultConfig 失败显示错误 toast', async () => {
    invokeSpy.mockResolvedValueOnce('/valid/path')
    setVaultConfigSpy.mockRejectedValueOnce(new Error('write store failed'))

    await performVaultSwitch({
      invoke: invokeSpy,
      setVaultConfig: setVaultConfigSpy,
      addToast: addToastSpy,
    })

    expect(setVaultConfigSpy).toHaveBeenCalledTimes(1)
    expect(addToastSpy).toHaveBeenCalledTimes(1)
    const toast = addToastSpy.mock.calls[0][0]
    expect(toast.type).toBe('error')
    expect(toast.message).toContain('write store failed')
  })
})
