/**
 * settingsKeys — main 进程侧 settings.apiKeys 反查工具（v0.15.1 P5 r14）
 *
 * renderer 的 settingsSlice.ts 通过 write_settings IPC 把 apiKeys 数组持久化到
 * ~/.workbench/settings.json，结构与 StoredApiKey 一致：
 *   { id, label, key, baseUrl?, models[] }
 *
 * agent:start handler 启动 LocalRunner / RemoteRunner 之前，
 * 需要按 model 名反查对应的 key + baseUrl 注入到 SDKBridge 的 env，
 * 因为 claude CLI 子进程不继承 renderer 的 localStorage / Zustand state。
 *
 * 本模块独立于 electron-store / Zustand —— 直接读 settings.json 文件，
 * 单一职责、可单元测试（不依赖 Electron 运行时）。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export interface MainStoredApiKey {
  id: string
  label: string
  key: string
  baseUrl?: string
  models: string[]
}

/**
 * 默认 settings 文件路径（~/.workbench/settings.json）。
 * 与 electron/ipc/handlers.ts 中 read_settings / write_settings 完全一致。
 */
export function getSettingsFilePath(): string {
  return path.join(os.homedir(), '.workbench', 'settings.json')
}

/**
 * 从 settings 文件读取 apiKeys 数组。
 * 文件不存在 / 内容损坏时返回 []，不抛错。
 */
export function readApiKeysFromDisk(filePath?: string): MainStoredApiKey[] {
  const target = filePath ?? getSettingsFilePath()
  try {
    if (!fs.existsSync(target)) return []
    const raw = fs.readFileSync(target, 'utf-8')
    const parsed = JSON.parse(raw) as { apiKeys?: MainStoredApiKey[] }
    if (!Array.isArray(parsed.apiKeys)) return []
    // 防御性补齐 models 字段
    return parsed.apiKeys.map((k) => ({
      ...k,
      models: Array.isArray(k.models) ? k.models : [],
    }))
  } catch {
    return []
  }
}

/**
 * 按 model 名找到匹配的 key 条目。
 *
 * 优先级（与 renderer 端 findKeyForModel 对齐）：
 * 1. 完全匹配 / 前缀匹配（大小写不敏感）
 * 2. models 列表为空的兜底条目（"全模型通用 key"）
 * 3. 第一条 apiKey（最弱兜底）
 *
 * 找不到任何 apiKey 时返回 undefined（调用方应抛清晰错误，让用户去配置）。
 */
export function findKeyForModel(
  keys: MainStoredApiKey[],
  model: string,
): MainStoredApiKey | undefined {
  if (keys.length === 0) return undefined
  const lm = model.toLowerCase()
  return (
    keys.find((k) =>
      k.models.some((m) => {
        const lmm = m.toLowerCase()
        return lm === lmm || lm.startsWith(lmm)
      }),
    ) ??
    keys.find((k) => k.models.length === 0) ??
    keys[0]
  )
}
