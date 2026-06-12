/**
 * 集成测试：vault IPC（v0.16 节点 M-2，req-063）
 *
 * 覆盖 technical.md「测试清单 · 集成测试」中 I1 ~ I4：
 *   T-V016-I1 vault:get-config 完整 4 字段
 *   T-V016-I2 vault:set-config 触发广播
 *   T-V016-I3 vault:pick-folder mock 选定
 *   T-V016-I4 vault:pick-folder 用户取消
 *
 * 测试策略：mock electron 模块（ipcMain / BrowserWindow / dialog / app），
 * 验证 registerVaultIpc 把 4 个 channel 都注册到 ipcMain.handle，并模拟
 * renderer 调用拿到正确返回值 + 广播事件。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const TMP_DIR = path.join(os.tmpdir(), `wb-vault-ipc-test-${process.pid}-${Date.now()}`)

// ─── electron mock：捕获 ipcMain.handle 注册的 channel 与 handler 函数 ──────

type IpcHandler = (event: unknown, args?: unknown) => unknown
const _ipcHandlers = new Map<string, IpcHandler>()
const _sentMessages: { winId: number; channel: string; payload: unknown }[] = []

let _dialogResult: { canceled: boolean; filePaths: string[] } = {
  canceled: false,
  filePaths: ['/picked/path'],
}

vi.mock('electron', () => {
  const fakeWin = {
    id: 1,
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown) => {
        _sentMessages.push({ winId: 1, channel, payload })
      },
    },
  }
  return {
    ipcMain: {
      handle: (channel: string, handler: IpcHandler) => {
        _ipcHandlers.set(channel, handler)
      },
      eventNames: () => Array.from(_ipcHandlers.keys()),
    },
    BrowserWindow: {
      getAllWindows: () => [fakeWin],
      getFocusedWindow: () => fakeWin,
    },
    dialog: {
      showOpenDialog: async (..._args: unknown[]) => _dialogResult,
    },
    app: {
      getPath: (_name: string) => TMP_DIR,
    },
  }
})

let vault: typeof import('../vault')
let vaultStore: typeof import('../../store/vaultStore')

beforeEach(async () => {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const cfg = path.join(TMP_DIR, 'config.json')
  if (fs.existsSync(cfg)) fs.unlinkSync(cfg)
  _ipcHandlers.clear()
  _sentMessages.length = 0
  _dialogResult = { canceled: false, filePaths: ['/picked/path'] }

  if (!vaultStore) vaultStore = await import('../../store/vaultStore')
  if (!vault) vault = await import('../vault')
  vaultStore.__setStoreOptionsForTesting({ cwd: TMP_DIR, projectName: 'wb-test' })

  vault.registerVaultIpc()
})

afterEach(() => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('M-2 channel 注册', () => {
  it('注册了 vault:get-config / set-config / pick-folder 三个 invoke channel', () => {
    expect(_ipcHandlers.has('vault:get-config')).toBe(true)
    expect(_ipcHandlers.has('vault:set-config')).toBe(true)
    expect(_ipcHandlers.has('vault:pick-folder')).toBe(true)
  })
})

describe('T-V016-I1 vault:get-config 完整 4 字段', () => {
  it('返回完整 schema 含 __fallbackInfo 边带字段', async () => {
    vaultStore.setVaultConfig({
      vaultRoot: '/my/vault',
      qaSubdir: 'Q',
      projectsSubdir: 'P',
    })
    const handler = _ipcHandlers.get('vault:get-config')!
    const result = (await handler({}, undefined)) as Record<string, unknown>
    expect(result.vaultRoot).toBe('/my/vault')
    expect(result.qaSubdir).toBe('Q')
    expect(result.projectsSubdir).toBe('P')
    expect(result.hasShownFirstLaunchToast).toBe(false)
    expect(result.__fallbackInfo).toEqual({ used: false, reason: '' })
  })
})

describe('T-V016-I2 vault:set-config 触发广播', () => {
  it('partial merge + 广播 vault:config-changed 给所有 BrowserWindow', async () => {
    const handler = _ipcHandlers.get('vault:set-config')!
    const result = (await handler({}, { vaultRoot: '/new/v' })) as Record<string, unknown>
    expect(result.vaultRoot).toBe('/new/v')
    expect(result.qaSubdir).toBe('QA')
    // 广播一次
    const broadcasts = _sentMessages.filter((m) => m.channel === 'vault:config-changed')
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0].payload).toMatchObject({
      config: expect.objectContaining({ vaultRoot: '/new/v' }),
    })
  })

  it('连续 partial 触发两次广播', async () => {
    const handler = _ipcHandlers.get('vault:set-config')!
    await handler({}, { vaultRoot: '/v1' })
    await handler({}, { qaSubdir: 'q-new' })
    const broadcasts = _sentMessages.filter((m) => m.channel === 'vault:config-changed')
    expect(broadcasts).toHaveLength(2)
    expect((broadcasts[1].payload as { config: { qaSubdir: string } }).config.qaSubdir).toBe('q-new')
    expect((broadcasts[1].payload as { config: { vaultRoot: string } }).config.vaultRoot).toBe('/v1')
  })
})

describe('T-V016-I3 vault:pick-folder 选定路径', () => {
  it('返回 dialog filePaths[0]', async () => {
    _dialogResult = { canceled: false, filePaths: ['/user/selected'] }
    const handler = _ipcHandlers.get('vault:pick-folder')!
    const result = await handler({}, { title: '选择 Vault' })
    expect(result).toBe('/user/selected')
  })

  it('不传 title 也能工作（用默认）', async () => {
    _dialogResult = { canceled: false, filePaths: ['/default-title-test'] }
    const handler = _ipcHandlers.get('vault:pick-folder')!
    const result = await handler({}, undefined)
    expect(result).toBe('/default-title-test')
  })

  it('选定不会写 store（仅返回路径）', async () => {
    _dialogResult = { canceled: false, filePaths: ['/some/path'] }
    const handler = _ipcHandlers.get('vault:pick-folder')!
    await handler({}, undefined)
    expect(vaultStore.getVaultConfig().vaultRoot).toBe('')
  })
})

describe('T-V016-I4 vault:pick-folder 用户取消', () => {
  it('canceled = true 时返回 null', async () => {
    _dialogResult = { canceled: true, filePaths: [] }
    const handler = _ipcHandlers.get('vault:pick-folder')!
    const result = await handler({}, undefined)
    expect(result).toBeNull()
  })

  it('canceled = false 但 filePaths 为空时也返回 null', async () => {
    _dialogResult = { canceled: false, filePaths: [] }
    const handler = _ipcHandlers.get('vault:pick-folder')!
    const result = await handler({}, undefined)
    expect(result).toBeNull()
  })
})

describe('错误处理', () => {
  it('vault:set-config 抛错时返回有意义的错误信息', () => {
    // 通过暂时破坏 store 实例触发错误（重置后未注入 options 会需 projectName）
    vaultStore.__setStoreOptionsForTesting(null)
    const handler = _ipcHandlers.get('vault:set-config')!
    // handler 是同步抛出（因为内部 setVaultConfig 同步），expect sync throw
    expect(() => handler({}, { vaultRoot: '/x' })).toThrow(/vault config write failed/)
  })
})
