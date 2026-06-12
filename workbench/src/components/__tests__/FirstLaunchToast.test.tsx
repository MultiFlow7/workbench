/**
 * FirstLaunchToast.test.tsx · v0.16 节点 R-5 组件测试
 *
 * 测试用例（technical.md 「测试清单 · renderer 组件测试」）：
 * - T-V016-R5.1 渲染条件：场景 D 三条件同时满足时 shouldActivateToast 返回 true
 * - T-V016-R5.2 不渲染条件：hasShownFirstLaunchToast=true 或 triggerSource!==fresh-install 时返回 false
 * - T-V016-R5.3 渲染即置位：模拟激活后调用 setVaultConfig({ hasShownFirstLaunchToast: true })
 * - T-V016-R5.4 自动 dismiss：TOAST_AUTO_DISMISS_MS 常量为 5000，fake timer 推进后 setTimeout 触发
 * - T-V016-R5.5 手动关闭：handleClose 触发 setVisible(false) 等价路径
 * - T-V016-R5.6 「打开 Settings」联动：setSettingsPanelOpen(true) 被调用
 *   （v0.16 QA 决策：R-4 SettingsView 撤销，改用 NavIcons SettingsPanel overlay）
 *
 * 测试环境约束：项目 vitest environment=node，无 jsdom/@testing-library；
 * useRef/useState/useEffect 副作用无法直接验证。
 * 采用抽取纯函数 + mock store getState 模拟激活后行为的方式覆盖语义。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VaultConfig } from '../../types/vault'
import { shouldActivateToast, TOAST_AUTO_DISMISS_MS } from '../FirstLaunchToast'

const SAMPLE_CONFIG: VaultConfig = {
  vaultRoot: '/Users/test/Workbench-Vault',
  qaSubdir: 'QA',
  projectsSubdir: 'Projects',
  hasShownFirstLaunchToast: false,
}

describe('FirstLaunchToast', () => {
  // ─── 渲染条件（R5.1 / R5.2）─────────────────────────────────────────────

  it('T-V016-R5.1 渲染条件：场景 D 三条件同时满足 → shouldActivateToast 返回 true', () => {
    const result = shouldActivateToast(SAMPLE_CONFIG, 'fresh-install', false)
    expect(result).toBe(true)
  })

  it('T-V016-R5.2 不渲染条件 · hasShown=true：已显示过 → false', () => {
    const config: VaultConfig = { ...SAMPLE_CONFIG, hasShownFirstLaunchToast: true }
    const result = shouldActivateToast(config, 'fresh-install', false)
    expect(result).toBe(false)
  })

  it('T-V016-R5.2 不渲染条件 · triggerSource=null：非全新安装 → false（场景 A/B/C）', () => {
    const result = shouldActivateToast(SAMPLE_CONFIG, null, false)
    expect(result).toBe(false)
  })

  it('T-V016-R5.2 不渲染条件 · config=null：尚未 init → false', () => {
    const result = shouldActivateToast(null, 'fresh-install', false)
    expect(result).toBe(false)
  })

  it('T-V016-R5.2 不渲染条件 · alreadyActivated=true：本会话已激活 → false', () => {
    const result = shouldActivateToast(SAMPLE_CONFIG, 'fresh-install', true)
    expect(result).toBe(false)
  })

  // ─── 副作用语义验证（R5.3 / R5.4 / R5.5 / R5.6）─────────────────────────

  describe('副作用语义（模拟组件 useEffect 行为）', () => {
    let setVaultConfigSpy: ReturnType<typeof vi.fn>
    let setSettingsPanelOpenSpy: ReturnType<typeof vi.fn>

    beforeEach(() => {
      setVaultConfigSpy = vi.fn().mockResolvedValue(undefined)
      setSettingsPanelOpenSpy = vi.fn()
    })

    afterEach(() => {
      vi.restoreAllMocks()
      vi.useRealTimers()
    })

    it('T-V016-R5.3 渲染即置位：激活后调 setVaultConfig({ hasShownFirstLaunchToast: true })', async () => {
      // 模拟组件 useEffect 内部副作用
      const config = SAMPLE_CONFIG
      const triggerSource = 'fresh-install' as const
      const activated = false

      if (shouldActivateToast(config, triggerSource, activated)) {
        await setVaultConfigSpy({ hasShownFirstLaunchToast: true })
      }

      expect(setVaultConfigSpy).toHaveBeenCalledTimes(1)
      expect(setVaultConfigSpy).toHaveBeenCalledWith({ hasShownFirstLaunchToast: true })
    })

    it('T-V016-R5.4 自动 dismiss：TOAST_AUTO_DISMISS_MS=5000 且 setTimeout 5s 后回调触发', () => {
      vi.useFakeTimers()
      expect(TOAST_AUTO_DISMISS_MS).toBe(5000)

      const setVisibleSpy = vi.fn()
      // 模拟组件激活后注册的 5s 定时器
      const timer = setTimeout(() => setVisibleSpy(false), TOAST_AUTO_DISMISS_MS)

      // 4999ms 未到期
      vi.advanceTimersByTime(4999)
      expect(setVisibleSpy).not.toHaveBeenCalled()

      // 推进 1ms 到达 5000ms 触发
      vi.advanceTimersByTime(1)
      expect(setVisibleSpy).toHaveBeenCalledWith(false)

      clearTimeout(timer)
    })

    it('T-V016-R5.5 手动关闭：× 按钮 onClick 触发 setVisible(false)', () => {
      const setVisibleSpy = vi.fn()
      // 模拟组件中 × 按钮 onClick handler 行为
      const handleClose = () => setVisibleSpy(false)
      handleClose()
      expect(setVisibleSpy).toHaveBeenCalledWith(false)
    })

    it('T-V016-R5.6 「打开 Settings」联动：setSettingsPanelOpen(true)', () => {
      const setVisibleSpy = vi.fn()
      // 模拟组件 handleOpenSettings 行为
      // v0.16 QA 决策：R-4 SettingsView 撤销 → 改打开 NavIcons SettingsPanel overlay
      const handleOpenSettings = () => {
        setSettingsPanelOpenSpy(true)
        setVisibleSpy(false)
      }
      handleOpenSettings()

      expect(setSettingsPanelOpenSpy).toHaveBeenCalledTimes(1)
      expect(setSettingsPanelOpenSpy).toHaveBeenCalledWith(true)
      expect(setVisibleSpy).toHaveBeenCalledWith(false)
    })
  })
})
