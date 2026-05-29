/**
 * atomParser 单元测试（v0.15 节点 4.7 验证）
 *
 * 覆盖 6 类样本：
 *   1. 有 Steps（基础）：1 轮 1 工具
 *   2. 无 Steps（旧 atom）：仅 Q + A，steps === null
 *   3. 含单次 Intervention
 *   4. 含多次 Intervention（### Intervention N）
 *   5. 多轮 Steps（≥3 轮）
 *   6. Steps 内嵌套代码块（代码块内的 ## / ### 不被误识别为 section 边界）
 */

import { describe, it, expect } from 'vitest'
import { parseAtom } from '../atomParser'

// ─── fixture 1: 有 Steps（基础）─────────────────────────────────────────────

const FIXTURE_BASIC_STEPS = `---
id: atom-001
prev: []
children: []
summary: 基础 Steps 样本
timestamp: '2026-05-29T10:00:00Z'
---

## Q
执行 ls 命令查看当前目录

## Steps
### Round 1
**Thinking**
用户需要查看目录内容，调用 bash 工具

**Tool: bash**
- Input: ls -la
- Result: total 8\\ndrwxr-xr-x 3 user user 4096 May 29 10:00 .

## A
当前目录只有一个隐藏的 . 项。
`

// ─── fixture 2: 无 Steps（旧 atom）──────────────────────────────────────────

const FIXTURE_LEGACY_NO_STEPS = `---
id: atom-legacy-002
prev: ['atom-001']
children: []
summary: v0.14 旧 atom 无 Steps
timestamp: '2026-05-20T08:30:00Z'
---

## Q
你好

## A
你好，有什么我可以帮你的吗？
`

// ─── fixture 3: 单次 Intervention ───────────────────────────────────────────

const FIXTURE_SINGLE_INTERVENTION = `---
id: atom-003
prev: []
children: []
summary: 单次干预样本
timestamp: '2026-05-29T11:00:00Z'
---

## Q
帮我处理一下这个数据集

## Steps
### Round 1
**Thinking**
先读取文件

**Tool: bash**
- Input: cat data.csv
- Result: id,name\\n1,alice

### Round 2
**Thinking**
继续解析

**Tool: bash**
- Input: head data.csv
- Result: ok

### Round 3
**Thinking**
完成

**Tool: bash**
- Input: wc -l data.csv
- Result: 1 data.csv

## Intervention
- 触发时机：Round 2 完成后
- 用户补充：换一种方式试试
- 时间戳：2026-05-29T11:05:00Z

## A
已完成处理。
`

// ─── fixture 4: 多次 Intervention ───────────────────────────────────────────

const FIXTURE_MULTI_INTERVENTION = `---
id: atom-004
prev: []
children: []
summary: 多次干预样本
timestamp: '2026-05-29T12:00:00Z'
---

## Q
继续处理

## Steps
### Round 1
**Thinking**
开始

**Tool: bash**
- Input: pwd
- Result: /tmp

### Round 2
**Thinking**
读文件

**Tool: bash**
- Input: ls
- Result: foo.txt

## Intervention
### Intervention 1
- 触发时机：Round 1 完成后
- 用户补充：先看一下 pwd
- 时间戳：2026-05-29T12:01:00Z

### Intervention 2
- 触发时机：Round 2 完成后
- 用户补充：再看 ls
- 时间戳：2026-05-29T12:02:00Z

## A
已完成。
`

// ─── fixture 5: 多轮（3 轮）────────────────────────────────────────────────

const FIXTURE_MULTI_ROUND = `---
id: atom-005
prev: []
children: []
summary: 三轮样本
timestamp: '2026-05-29T13:00:00Z'
---

## Q
跑一个完整流程

## Steps
### Round 1
**Thinking**
第一轮

**Tool: bash**
- Input: cmd1
- Result: out1

### Round 2
**Thinking**
第二轮

**Tool: read_file**
- Input: foo.txt
- Result: hello

### Round 3
**Thinking**
第三轮

**Tool: write_file**
- Input: bar.txt
- Result: ok

## A
三轮完成。
`

// ─── fixture 6: Steps 内嵌套代码块 ──────────────────────────────────────────
// 注意：代码块围栏（```）必须在行首才能被 splitTopSections 的 fence 检测识别，
// 这也是 serializeAtom 的标准写法。

const FIXTURE_NESTED_CODE_BLOCK = `---
id: atom-006
prev: []
children: []
summary: 嵌套代码块样本
timestamp: '2026-05-29T14:00:00Z'
---

## Q
看一下脚本

## Steps
### Round 1
**Thinking**
代码示例如下：

\`\`\`bash
## 这是一个 shell 注释，不应被解析为 section
### Round 99
**Tool: fake**
echo "hello"
\`\`\`

**Tool: bash**
- Input: cat script.sh
- Result: hello

## A
脚本输出已展示。
`

// ─── 测试 ──────────────────────────────────────────────────────────────────

describe('parseAtom', () => {
  it('1. 有 Steps（基础）：1 轮 1 工具', () => {
    const r = parseAtom(FIXTURE_BASIC_STEPS)
    expect(r.frontmatter.id).toBe('atom-001')
    expect(r.q).toContain('执行 ls')
    expect(r.steps).not.toBeNull()
    expect(r.steps!.length).toBe(1)
    expect(r.steps![0].tools.length).toBe(1)
    expect(r.steps![0].tools[0].name).toBe('bash')
    expect(r.steps![0].tools[0].input).toContain('ls -la')
    expect(r.response).toContain('只有一个隐藏的')
    expect(r.interventions).toEqual([])
  })

  it('2. 无 Steps（旧 atom）：steps === null', () => {
    const r = parseAtom(FIXTURE_LEGACY_NO_STEPS)
    expect(r.frontmatter.id).toBe('atom-legacy-002')
    expect(r.q).toBe('你好')
    expect(r.steps).toBeNull()
    expect(r.response).toContain('有什么我可以帮你')
    expect(r.interventions).toEqual([])
  })

  it('3. 含单次 Intervention：afterRound 正确', () => {
    const r = parseAtom(FIXTURE_SINGLE_INTERVENTION)
    expect(r.interventions.length).toBe(1)
    expect(r.interventions[0].afterRound).toBe(2)
    expect(r.interventions[0].text).toContain('换一种方式')
    expect(r.interventions[0].timestamp).toBe('2026-05-29T11:05:00Z')
    expect(r.steps!.length).toBe(3)
  })

  it('4. 含多次 Intervention：长度为 2', () => {
    const r = parseAtom(FIXTURE_MULTI_INTERVENTION)
    expect(r.interventions.length).toBe(2)
    expect(r.interventions[0].afterRound).toBe(1)
    expect(r.interventions[0].text).toContain('pwd')
    expect(r.interventions[1].afterRound).toBe(2)
    expect(r.interventions[1].text).toContain('ls')
  })

  it('5. 多轮（3 轮）：steps.length === 3', () => {
    const r = parseAtom(FIXTURE_MULTI_ROUND)
    expect(r.steps).not.toBeNull()
    expect(r.steps!.length).toBe(3)
    expect(r.steps![0].tools[0].name).toBe('bash')
    expect(r.steps![1].tools[0].name).toBe('read_file')
    expect(r.steps![2].tools[0].name).toBe('write_file')
  })

  it('6. Steps 内嵌套代码块：代码块内 ## / ### 不被误解析', () => {
    const r = parseAtom(FIXTURE_NESTED_CODE_BLOCK)
    // 仍然只识别到 1 轮（### Round 99 在代码块内，不算 round 边界）
    expect(r.steps).not.toBeNull()
    expect(r.steps!.length).toBe(1)
    // ## A 应保留在 response（代码块的 ## 不算 section 边界）
    expect(r.response).toContain('脚本输出已展示')
    // 代码块内的 **Tool: fake** 不应产生额外工具
    expect(r.steps![0].tools.length).toBe(1)
    expect(r.steps![0].tools[0].name).toBe('bash')
    // thinking 应包含代码块原文中的 ## Round 99 标记
    expect(r.steps![0].thinking ?? '').toContain('Round 99')
  })
})
