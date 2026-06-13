/**
 * 单元测试：fs IPC 路径越界保护（节点 1.3）
 *
 * 验证 assertInWorkspace 能正确拦截越界路径并抛出 EPERM。
 * 测试文件不依赖 electron，直接测试纯 Node.js 逻辑。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import path from 'node:path'
import { assertInWorkspace, setWorkspaceCwd, getWorkspaceCwd } from '../fsGuard'

const CWD = '/Users/testuser/workspace'

beforeEach(() => {
  setWorkspaceCwd(CWD)
})

// ── 正常路径（应通过）──────────────────────────────────────────────────────

describe('assertInWorkspace — 正常路径', () => {
  it('路径等于 cwd 自身（列目录场景）', () => {
    const result = assertInWorkspace(CWD)
    expect(result).toBe(CWD)
  })

  it('直接子文件', () => {
    const p = `${CWD}/notes.md`
    expect(assertInWorkspace(p)).toBe(p)
  })

  it('多级子目录', () => {
    const p = `${CWD}/a/b/c/deep.md`
    expect(assertInWorkspace(p)).toBe(p)
  })

  it('包含冗余斜杠但 resolve 后在 cwd 内', () => {
    const p = `${CWD}/a//b/c.md`
    expect(assertInWorkspace(p)).toBe(path.resolve(p))
  })

  it('包含当前目录 . 但 resolve 后在 cwd 内', () => {
    const p = `${CWD}/./notes/foo.md`
    expect(assertInWorkspace(p)).toBe(path.resolve(p))
  })

  it('从 cwd 出发再进入子目录（含 .. 但最终在范围内）', () => {
    const p = `${CWD}/a/../b/file.md`
    const resolved = path.resolve(p)
    expect(assertInWorkspace(p)).toBe(resolved)
    expect(resolved.startsWith(CWD + path.sep)).toBe(true)
  })
})

// ── 越界路径（应抛出 EPERM）──────────────────────────────────────────────────

describe('assertInWorkspace — 越界路径 → EPERM', () => {
  it('经典 path traversal：../../../etc/passwd', () => {
    expect(() => assertInWorkspace('../../../etc/passwd')).toThrow('EPERM')
  })

  it('绝对路径到系统目录 /etc/passwd', () => {
    expect(() => assertInWorkspace('/etc/passwd')).toThrow('EPERM')
  })

  it('父目录（cwd 的父）', () => {
    expect(() => assertInWorkspace('/Users/testuser')).toThrow('EPERM')
  })

  it('cwd 的前缀但不是子路径（前缀陷阱）', () => {
    // /Users/testuser/workspace-other 是 /Users/testuser/workspace 的字符串前缀
    // 但不是其子路径，应被拦截
    expect(() => assertInWorkspace('/Users/testuser/workspace-other/file.md')).toThrow('EPERM')
  })

  it('home 目录下的其他文件', () => {
    expect(() => assertInWorkspace('/Users/testuser/.ssh/id_rsa')).toThrow('EPERM')
  })

  it('完全不同的根路径 /tmp/evil', () => {
    expect(() => assertInWorkspace('/tmp/evil')).toThrow('EPERM')
  })

  it('通过 .. 逃逸到 cwd 外', () => {
    expect(() => assertInWorkspace(`${CWD}/../../.bashrc`)).toThrow('EPERM')
  })

  it('抛出的错误 code 为 EPERM', () => {
    try {
      assertInWorkspace('/etc/passwd')
      expect.fail('应抛出错误')
    } catch (e) {
      expect((e as NodeJS.ErrnoException).code).toBe('EPERM')
    }
  })

  it('错误消息包含原始路径', () => {
    const badPath = '/etc/passwd'
    try {
      assertInWorkspace(badPath)
      expect.fail('应抛出错误')
    } catch (e) {
      expect((e as Error).message).toContain(badPath)
    }
  })
})

// ── cwd 管理 ──────────────────────────────────────────────────────────────────

describe('setWorkspaceCwd / getWorkspaceCwd', () => {
  it('设置后 getWorkspaceCwd 返回 resolve 后的绝对路径', () => {
    setWorkspaceCwd('/some/path')
    expect(getWorkspaceCwd()).toBe('/some/path')
  })

  it('包含 .. 的路径被规范化', () => {
    setWorkspaceCwd('/Users/testuser/workspace/../workspace')
    expect(getWorkspaceCwd()).toBe('/Users/testuser/workspace')
  })

  it('更改 cwd 后，旧 cwd 下的路径变为越界', () => {
    setWorkspaceCwd('/Users/testuser/workspace')
    // 改成另一个工作区
    setWorkspaceCwd('/Users/testuser/other')
    // 原工作区路径现在越界
    expect(() => assertInWorkspace(`${CWD}/file.md`)).toThrow('EPERM')
    // 新工作区路径通过
    expect(assertInWorkspace('/Users/testuser/other/file.md')).toBe('/Users/testuser/other/file.md')
  })

  it('支持通过 cwd 参数覆盖（不改全局状态）', () => {
    setWorkspaceCwd(CWD)
    // 传入显式 cwd 覆盖
    const customCwd = '/custom/workspace'
    expect(assertInWorkspace(`${customCwd}/file.md`, customCwd)).toBe(`${customCwd}/file.md`)
    // 全局状态不变
    expect(getWorkspaceCwd()).toBe(CWD)
  })
})
