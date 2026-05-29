/**
 * 主进程持久化存储（v0.15 节点 1.4）
 *
 * 使用 electron-store 持久化工作目录（workspace.cwd）。
 * 应用重启后自动从 store 恢复 cwd；store 为空时由 main process 触发 dialog。
 *
 * 文件位置：`<app.getPath('userData')>/config.json`，由 electron-store 自动管理。
 *
 * 设计原则：
 * - main 端唯一持有 electron-store 实例（renderer 不直接访问）
 * - 提供语义化 get/set 函数，避免到处 import Store
 * - 暴露同步 API（electron-store 本身是同步的，包装为同步函数即可）
 */

import Store from 'electron-store'

type Schema = {
  'workspace.cwd': string
}

let _store: Store<Schema> | null = null

function getStore(): Store<Schema> {
  if (!_store) {
    _store = new Store<Schema>({
      // electron-store v11 默认 file = config.json
      // schema 仅用于类型推断与默认值，不做严格校验
      defaults: {
        'workspace.cwd': '',
      },
    })
  }
  return _store
}

/**
 * 获取持久化的工作目录路径。
 * 未设置或为空字符串时返回 null（main process 据此判断是否触发首次 dialog）。
 */
export function getPersistedCwd(): string | null {
  const cwd = getStore().get('workspace.cwd', '')
  return cwd && cwd.length > 0 ? cwd : null
}

/**
 * 持久化工作目录路径。
 * 由 dialog:pickFolder handler 在用户选定后调用。
 */
export function setPersistedCwd(cwd: string): void {
  getStore().set('workspace.cwd', cwd)
}
