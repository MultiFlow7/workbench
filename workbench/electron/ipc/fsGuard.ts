/**
 * fs IPC 路径越界保护工具（v0.15 节点 1.3）
 *
 * 独立模块，不依赖 electron，可在单元测试环境中直接导入。
 *
 * 设计原则：
 * - 所有路径用 path.resolve 规范化，消除 ../ 等相对成分
 * - 目标路径必须以 workspaceCwd + path.sep 为前缀，或与 cwd 完全相同
 * - 越界时抛出 EPERM 错误，不执行任何 IO
 */

import { resolve, sep } from 'node:path'

/**
 * 工作区 cwd 存储（由 handlers.ts 管理）。
 * 通过 get/set 函数访问，避免循环依赖。
 */
let _workspaceCwd: string = ''

export function getWorkspaceCwd(): string {
  return _workspaceCwd
}

export function setWorkspaceCwd(cwd: string): void {
  _workspaceCwd = resolve(cwd)
}

/**
 * 校验目标路径是否在 workspaceCwd 范围内。
 * 越界时抛出 EPERM 错误，不执行任何 IO。
 *
 * @param targetPath 来自 renderer 的路径（可能含 ../ 等相对成分）
 * @param cwd 工作区目录（默认使用模块内 _workspaceCwd）
 * @returns 规范化后的绝对路径
 *
 * @example
 * setWorkspaceCwd('<workspace>')
 * assertInWorkspace('<workspace>/notes/foo.md') // OK
 * assertInWorkspace('<workspace>')              // OK（等于 cwd 自身）
 * assertInWorkspace('../../../etc/passwd')                 // throws EPERM
 * assertInWorkspace('<outside-workspace>')                 // throws EPERM
 */
export function assertInWorkspace(targetPath: string, cwd?: string): string {
  const workspace = cwd ?? _workspaceCwd
  if (!workspace) {
    throw Object.assign(
      new Error('EPERM: workspace cwd is not set'),
      { code: 'EPERM' }
    )
  }
  const resolved = resolve(targetPath)
  // 允许路径完全等于 cwd（列目录自身）或以 cwd + sep 开头（子路径）
  if (resolved !== workspace && !resolved.startsWith(workspace + sep)) {
    throw Object.assign(
      new Error(`EPERM: path out of workspace: ${targetPath}`),
      { code: 'EPERM' }
    )
  }
  return resolved
}
