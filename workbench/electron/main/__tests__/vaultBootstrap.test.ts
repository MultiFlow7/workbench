/**
 * 单元测试：vaultBootstrap（v0.16 节点 M-4 + M-5，req-063）
 *
 * 覆盖 technical.md「测试清单 · 首次启动场景测试」中 S1 ~ S6：
 *   T-V016-S1 场景 A · electron-store 已有 vaultRoot → 不触碰文件系统
 *   T-V016-S2 场景 B · 仅 .env.local → migrateFromEnv 触发
 *   T-V016-S3 场景 C · ~/Workbench-Vault 已存在 → 引用 + 补建子目录
 *   T-V016-S4 场景 D · 全新安装 → 创建并设置 triggerSource
 *   T-V016-S5 场景 D fallback → mkdir 失败时 fallback 到 userData
 *   T-V016-S6 条件来源标记隔离 → A/B/C 保持 null
 *
 * 测试策略：mock os.homedir + electron app；用临时 tmp 目录模拟 homedir，
 * 通过 fs 操作精确控制每个场景的初始条件。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const TEST_ROOT = path.join(os.tmpdir(), `wb-vault-boot-${process.pid}-${Date.now()}`)
const FAKE_HOME = path.join(TEST_ROOT, 'home')
const FAKE_USER_DATA = path.join(TEST_ROOT, 'userData')

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return FAKE_USER_DATA
      return FAKE_USER_DATA
    },
  },
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    default: { ...actual, homedir: () => FAKE_HOME },
    homedir: () => FAKE_HOME,
    tmpdir: actual.tmpdir,
  }
})

let vaultStore: typeof import('../../store/vaultStore')
let vaultBootstrap: typeof import('../vaultBootstrap')

const ORIGINAL_ENV = { ...process.env }

beforeEach(async () => {
  fs.mkdirSync(TEST_ROOT, { recursive: true })
  fs.mkdirSync(FAKE_HOME, { recursive: true })
  fs.mkdirSync(FAKE_USER_DATA, { recursive: true })

  vi.resetModules()
  vaultStore = await import('../../store/vaultStore')
  vaultBootstrap = await import('../vaultBootstrap')
  vaultStore.__setStoreOptionsForTesting({ cwd: FAKE_USER_DATA, projectName: 'wb-test' })
  vaultBootstrap.__resetVaultBootstrapForTesting()

  // 清空 env
  delete process.env.VITE_VAULT_ROOT
  delete process.env.VITE_VAULT_QA_PATH
  delete process.env.VITE_VAULT_PROJECTS_PATH
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  try {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('T-V016-S1 场景 A · electron-store 已有', () => {
  it('vaultRoot 非空时直接 return，不触碰文件系统', async () => {
    vaultStore.setVaultConfig({
      vaultRoot: '/already/configured',
      hasShownFirstLaunchToast: true,
    })
    const defaultRoot = path.join(FAKE_HOME, 'Workbench-Vault')
    expect(fs.existsSync(defaultRoot)).toBe(false)

    await vaultBootstrap.ensureDefaultVault()

    expect(vaultStore.getVaultConfig().vaultRoot).toBe('/already/configured')
    expect(fs.existsSync(defaultRoot)).toBe(false) // 没有创建文件夹
    expect(vaultBootstrap.getLastTriggerSource()).toBe(null) // S6 隔离验证
    expect(vaultBootstrap.getLastFallbackInfo().used).toBe(false)
  })
})

describe('T-V016-S2 场景 B · 仅 .env.local', () => {
  it('vaultRoot 为空 + env 三个变量都有 → 迁移三字段', async () => {
    process.env.VITE_VAULT_ROOT = '/env/root'
    process.env.VITE_VAULT_QA_PATH = '/env/qa-abs'
    process.env.VITE_VAULT_PROJECTS_PATH = '/env/proj-abs'

    await vaultBootstrap.ensureDefaultVault()

    const cfg = vaultStore.getVaultConfig()
    expect(cfg.vaultRoot).toBe('/env/root')
    expect(cfg.qaSubdir).toBe('/env/qa-abs')
    expect(cfg.projectsSubdir).toBe('/env/proj-abs')
    expect(cfg.hasShownFirstLaunchToast).toBe(false)
    expect(vaultBootstrap.getLastTriggerSource()).toBe(null) // S6 场景 B 不设 triggerSource
  })

  it('仅 env root 时，qaSubdir / projectsSubdir 保留默认', async () => {
    process.env.VITE_VAULT_ROOT = '/env/root2'
    await vaultBootstrap.ensureDefaultVault()
    const cfg = vaultStore.getVaultConfig()
    expect(cfg.vaultRoot).toBe('/env/root2')
    expect(cfg.qaSubdir).toBe('QA')
    expect(cfg.projectsSubdir).toBe('Projects')
  })
})

describe('T-V016-S3 场景 C · ~/Workbench-Vault 已存在', () => {
  it('store 空 + 默认目录存在 → 引用并补建 QA/Projects 子目录', async () => {
    const defaultRoot = path.join(FAKE_HOME, 'Workbench-Vault')
    fs.mkdirSync(defaultRoot, { recursive: true })

    await vaultBootstrap.ensureDefaultVault()

    const cfg = vaultStore.getVaultConfig()
    expect(cfg.vaultRoot).toBe(defaultRoot)
    expect(fs.existsSync(path.join(defaultRoot, 'QA'))).toBe(true)
    expect(fs.existsSync(path.join(defaultRoot, 'Projects'))).toBe(true)
    expect(vaultBootstrap.getLastTriggerSource()).toBe(null) // S6 场景 C 不设 triggerSource
  })

  it('既有用户文件不被覆盖（mkdir recursive 是 no-op）', async () => {
    const defaultRoot = path.join(FAKE_HOME, 'Workbench-Vault')
    const qaDir = path.join(defaultRoot, 'QA')
    fs.mkdirSync(qaDir, { recursive: true })
    fs.writeFileSync(path.join(qaDir, 'existing.md'), 'user content')

    await vaultBootstrap.ensureDefaultVault()

    expect(fs.readFileSync(path.join(qaDir, 'existing.md'), 'utf-8')).toBe('user content')
  })
})

describe('T-V016-S4 场景 D · 全新安装', () => {
  it('store 空 + 默认目录不存在 → 创建目录、设置 vaultRoot、置 triggerSource', async () => {
    const defaultRoot = path.join(FAKE_HOME, 'Workbench-Vault')
    expect(fs.existsSync(defaultRoot)).toBe(false)

    await vaultBootstrap.ensureDefaultVault()

    expect(fs.existsSync(defaultRoot)).toBe(true)
    expect(fs.existsSync(path.join(defaultRoot, 'QA'))).toBe(true)
    expect(fs.existsSync(path.join(defaultRoot, 'Projects'))).toBe(true)
    expect(vaultStore.getVaultConfig().vaultRoot).toBe(defaultRoot)
    expect(vaultBootstrap.getLastTriggerSource()).toBe('fresh-install')
    expect(vaultBootstrap.getLastFallbackInfo().used).toBe(false)
    expect(vaultStore.getVaultConfig().hasShownFirstLaunchToast).toBe(false)
  })
})

describe('T-V016-S5 场景 D fallback', () => {
  it('mkdir homedir 失败 → fallback 到 userData', async () => {
    // 通过把 FAKE_HOME 设为只读触发 EACCES：在 FAKE_HOME 下放一个同名文件
    // (Workbench-Vault) 而非目录，让 mkdirSync recursive 收到 ENOTDIR/EEXIST
    // 改用更稳定的方法：把 FAKE_HOME 改为指向一个文件而非目录，mkdir 必失败。
    const blockingFile = path.join(FAKE_HOME, 'Workbench-Vault')
    fs.writeFileSync(blockingFile, 'i am a file not a dir')

    const userDataVault = path.join(FAKE_USER_DATA, 'Workbench-Vault')

    await vaultBootstrap.ensureDefaultVault()

    // dirExists 检测到 blockingFile 不是 dir → fall through 条件 3 → 进条件 4
    // mkdir(/path/to/blockingFile) 因为已存在为文件 → 抛 EEXIST 或 ENOTDIR
    const cfg = vaultStore.getVaultConfig()
    expect(cfg.vaultRoot).toBe(userDataVault)
    expect(vaultBootstrap.getLastTriggerSource()).toBe('fresh-install')
    expect(vaultBootstrap.getLastFallbackInfo().used).toBe(true)
    expect(vaultBootstrap.getLastFallbackInfo().reason).toMatch(/homedir mkdir failed:/)
  })
})

describe('T-V016-S6 条件来源标记隔离', () => {
  it('场景 A/B/C 启动后 lastVaultTriggerSource 保持 null', async () => {
    // 场景 A
    vaultStore.setVaultConfig({ vaultRoot: '/x' })
    vaultBootstrap.__resetVaultBootstrapForTesting()
    await vaultBootstrap.ensureDefaultVault()
    expect(vaultBootstrap.getLastTriggerSource()).toBe(null)
  })
})

describe('cwd 同步（M-4 §过渡策略）', () => {
  it('writeVaultRoot 触发 syncCwdToVaultRoot', async () => {
    let cwdSet: string | null = null
    let persistedSet: string | null = null
    vaultBootstrap.setWorkspaceSyncFns({
      getCurrentCwd: () => '/old/cwd',
      setWorkspaceCwd: (c: string) => { cwdSet = c },
      setPersistedCwd: (c: string) => { persistedSet = c },
    })
    process.env.VITE_VAULT_ROOT = '/env/root-sync'
    await vaultBootstrap.ensureDefaultVault()
    expect(cwdSet).toBe('/env/root-sync')
    expect(persistedSet).toBe('/env/root-sync')
  })

  it('cwd 已等于 vaultRoot 时不重复 set', async () => {
    let cwdSetCount = 0
    vaultBootstrap.setWorkspaceSyncFns({
      getCurrentCwd: () => '/env/same',
      setWorkspaceCwd: () => { cwdSetCount += 1 },
      setPersistedCwd: () => {},
    })
    process.env.VITE_VAULT_ROOT = '/env/same'
    await vaultBootstrap.ensureDefaultVault()
    expect(cwdSetCount).toBe(0)
  })
})
