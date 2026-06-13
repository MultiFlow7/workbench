/**
 * runnerFactory — AgentRunner 工厂（v0.15 节点 6.4）
 *
 * 根据用户选择的部署位置（本地 / 服务器）
 * 创建对应的 AgentRunner 实例。
 */
import { BrowserWindow } from 'electron'
import { LocalRunner } from './LocalRunner'
import { RemoteRunner, type ServerConfig } from './RemoteRunner'
import type { AgentRunner } from './AgentRunner'

export type DeployLocation = 'local' | 'remote'

export function createRunner(
  location: DeployLocation,
  win: BrowserWindow,
  serverConfig?: ServerConfig
): AgentRunner {
  if (location === 'remote') {
    if (!serverConfig) throw new Error('serverConfig required for remote runner')
    return new RemoteRunner(win, serverConfig)
  }
  return new LocalRunner(win)
}
