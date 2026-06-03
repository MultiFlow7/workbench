/**
 * 单元测试：settingsKeys（v0.15.1 P5 r14）
 *
 * 验证 main 进程侧的 API key 反查逻辑：
 *   - readApiKeysFromDisk: 文件不存在 / 损坏 / 字段缺失 都不抛错，返回 []
 *   - findKeyForModel: 完全匹配 > 前缀匹配 > models 为空的兜底 > 第一条
 *
 * 这条链路是 v0.15.1 P5 修复的核心 — bug 是 SDKBridge 没注入 ANTHROPIC_API_KEY
 * 导致 claude CLI 子进程发不出消息，agent:start handler 通过本模块从 settings.json
 * 反查 key 后注入。任何回归都会让聊天功能直接挂掉，所以严格测覆盖。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  readApiKeysFromDisk,
  findKeyForModel,
  getSettingsFilePath,
  type MainStoredApiKey,
} from '../settingsKeys'

const TMP_DIR = path.join(os.tmpdir(), `wb-settings-test-${process.pid}-${Date.now()}`)
const TMP_FILE = path.join(TMP_DIR, 'settings.json')

beforeEach(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true })
})

afterEach(() => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true })
  } catch { /* ignore */ }
})

describe('getSettingsFilePath', () => {
  it('指向 ~/.workbench/settings.json', () => {
    expect(getSettingsFilePath()).toBe(path.join(os.homedir(), '.workbench', 'settings.json'))
  })
})

describe('readApiKeysFromDisk', () => {
  it('文件不存在时返回 []，不抛错', () => {
    const result = readApiKeysFromDisk(path.join(TMP_DIR, 'missing.json'))
    expect(result).toEqual([])
  })

  it('JSON 损坏时返回 []，不抛错', () => {
    fs.writeFileSync(TMP_FILE, '{ this is not valid json', 'utf-8')
    expect(readApiKeysFromDisk(TMP_FILE)).toEqual([])
  })

  it('apiKeys 字段缺失返回 []', () => {
    fs.writeFileSync(TMP_FILE, JSON.stringify({ cachingEnabled: true }), 'utf-8')
    expect(readApiKeysFromDisk(TMP_FILE)).toEqual([])
  })

  it('正常读取并补齐 models 字段', () => {
    const data = {
      apiKeys: [
        { id: 'a', label: '官方', key: 'sk-1', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-4-5'] },
        { id: 'b', label: 'sub2api', key: 'sk-2' }, // 故意缺 models
      ],
    }
    fs.writeFileSync(TMP_FILE, JSON.stringify(data), 'utf-8')
    const result = readApiKeysFromDisk(TMP_FILE)
    expect(result).toHaveLength(2)
    expect(result[0].models).toEqual(['claude-sonnet-4-5'])
    expect(result[1].models).toEqual([]) // 补齐空数组
    expect(result[1].label).toBe('sub2api')
  })
})

describe('findKeyForModel', () => {
  const keys: MainStoredApiKey[] = [
    { id: 'a', label: '官方', key: 'sk-1', models: ['claude-sonnet-4-5', 'claude-opus-4-7'] },
    { id: 'b', label: 'sub2api', key: 'sk-2', baseUrl: 'https://sub2api', models: ['gemini-2.5-pro'] },
    { id: 'c', label: '通用兜底', key: 'sk-3', models: [] },
  ]

  it('空数组返回 undefined', () => {
    expect(findKeyForModel([], 'claude-sonnet-4-5')).toBeUndefined()
  })

  it('完全匹配命中', () => {
    const hit = findKeyForModel(keys, 'claude-sonnet-4-5')
    expect(hit?.id).toBe('a')
  })

  it('大小写不敏感', () => {
    const hit = findKeyForModel(keys, 'CLAUDE-OPUS-4-7')
    expect(hit?.id).toBe('a')
  })

  it('前缀匹配（model 长名匹配 short 配置）', () => {
    // 配置里写 'claude-haiku-4-5'，调用方传 'claude-haiku-4-5-20251001'
    const ks: MainStoredApiKey[] = [
      { id: 'x', label: 'x', key: 'k', models: ['claude-haiku-4-5'] },
    ]
    const hit = findKeyForModel(ks, 'claude-haiku-4-5-20251001')
    expect(hit?.id).toBe('x')
  })

  it('未命中具体 model 时落到 models 为空的通用兜底条目', () => {
    const hit = findKeyForModel(keys, 'gpt-4-未配置')
    expect(hit?.id).toBe('c') // 通用兜底
  })

  it('既没有具体匹配也没有空 models 条目时，回退到第一条', () => {
    const ks: MainStoredApiKey[] = [
      { id: 'first', label: 'a', key: 'k1', models: ['claude-sonnet-4-5'] },
      { id: 'second', label: 'b', key: 'k2', models: ['claude-opus-4-7'] },
    ]
    const hit = findKeyForModel(ks, '完全没配的-model')
    expect(hit?.id).toBe('first')
  })

  it('保留 baseUrl（让 agent:start handler 注入到 env）', () => {
    const hit = findKeyForModel(keys, 'gemini-2.5-pro')
    expect(hit?.baseUrl).toBe('https://sub2api')
    expect(hit?.key).toBe('sk-2')
  })
})
