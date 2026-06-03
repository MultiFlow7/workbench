/**
 * atomParser — atom 文件 Markdown 解析器（v0.15 节点 4.7）
 *
 * 将 atom .md 文件解析为结构化对象。frontmatter 用内置 mini-YAML 解析器
 * （仅覆盖 atom 文件实际使用的字段子集：id / prev / children / summary /
 * timestamp），body 用纯字符串状态机扫描（不引 markdown-it），以保持解析
 * 逻辑透明、边界可控、便于单元测试。
 *
 * v0.15.1 P3.3 修订（2026-06-03）：移除 gray-matter 依赖
 * ─────────────────────────────────────────────────────────────────────
 * 原实现 `import matter from 'gray-matter'` 在 Electron renderer 抛
 *   ReferenceError: Buffer is not defined
 * 链路：parseAtom() → matter() → exports2.toBuffer() → Buffer.from(...)
 * 根因：v0.15 Tauri → Electron 迁移期，renderer 默认 sandboxed，没有
 *   Node.js 全局（Buffer / process / fs 等），而 gray-matter 内部用
 *   Buffer 处理字符串/输入归一化。结果整个 parseAtom 抛错被 useChatSend
 *   的 `.catch(...)` 吞下，atomEntries=[]，P3 永远显示空。
 *   之前未暴露是因为 v0.15 期间 read_qa_atom 是 stub（answer=整文件、
 *   write_qa_atom noop 文件不落盘），parseAtom 根本没机会被真实数据触发。
 *   v0.15.1 P3 r10 修复了 read/write IPC 之后这个老坑才浮出水面。
 *
 * 修复方案：自实现 parseFrontmatter()
 *   - 仅识别 atom 文件实际写出的字段（id / prev / children / summary /
 *     timestamp / model / input_tokens / ... 等扩展字段对 atomParser
 *     不需要，由 read_qa_atom 在 main 进程解析后挂到 meta 上）
 *   - prev：null / 单行字符串 / 单行 inline 数组 `[]` / `['x']` 三种
 *   - children：多行 `  - "[[xxx]]"` 块 或 单行 inline 数组 两种
 *   - timestamp / summary / id：单行 scalar，自动去引号
 *   - 不依赖 Buffer / process / fs，纯字符串操作，浏览器/renderer 安全
 *
 * 复盘归档：v0.15 迁移期 renderer 端 Node 模块兼容性应列入审计清单
 *   （Buffer / process / fs / path 等全局或 node-only 包；下次迁移
 *   前用 `grep -rE "from ['\\\"](buffer|fs|path|os|crypto)['\\\"]|Buffer\\.|process\\." src/` 扫一遍）。
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

// ─── 内置 mini-frontmatter 解析器 ──────────────────────────────────────────
//
// 不引入 gray-matter / js-yaml；仅识别 atom 文件实际写出的字段。
// 见文件头注释 v0.15.1 P3.3 修订段。

interface FrontmatterResult {
  data: Record<string, unknown>
  content: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function stripQuotes(s: string): string {
  return s.trim().replace(/^['"]|['"]$/g, '')
}

function parseInlineArray(raw: string): string[] {
  // 接受形如 [], ['a', 'b'], ["x"] —— 仅一层
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '').trim()
  if (!inner) return []
  return inner
    .split(',')
    .map((s) => stripQuotes(s))
    .filter((s) => s.length > 0)
}

function parseFrontmatter(raw: string): FrontmatterResult {
  const m = FRONTMATTER_RE.exec(raw)
  if (!m) return { data: {}, content: raw }
  const fm = m[1]
  const content = raw.slice(m[0].length)
  const data: Record<string, unknown> = {}

  const lines = fm.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') { i++; continue }
    // 顶层 key: value（不缩进；缩进列表项由块标量分支处理）
    const scalarMatch = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!scalarMatch) { i++; continue }
    const key = scalarMatch[1]
    const rest = scalarMatch[2]

    if (rest === '' || rest === undefined) {
      // 块标量：下一行起 `  - xxx` 形式的多行列表
      const items: string[] = []
      let j = i + 1
      while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
        const itemMatch = /^\s+-\s+(.*)$/.exec(lines[j])
        if (itemMatch) items.push(stripQuotes(itemMatch[1]))
        j++
      }
      data[key] = items
      i = j
      continue
    }

    const trimmedRest = rest.trim()
    if (trimmedRest === 'null') {
      data[key] = null
    } else if (trimmedRest.startsWith('[') && trimmedRest.endsWith(']')) {
      data[key] = parseInlineArray(trimmedRest)
    } else {
      data[key] = stripQuotes(trimmedRest)
    }
    i++
  }

  return { data, content }
}

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
  // 1. frontmatter 用内置 mini-parser（避免 gray-matter 在 renderer 触发 Buffer 错误，
  //    见文件头 v0.15.1 P3.3 修订段）
  const parsed = parseFrontmatter(raw)
  const fmRaw = parsed.data
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
 *
 * 关键规则（v0.15.1 P3 r11 修订）：
 *   1. 仅识别 4 个 KNOWN 顶层 section 名：Q / A / Steps / Intervention
 *      ——答案体（## A 之后）的 `## XX` markdown 二级标题（例如 ## 项目现状总结、
 *      ## REQ-004 待确认项）不再被误判为新顶层 section 边界，保留为 section 内部内容。
 *   2. 代码块围栏（``` 或 ~~~）内的 `##` 不视为 section 边界。
 *
 * 历史 bug：原实现 `^##\s+(.+?)\s*$` 把任意二级标题都当成新顶层 section，
 *   导致答案被截断（例如 0013-001-* 的 ## A 实际内容 1000+ 字，但被截到 109 字），
 *   外部表现是「点击节点后 P3 几乎不显示内容」。
 */
const KNOWN_TOP_SECTIONS = new Set(['Q', 'A', 'Steps', 'Intervention'])

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
        const name = match[1].trim()
        if (KNOWN_TOP_SECTIONS.has(name)) {
          // 仅 known 顶层 section 才视为新分段边界
          flush()
          currentName = name
          currentBuf = []
          continue
        }
        // 否则当作 section 内部的 markdown 二级标题，落入下方 push
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
