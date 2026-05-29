/**
 * atomParser — atom 文件 Markdown 解析器（v0.15 节点 4.7）
 *
 * 将 atom .md 文件解析为结构化对象。frontmatter 用 gray-matter，
 * body 用纯字符串状态机扫描（不引 markdown-it），以保持解析逻辑透明、
 * 边界可控、便于单元测试。
 *
 * Atom 文件格式（参考 changelog/v0.15/technical.md 节点 4.7）：
 *
 *   ---
 *   id: ...
 *   prev: [...]
 *   children: [...]
 *   summary: ...
 *   timestamp: ...
 *   ---
 *
 *   ## Q
 *   用户问题
 *
 *   ## Steps
 *   ### Round 1
 *   **Thinking**
 *   思考内容
 *
 *   **Tool: bash**
 *   - Input: 命令
 *   - Result: 输出
 *
 *   ### Round 2
 *   ...
 *
 *   ## Intervention
 *   - 触发时机：Round 2 完成后
 *   - 用户补充：换一种方式
 *
 *   ## A
 *   AI 最终回答
 *
 * 兼容性：
 *   - 无 ## Steps section 的旧 atom（v0.14）：steps 字段为 null
 *   - 嵌套代码块（``` 围栏）内的 ## / ### / ** 不被解析为 section 边界
 */

import matter from 'gray-matter'

// ─── 类型定义 ───────────────────────────────────────────────────────────────

export type ParsedAtom = {
  frontmatter: {
    id: string
    prev: string[]
    children: string[]
    summary: string
    timestamp: string
  }
  q: string
  steps: Round[] | null // null 表示旧 atom 无 ## Steps section
  interventions: Intervention[]
  response: string // ## A 内容
}

export type Round = {
  thinking?: string
  tools: Tool[]
}

export type Tool = {
  name: string
  input: string
  result: string
  status: 'done' | 'error'
}

export type Intervention = {
  afterRound: number
  text: string
  timestamp: string
}

// ─── 主入口 ────────────────────────────────────────────────────────────────

export function parseAtom(raw: string): ParsedAtom {
  // 1. frontmatter 用 gray-matter
  const parsed = matter(raw)
  const fmRaw = parsed.data as Record<string, unknown>
  const frontmatter: ParsedAtom['frontmatter'] = {
    id: typeof fmRaw.id === 'string' ? fmRaw.id : '',
    prev: Array.isArray(fmRaw.prev) ? fmRaw.prev.map(String) : [],
    children: Array.isArray(fmRaw.children) ? fmRaw.children.map(String) : [],
    summary: typeof fmRaw.summary === 'string' ? fmRaw.summary : '',
    timestamp: typeof fmRaw.timestamp === 'string' ? fmRaw.timestamp : '',
  }

  // 2. body 状态机解析
  const sections = splitTopSections(parsed.content)

  const q = (sections.get('Q') ?? '').trim()
  const response = (sections.get('A') ?? '').trim()

  const stepsRaw = sections.get('Steps')
  const steps = stepsRaw === undefined ? null : parseSteps(stepsRaw)

  const interventionsRaw = sections.get('Intervention')
  const interventions = interventionsRaw === undefined
    ? []
    : parseInterventions(interventionsRaw)

  return {
    frontmatter,
    q,
    steps,
    interventions,
    response,
  }
}

// ─── 顶层 section 分割 ──────────────────────────────────────────────────────

/**
 * 按 `## <Name>` 切分 body，返回 name → 内容（去掉标题行）的 Map。
 * 关键规则：在代码块围栏（``` 或 ~~~）内的 `##` 不视为 section 边界。
 */
function splitTopSections(body: string): Map<string, string> {
  const lines = body.split('\n')
  const sections = new Map<string, string>()

  let currentName: string | null = null
  let currentBuf: string[] = []
  let fenceOpen = false
  let fenceMarker = ''

  const flush = () => {
    if (currentName !== null) {
      sections.set(currentName, currentBuf.join('\n'))
    }
  }

  for (const line of lines) {
    const fenceInfo = detectFence(line)
    if (fenceInfo) {
      if (!fenceOpen) {
        fenceOpen = true
        fenceMarker = fenceInfo
      } else if (line.trimStart().startsWith(fenceMarker)) {
        fenceOpen = false
        fenceMarker = ''
      }
      if (currentName !== null) currentBuf.push(line)
      continue
    }

    if (!fenceOpen) {
      const match = /^##\s+(.+?)\s*$/.exec(line)
      if (match && !line.startsWith('###')) {
        // 遇到新顶层 section
        flush()
        currentName = match[1].trim()
        currentBuf = []
        continue
      }
    }

    if (currentName !== null) currentBuf.push(line)
  }

  flush()
  return sections
}

/**
 * 判断该行是否为 ``` 或 ~~~ 围栏行；返回围栏标记（用于配对），否则 null。
 */
function detectFence(line: string): string | null {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('```')) return '```'
  if (trimmed.startsWith('~~~')) return '~~~'
  return null
}

// ─── Steps 解析 ────────────────────────────────────────────────────────────

/**
 * 解析 ## Steps 内容为 Round[]。
 * 边界：### Round N / **Thinking** / **Tool: name** / - Input: / - Result:
 * 同样需要忽略围栏内的伪边界。
 */
function parseSteps(stepsBody: string): Round[] {
  const lines = stepsBody.split('\n')
  const rounds: Round[] = []

  // 当前 round 累积状态
  let currentRound: Round | null = null
  // 当前正在累积的子段：thinking / tool-input / tool-result / null（无）
  type SubKind = 'thinking' | 'tool-input' | 'tool-result' | null
  let subKind: SubKind = null
  let subBuf: string[] = []
  let currentTool: Tool | null = null

  let fenceOpen = false
  let fenceMarker = ''

  const flushSub = () => {
    if (subKind === null) return
    const text = trimTrailingBlank(subBuf).join('\n')
    if (subKind === 'thinking' && currentRound) {
      currentRound.thinking = text
    } else if (subKind === 'tool-input' && currentTool) {
      currentTool.input = text
    } else if (subKind === 'tool-result' && currentTool) {
      currentTool.result = text
    }
    subKind = null
    subBuf = []
  }

  const flushTool = () => {
    flushSub()
    if (currentTool && currentRound) {
      currentRound.tools.push(currentTool)
    }
    currentTool = null
  }

  const flushRound = () => {
    flushTool()
    if (currentRound) {
      rounds.push(currentRound)
    }
    currentRound = null
  }

  for (const line of lines) {
    const fenceInfo = detectFence(line)
    if (fenceInfo) {
      if (!fenceOpen) {
        fenceOpen = true
        fenceMarker = fenceInfo
      } else if (line.trimStart().startsWith(fenceMarker)) {
        fenceOpen = false
        fenceMarker = ''
      }
      if (subKind !== null) subBuf.push(line)
      continue
    }

    if (fenceOpen) {
      if (subKind !== null) subBuf.push(line)
      continue
    }

    // ### Round N
    const roundMatch = /^###\s+Round\s+(\d+)\s*$/i.exec(line)
    if (roundMatch) {
      flushRound()
      currentRound = { tools: [] }
      continue
    }

    // **Thinking**
    if (/^\*\*Thinking\*\*\s*$/.test(line)) {
      flushTool()
      if (currentRound) {
        subKind = 'thinking'
        subBuf = []
      }
      continue
    }

    // **Tool: name**
    const toolMatch = /^\*\*Tool:\s*(.+?)\s*\*\*\s*$/.exec(line)
    if (toolMatch) {
      flushTool()
      if (currentRound) {
        currentTool = {
          name: toolMatch[1].trim(),
          input: '',
          result: '',
          status: 'done',
        }
        subKind = null
        subBuf = []
      }
      continue
    }

    // - Input: <可选首行内容>
    const inputMatch = /^-\s+Input:\s?(.*)$/.exec(line)
    if (inputMatch && currentTool) {
      flushSub()
      subKind = 'tool-input'
      const first = inputMatch[1]
      subBuf = first.length > 0 ? [first] : []
      continue
    }

    // - Result: <可选首行内容>
    const resultMatch = /^-\s+Result:\s?(.*)$/.exec(line)
    if (resultMatch && currentTool) {
      flushSub()
      subKind = 'tool-result'
      const first = resultMatch[1]
      subBuf = first.length > 0 ? [first] : []
      continue
    }

    // - Status: error / done（可选）
    const statusMatch = /^-\s+Status:\s*(done|error)\s*$/i.exec(line)
    if (statusMatch && currentTool) {
      flushSub()
      currentTool.status = statusMatch[1].toLowerCase() as 'done' | 'error'
      continue
    }

    // 其它行：要么追加到当前 sub，要么忽略
    if (subKind !== null) {
      subBuf.push(line)
    }
  }

  flushRound()
  return rounds
}

/**
 * 去掉数组末尾的空白行。
 */
function trimTrailingBlank(lines: string[]): string[] {
  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === '') end--
  return lines.slice(0, end)
}

// ─── Intervention 解析 ──────────────────────────────────────────────────────

/**
 * 解析 ## Intervention section。
 *
 * 支持两种结构：
 *  1. 单次 Intervention：直接是 `- 触发时机` / `- 用户补充` / `- 时间戳` 列表
 *  2. 多次 Intervention：用 `### Intervention N` 分隔，每段含上述字段
 *
 * 字段识别（中英兼容）：
 *  - 触发时机 / after / Round 数字  → afterRound（提取数字）
 *  - 用户补充 / text / 内容           → text
 *  - 时间戳 / timestamp              → timestamp
 */
function parseInterventions(body: string): Intervention[] {
  const lines = body.split('\n')

  // 先按 ### 分块（无 ### 则视为单块）
  const blocks: string[][] = []
  let buf: string[] = []
  let hasSubHeading = false
  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      hasSubHeading = true
      if (buf.length > 0) blocks.push(buf)
      buf = []
      continue
    }
    buf.push(line)
  }
  if (buf.length > 0) blocks.push(buf)

  if (!hasSubHeading && blocks.length === 1) {
    // 单次 Intervention
    const item = parseInterventionBlock(blocks[0])
    return item ? [item] : []
  }

  const out: Intervention[] = []
  for (const block of blocks) {
    const item = parseInterventionBlock(block)
    if (item) out.push(item)
  }
  return out
}

function parseInterventionBlock(lines: string[]): Intervention | null {
  let afterRound = 0
  let text = ''
  let timestamp = ''
  let found = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    // - 触发时机：Round N 完成后 / - after: Round N
    const triggerMatch = /^-\s*(?:触发时机|after)\s*[:：]\s*(.+)$/i.exec(trimmed)
    if (triggerMatch) {
      const numMatch = /(\d+)/.exec(triggerMatch[1])
      if (numMatch) afterRound = parseInt(numMatch[1], 10)
      found = true
      continue
    }

    // - 用户补充 / text / 内容
    const textMatch = /^-\s*(?:用户补充|text|内容)\s*[:：]\s*(.+)$/i.exec(trimmed)
    if (textMatch) {
      text = textMatch[1].trim()
      found = true
      continue
    }

    // - 时间戳 / timestamp
    const tsMatch = /^-\s*(?:时间戳|timestamp)\s*[:：]\s*(.+)$/i.exec(trimmed)
    if (tsMatch) {
      timestamp = tsMatch[1].trim()
      found = true
      continue
    }
  }

  if (!found) return null
  return { afterRound, text, timestamp }
}
