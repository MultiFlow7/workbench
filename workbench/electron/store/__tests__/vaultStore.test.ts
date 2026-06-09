/**
 * 单元测试：vaultStore（v0.16 节点 M-1，req-063）
 *
 * 覆盖 technical.md「测试清单 · 单元测试」中 main+CI 部分的 U1 ~ U4：
 *   T-V016-U1 默认值返回完整 4 字段
 *   T-V016-U2 partial merge 不丢字段
 *   T-V016-U3 isVaultConfigured vaultRoot 为空 / 非空两态
 *   T-V016-U4 markFirstLaunchToastShown 置位
 *
 * 测试策略：
 *   通过 vi.mock 把 electron-store 的 userData 路径重定向到 tmp 目录，
 *   每个 test 用独立的 cwd（CWD env 影响 electron-store path resolution）。
 *   electron-store v11 默认 cwd 取自 app.getPath('userData')——在测试环境
 *   下 app 模块未启动，需要通过 mock 注入。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// electron-store 在 main 进程下从 electron 模块读 app.getPath('userData')；
// 单测环境下用 mock 把 app.getPath 重定向到独立 tmp 目录
const TMP_DIR = path.join(os.tmpdir(), `wb-vaultstore-test-${process.pid}-${Date.now()}`)

// 不 mock electron 模块——electron-store v11 仅在调用 .get/.set 时才查 app.getPath，
// 通过 __setStoreOptionsForTesting 注入 cwd + projectName 完全绕开 electron 模块依赖。
let vaultStore: typeof import('../vaultStore')

beforeEach(async () => {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  // 清空 config.json
  const cfg = path.join(TMP_DIR, 'config.json')
  if (fs.existsSync(cfg)) fs.unlinkSync(cfg)
  // 首次 import（vitest 模块缓存内，多 test 共用）
  if (!vaultStore) vaultStore = await import('../vaultStore')
  vaultStore.__setStoreOptionsForTesting({ cwd: TMP_DIR, projectName: 'wb-test' })
})

afterEach(() => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('T-V016-U1 vaultStore 默认值', () => {
  it('未写入任何 config 时返回完整 4 字段默认值', () => {
    const cfg = vaultStore.getVaultConfig()
    expect(cfg).toEqual({
      vaultRoot: '',
      qaSubdir: 'QA',
      projectsSubdir: 'Projects',
      hasShownFirstLaunchToast: false,
    })
  })
})

describe('T-V016-U2 vaultStore partial merge', () => {
  it('先写 vaultRoot 再写 qaSubdir，两个字段都保留', () => {
    vaultStore.setVaultConfig({ vaultRoot: '/tmp/v1' })
    vaultStore.setVaultConfig({ qaSubdir: 'Notes' })
    const cfg = vaultStore.getVaultConfig()
    expect(cfg.vaultRoot).toBe('/tmp/v1')
    expect(cfg.qaSubdir).toBe('Notes')
    expect(cfg.projectsSubdir).toBe('Projects')
    expect(cfg.hasShownFirstLaunchToast).toBe(false)
  })

  it('setVaultConfig 返回合并后的完整对象', () => {
    const merged = vaultStore.setVaultConfig({ vaultRoot: '/x' })
    expect(merged).toEqual({
      vaultRoot: '/x',
      qaSubdir: 'QA',
      projectsSubdir: 'Projects',
      hasShownFirstLaunchToast: false,
    })
  })

  it('连续 4 次 partial 后所有字段独立保留', () => {
    vaultStore.setVaultConfig({ vaultRoot: '/v' })
    vaultStore.setVaultConfig({ qaSubdir: 'qa-x' })
    vaultStore.setVaultConfig({ projectsSubdir: 'proj-x' })
    vaultStore.setVaultConfig({ hasShownFirstLaunchToast: true })
    expect(vaultStore.getVaultConfig()).toEqual({
      vaultRoot: '/v',
      qaSubdir: 'qa-x',
      projectsSubdir: 'proj-x',
      hasShownFirstLaunchToast: true,
    })
  })
})

describe('T-V016-U3 isVaultConfigured', () => {
  it('vaultRoot 为空返回 false', () => {
    expect(vaultStore.isVaultConfigured()).toBe(false)
  })

  it('vaultRoot 非空返回 true', () => {
    vaultStore.setVaultConfig({ vaultRoot: '/some/path' })
    expect(vaultStore.isVaultConfigured()).toBe(true)
  })
})

describe('T-V016-U4 markFirstLaunchToastShown', () => {
  it('调用后 hasShownFirstLaunchToast === true', () => {
    expect(vaultStore.getVaultConfig().hasShownFirstLaunchToast).toBe(false)
    vaultStore.markFirstLaunchToastShown()
    expect(vaultStore.getVaultConfig().hasShownFirstLaunchToast).toBe(true)
  })

  it('置位不影响其他字段', () => {
    vaultStore.setVaultConfig({ vaultRoot: '/a', qaSubdir: 'b' })
    vaultStore.markFirstLaunchToastShown()
    expect(vaultStore.getVaultConfig()).toEqual({
      vaultRoot: '/a',
      qaSubdir: 'b',
      projectsSubdir: 'Projects',
      hasShownFirstLaunchToast: true,
    })
  })
})

describe('migrateFromEnv', () => {
  const ORIGINAL_ENV = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('store 已有 vaultRoot 时不迁移（幂等）', () => {
    vaultStore.setVaultConfig({ vaultRoot: '/already-set' })
    process.env.VITE_VAULT_ROOT = '/env-root'
    const migrated = vaultStore.migrateFromEnv()
    expect(migrated).toBe(false)
    expect(vaultStore.getVaultConfig().vaultRoot).toBe('/already-set')
  })

  it('无 env 变量时不迁移', () => {
    delete process.env.VITE_VAULT_ROOT
    delete process.env.VITE_VAULT_QA_PATH
    delete process.env.VITE_VAULT_PROJECTS_PATH
    expect(vaultStore.migrateFromEnv()).toBe(false)
    expect(vaultStore.getVaultConfig().vaultRoot).toBe('')
  })

  it('仅 root + qa + proj 全有时迁移三字段', () => {
    process.env.VITE_VAULT_ROOT = '/env-root'
    process.env.VITE_VAULT_QA_PATH = '/abs/qa'
    process.env.VITE_VAULT_PROJECTS_PATH = '/abs/proj'
    const migrated = vaultStore.migrateFromEnv()
    expect(migrated).toBe(true)
    expect(vaultStore.getVaultConfig()).toEqual({
      vaultRoot: '/env-root',
      qaSubdir: '/abs/qa',
      projectsSubdir: '/abs/proj',
      hasShownFirstLaunchToast: false,
    })
  })

  it('仅有 root 时其他字段保留默认', () => {
    process.env.VITE_VAULT_ROOT = '/env-root'
    delete process.env.VITE_VAULT_QA_PATH
    delete process.env.VITE_VAULT_PROJECTS_PATH
    expect(vaultStore.migrateFromEnv()).toBe(true)
    const cfg = vaultStore.getVaultConfig()
    expect(cfg.vaultRoot).toBe('/env-root')
    expect(cfg.qaSubdir).toBe('QA')
    expect(cfg.projectsSubdir).toBe('Projects')
  })
})
