/**
 * buildForkMessages 单元测试（v0.15 节点 4.10 验证）
 *
 * 覆盖 3 个场景：
 *   A. 3 轮工具调用 + 无干预 → 所有 tool_use 有匹配 tool_result
 *   B. 含 1 次干预（第 2 轮后）→ 干预插在第 2 轮 tool_result 后、第 3 轮 assistant 前
 *   C. 路径含旧 atom（steps === null）→ hasOldAtom === true，旧 atom 单条 assistant text
 */

import { describe, it, expect } from 'vitest'
import { buildForkMessages } from '../buildForkMessages'
import type { ParsedAtom } from '../atomParser'

// ─── 测试 fixture 构造工具 ─────────────────────────────────────────────────

function makeAtom(
  id: string,
  q: string,
  response: string,
  steps: ParsedAtom['steps'],
  interventions: ParsedAtom['interventions'] = [],
): ParsedAtom {
  return {
    frontmatter: {
      id,
      prev: [],
      children: [],
      summary: '',
      timestamp: '2026-05-29T00:00:00Z',
    },
    q,
    steps,
    interventions,
    response,
  }
}

// ─── 测试 A：3 轮工具调用，无干预 ───────────────────────────────────────────

describe('buildForkMessages - 测试 A：3 轮工具调用无干预', () => {
  const atom = makeAtom('a1', '执行三步流程', '完成。', [
    { thinking: '第一步', tools: [{ name: 'bash', input: 'ls', result: 'foo', status: 'done' }] },
    { thinking: '第二步', tools: [{ name: 'bash', input: 'pwd', result: '/tmp', status: 'done' }] },
    { thinking: '第三步', tools: [{ name: 'bash', input: 'whoami', result: 'morgan', status: 'done' }] },
  ])

  it('所有 tool_use 有匹配 tool_result', () => {
    const { messages, hasOldAtom } = buildForkMessages([atom])
    expect(hasOldAtom).toBe(false)

    // 收集所有 tool_use id 和 tool_result tool_use_id
    const toolUseIds: string[] = []
    const toolResultIds: string[] = []
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.id) toolUseIds.push(block.id)
        if (block.type === 'tool_result' && block.tool_use_id) toolResultIds.push(block.tool_use_id)
      }
    }
    expect(toolUseIds.length).toBe(3)
    expect(toolResultIds.length).toBe(3)
    // 一一对应（顺序相同）
    expect(toolResultIds).toEqual(toolUseIds)
  })

  it('消息顺序：user(q) → assistant(r1) → user(tr1) → assistant(r2) → user(tr2) → assistant(r3) → user(tr3) → assistant(text)', () => {
    const { messages } = buildForkMessages([atom])
    // 8 条消息
    expect(messages.length).toBe(8)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
    expect(messages[2].role).toBe('user')
    expect(messages[3].role).toBe('assistant')
    expect(messages[4].role).toBe('user')
    expect(messages[5].role).toBe('assistant')
    expect(messages[6].role).toBe('user')
    expect(messages[7].role).toBe('assistant')

    // 最后一条 assistant 包含 text "完成。"
    const last = messages[7]
    expect(Array.isArray(last.content)).toBe(true)
    if (Array.isArray(last.content)) {
      expect(last.content.some((b) => b.type === 'text' && b.text === '完成。')).toBe(true)
    }
  })
})

// ─── 测试 B：含 1 次干预（第 2 轮后）─────────────────────────────────────────

describe('buildForkMessages - 测试 B：含干预', () => {
  const atom = makeAtom(
    'b1',
    '完整流程',
    '完成。',
    [
      { thinking: 'r1', tools: [{ name: 'bash', input: 'a', result: 'A', status: 'done' }] },
      { thinking: 'r2', tools: [{ name: 'bash', input: 'b', result: 'B', status: 'done' }] },
      { thinking: 'r3', tools: [{ name: 'bash', input: 'c', result: 'C', status: 'done' }] },
    ],
    [{ afterRound: 2, text: '换一种方式', timestamp: '2026-05-29T00:01:00Z' }],
  )

  it('干预出现在第 2 轮 tool_result 之后、第 3 轮 assistant 之前', () => {
    const { messages } = buildForkMessages([atom])

    // 找到干预消息的位置（content 为 '换一种方式' 的 user 消息）
    const intvIdx = messages.findIndex(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content === '换一种方式',
    )
    expect(intvIdx).toBeGreaterThan(0)

    // 干预之前最近的 user 消息应为第 2 轮 tool_result（含 tool_use_id 末尾 _r1_*）
    const prevUserIdx = intvIdx - 1
    const prev = messages[prevUserIdx]
    expect(prev.role).toBe('user')
    expect(Array.isArray(prev.content)).toBe(true)
    if (Array.isArray(prev.content)) {
      // 第 2 轮 = ri=1
      expect(
        prev.content.every(
          (b) => b.type === 'tool_result' && (b.tool_use_id ?? '').includes('_r1_'),
        ),
      ).toBe(true)
    }

    // 干预之后最近的 assistant 消息应包含 r3 thinking
    const nextAssistantIdx = messages.findIndex(
      (m, i) => i > intvIdx && m.role === 'assistant',
    )
    expect(nextAssistantIdx).toBeGreaterThan(intvIdx)
    const next = messages[nextAssistantIdx]
    if (Array.isArray(next.content)) {
      expect(next.content.some((b) => b.type === 'thinking' && b.thinking === 'r3')).toBe(true)
    }
  })
})

// ─── 测试 C：路径含旧 atom ─────────────────────────────────────────────────

describe('buildForkMessages - 测试 C：路径含旧 atom', () => {
  const oldAtom = makeAtom('legacy', '你好', '你好，旧 atom 回复。', null)
  const newAtom = makeAtom('new', '继续', '已继续。', [
    { thinking: 'r1', tools: [{ name: 'bash', input: 'x', result: 'X', status: 'done' }] },
  ])

  it('hasOldAtom === true 且旧 atom 体现为单条 assistant text', () => {
    const { messages, hasOldAtom } = buildForkMessages([oldAtom, newAtom])
    expect(hasOldAtom).toBe(true)

    // 旧 atom 对应 messages[0]=user("你好"), messages[1]=assistant(text "你好，旧 atom 回复。")
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('你好')
    expect(messages[1].role).toBe('assistant')
    expect(Array.isArray(messages[1].content)).toBe(true)
    if (Array.isArray(messages[1].content)) {
      expect(messages[1].content.length).toBe(1)
      expect(messages[1].content[0].type).toBe('text')
      expect(messages[1].content[0].text).toBe('你好，旧 atom 回复。')
      expect(messages[1].content[0].isOldAtom).toBe(true)
    }

    // 新 atom 部分应正常重建：user(q) → assistant(r1) → user(tool_result) → assistant(text)
    expect(messages[2].role).toBe('user')
    expect(messages[2].content).toBe('继续')
    expect(messages[3].role).toBe('assistant')
    expect(messages[4].role).toBe('user')
    expect(messages[5].role).toBe('assistant')
    if (Array.isArray(messages[5].content)) {
      expect(messages[5].content.some((b) => b.type === 'text' && b.text === '已继续。')).toBe(true)
    }
  })
})
