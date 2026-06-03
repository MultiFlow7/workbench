/**
 * agentEventDispatcher — renderer 侧 agent 事件分发器（v0.15 节点 2.3 / 4.6 / 4.8 / 5.4）
 *
 * 监听主进程通过 'agent:event' IPC 频道推送的事件，
 * 按事件类型映射到 Zustand conversationStore 的对应 action。
 *
 * 事件类型映射：
 *   text        → conversationStore.appendStreamingText(activeAtomId, content)
 *                 + session buffer responseText 累积
 *   thinking    → traceSlice.appendLiveThinking({ roundIndex, content })
 *                 + session buffer rounds[currentRoundIndex].thinking 追加
 *   tool_use    → conversationStore.setAtomStreaming(activeAtomId)
 *                 + traceSlice.appendLiveTool(...)
 *                 + session buffer 新起一轮 Round（rounds.push）
 *   tool_result → traceSlice.finishLiveTool(...)
 *                 + session buffer 填入对应工具的 result
 *   result      → conversationStore.setAtomDone(activeAtomId) + clearStreamingText
 *                 + traceSlice.finalizeLiveTrace()
 *                 + _flushAtomToDisk()（节点 4.8：写盘）
 *   error       → conversationStore.setStreamingState('error')
 *
 * 节点 4.8：session buffer 在 setActiveAtomId 时重置，
 * 期间累积 q / rounds / interventions / responseText，
 * result 事件触发时调用 _flushAtomToDisk() 将 atom 文件写入磁盘。
 *
 * 节点 5.4：addIntervention 公开 API 用于干预注入时记录。
 *
 * 保持与 v0.14 conversationSlice（appendStreamingText / setAtomStreaming / setAtomDone）
 * 签名完全兼容，无破坏性修改。
 */

import { useStore } from '../store'
import type { Round, Intervention, Tool } from './atomParser'
import type { QAAtomMeta } from '../store/conversationSlice'
import { toFilePath } from '../utils/paths'

// ─── AgentEvent 类型（与主进程 SDKBridge 保持同步）────────────────────────────

type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; toolName: string; input: unknown; toolUseId: string }
  | { type: 'tool_result'; toolUseId: string; result: unknown }
  | { type: 'result'; finalResult: unknown }
  | { type: 'error'; message: string }
  | { type: 'raw'; data: unknown }
  | { type: 'paused'; toolUseId: string }  // 节点 5.1：agent 已暂停等待干预

// ─── Session buffer（节点 4.8）─────────────────────────────────────────────

/**
 * 单次 agent 会话期间累积的结构化数据，最终在 result 事件触发时
 * 序列化为 atom .md 文件写盘。
 */
interface SessionBuffer {
  atomId: string
  q: string
  rounds: Round[]
  interventions: Intervention[]
  responseText: string
  /** 每个 tool 在 rounds 中的位置，方便 tool_result 回填 */
  toolIndex: Map<string, { roundIdx: number; toolIdx: number }>
}

const TOOL_RESULT_MAX_LEN = 2000

// ─── 内部状态 ─────────────────────────────────────────────────────────────────

/** 当前正在接收流的 atomId，由外部调用 setActiveAtomId() 设置 */
let _activeAtomId: string | null = null

/** 已注册的 unlisten 函数（防止重复注册） */
let _unlisten: (() => void) | null = null

/**
 * 当前 thinking 轮次索引（节点 4.6）。
 * thinking 事件追加到当前轮次，tool_use 事件触发轮次递增（首次不递增）。
 */
let _currentRoundIndex = 0

/** 是否已进入第一个轮次（用于首次 tool_use 不递增） */
let _firstToolSeen = false

/** 当前会话 buffer（节点 4.8）；null 表示未启动会话 */
let _sessionBuffer: SessionBuffer | null = null

// ─── 公开 API ─────────────────────────────────────────────────────────────────

/**
 * 设置当前活跃的 atomId，agentEventDispatcher 将把事件关联到该 atom。
 * 应在调用 ipcAgent.start() 之前设置。
 * 同时重置轮次计数器和 session buffer。
 */
export function setActiveAtomId(atomId: string | null): void {
  _activeAtomId = atomId
  _currentRoundIndex = 0
  _firstToolSeen = false
  if (atomId) {
    _sessionBuffer = {
      atomId,
      q: '',
      rounds: [],
      interventions: [],
      responseText: '',
      toolIndex: new Map(),
    }
  } else {
    _sessionBuffer = null
  }
}

/**
 * 获取当前活跃的 atomId。
 */
export function getActiveAtomId(): string | null {
  return _activeAtomId
}

/**
 * 设置当前 session 的用户问题。
 * 应在 agent 启动前调用（节点 4.8）。
 */
export function setSessionQ(q: string): void {
  if (_sessionBuffer) {
    _sessionBuffer.q = q
  }
}

/**
 * 追加一次 intervention 记录到当前 session（节点 5.4）。
 * 干预注入时由 UI 层调用，session buffer flush 时一并写入 atom 文件。
 */
export function addIntervention(intervention: Intervention): void {
  if (_sessionBuffer) {
    _sessionBuffer.interventions.push(intervention)
  }
}

/**
 * 仅为测试暴露：读取当前 session buffer 快照（不可变副本）。
 */
export function _peekSessionBuffer(): SessionBuffer | null {
  return _sessionBuffer
}

/**
 * 初始化 agentEventDispatcher，注册 'agent:event' IPC 监听。
 * 幂等：多次调用只注册一次监听。
 * 应在 src/main.tsx bootstrap() 中调用。
 */
export function initAgentEventDispatcher(): void {
  if (_unlisten) return // 已注册，幂等

  const unlisten = window.api.listen<AgentEvent>('agent:event', ({ payload }) => {
    _handleEvent(payload)
  })

  // window.api.listen 返回 Promise<unlisten>
  unlisten.then((fn) => {
    _unlisten = fn
  })
}

/**
 * 清理监听器（如 HMR 或组件卸载时使用）。
 */
export function cleanupAgentEventDispatcher(): void {
  if (_unlisten) {
    _unlisten()
    _unlisten = null
  }
}

// ─── 事件分发逻辑 ─────────────────────────────────────────────────────────────

function _handleEvent(event: AgentEvent): void {
  const atomId = _activeAtomId
  const store = useStore.getState()

  switch (event.type) {
    case 'text': {
      if (atomId) {
        store.appendStreamingText(atomId, event.content)
      }
      if (_sessionBuffer) {
        _sessionBuffer.responseText += event.content
      }
      break
    }
    case 'thinking': {
      // 节点 4.6：写入 traceSlice liveRounds（附加到当前轮次）
      store.appendLiveThinking({ roundIndex: _currentRoundIndex, content: event.content })
      // 保留原 streaming text 写入（向后兼容）
      if (atomId) {
        store.appendStreamingText(atomId, `[thinking] ${event.content}`)
      }
      // 节点 4.8：累积到 session buffer
      if (_sessionBuffer) {
        const idx = _currentRoundIndex
        // 确保 round 存在
        while (_sessionBuffer.rounds.length <= idx) {
          _sessionBuffer.rounds.push({ tools: [] })
        }
        const round = _sessionBuffer.rounds[idx]
        round.thinking = (round.thinking ?? '') + event.content
      }
      break
    }
    case 'tool_use': {
      // 节点 4.6：每次 tool_use 开启新轮次（首次不递增）
      if (_firstToolSeen) {
        _currentRoundIndex++
      } else {
        _firstToolSeen = true
      }
      store.appendLiveTool({
        roundIndex: _currentRoundIndex,
        toolName: event.toolName,
        toolUseId: event.toolUseId,
        input: event.input,
      })
      if (atomId) {
        // 工具调用开始：标记 atom 为 streaming 状态
        store.setAtomStreaming(atomId)
        store.appendStreamingText(atomId, `[tool:${event.toolName}] `)
      }
      // 节点 4.8：累积到 session buffer
      if (_sessionBuffer) {
        const idx = _currentRoundIndex
        while (_sessionBuffer.rounds.length <= idx) {
          _sessionBuffer.rounds.push({ tools: [] })
        }
        const round = _sessionBuffer.rounds[idx]
        const tool: Tool = {
          name: event.toolName,
          input: _stringifyToolPayload(event.input),
          result: '',
          status: 'done',
        }
        round.tools.push(tool)
        _sessionBuffer.toolIndex.set(event.toolUseId, {
          roundIdx: idx,
          toolIdx: round.tools.length - 1,
        })
      }
      break
    }
    case 'tool_result': {
      // 节点 4.6：填入工具结果
      store.finishLiveTool({ toolUseId: event.toolUseId, result: event.result })
      // 工具结果返回：不结束 streaming（可能还有后续 text 或 tool_use）
      if (atomId) {
        store.appendStreamingText(atomId, `[/tool:${event.toolUseId}] `)
      }
      // 节点 4.8：回填到 session buffer
      if (_sessionBuffer) {
        const loc = _sessionBuffer.toolIndex.get(event.toolUseId)
        if (loc) {
          const tool = _sessionBuffer.rounds[loc.roundIdx]?.tools[loc.toolIdx]
          if (tool) {
            let text = _stringifyToolPayload(event.result)
            if (text.length > TOOL_RESULT_MAX_LEN) {
              text = text.slice(0, TOOL_RESULT_MAX_LEN) + '\n…(truncated)'
            }
            tool.result = text
          }
        }
      }
      break
    }
    case 'result': {
      // 节点 4.6：清空流式缓冲
      store.finalizeLiveTrace()
      // agent 最终完成
      if (atomId) {
        store.setAtomDone(atomId)
        store.clearStreamingText(atomId)
      }
      store.setStreamingState('idle')
      // 节点 4.8：触发落盘
      void _flushAtomToDisk()
      _activeAtomId = null
      _currentRoundIndex = 0
      _firstToolSeen = false
      _sessionBuffer = null
      break
    }
    case 'error': {
      // 节点 4.6：出错时也清空流式缓冲
      store.finalizeLiveTrace()
      if (atomId) {
        store.setAtomDone(atomId)
        store.clearStreamingText(atomId)
      }
      // v0.15.1 P5 r14：保留具体错误消息，让 ChatViewV2 错误区展示真因（如「请先配置 API Key」）
      // setLastErrorMessage 必须在 setStreamingState('error') 之前/之后调用都安全 —
      // setStreamingState('error') 不会清掉 lastErrorMessage（见 conversationSlice）
      store.setLastErrorMessage(event.message || null)
      store.setStreamingState('error')
      _activeAtomId = null
      _currentRoundIndex = 0
      _firstToolSeen = false
      _sessionBuffer = null
      break
    }
    case 'raw': {
      // 调试用原始数据，忽略
      break
    }
    case 'paused': {
      // 节点 5.1：agent 已暂停，广播暂停状态到 store（供干预 UI 响应）
      store.setStreamingState('paused')
      break
    }
  }
}

// ─── 落盘逻辑（节点 4.8）──────────────────────────────────────────────────

/**
 * 将 session buffer 序列化为 atom .md 文件并写入磁盘。
 *
 * - 从 conversationSlice.atoms 取 frontmatter meta
 * - 调用 serializeAtom 拼接 .md 内容
 * - 通过 window.api.fs.write 落盘（main process 侧已实现 tmp → rename 原子写）
 *
 * 失败时不抛异常，仅 console.error，避免污染 agent 完成流。
 */
async function _flushAtomToDisk(): Promise<void> {
  const buf = _sessionBuffer
  if (!buf) return

  const state = useStore.getState()
  const meta = state.atoms[buf.atomId]
  if (!meta) {
    console.warn(`[agentEventDispatcher] flush skipped: atom meta not found for ${buf.atomId}`)
    return
  }

  try {
    const content = serializeAtom(meta, buf.q, buf.rounds, buf.interventions, buf.responseText)
    const atomPath = getAtomFilePath(buf.atomId)
    await window.api.fs.write(atomPath, content)
    // v0.15.1 P7（r16）：通知 renderer 该 atom 已完成落盘，触发 atomEntries 重载
    // （useChatSend useEffect 仅监听 currentPath，流式结束后磁盘内容更新但 path
    // 引用未变 → 不重载 → 末位 atom 渲染从 streamingTexts 切回 parsed.response
    // 时落空 → "一闪而过又消失"）。
    useStore.getState().bumpAtomDiskRevision(buf.atomId)
  } catch (err) {
    console.error('[agentEventDispatcher] flush atom to disk failed', err)
  }
}

/**
 * 推导 atom 文件路径。
 *
 * v0.15.1 P7 修复（2026-06-03，r16）：原实现写到 `<cwd>/atoms/<atomId>.md`，
 * 但 `cwd` 是 vault 根目录，atoms 子目录并不存在；同时 `useChatSend` 的占位
 * write_qa_atom 与历史回读 read_qa_atom 都用 `toFilePath(id) = ${BASE_PATH}/${id}.md`
 * （`VITE_VAULT_QA_PATH` 指向 `07-AI知识库/L1-原始对话/QA`）。结果：
 *   - 占位 atom 写到正确位置但只含 `## Q`，`## A` 为空
 *   - 流式结束后 dispatcher 把完整内容写到错误路径（且目录不存在 → fs:write 静默失败）
 *   - 用户重新点回节点 → read_qa_atom 读到占位文件 → 只看到用户问题，无 AI 回复
 *
 * 修复后统一走 `toFilePath`，与占位写 / 历史回读路径一致，dispatcher 覆盖
 * 占位文件即可。fs:write 主进程侧已实现 tmp → rename 原子写。
 */
function getAtomFilePath(atomId: string): string {
  return toFilePath(atomId)
}

// ─── 序列化（节点 4.8 / 4.9）──────────────────────────────────────────────

/**
 * 将 atom meta + 会话数据序列化为标准 atom .md 文本。
 *
 * 格式（与 atomParser 反向对称）：
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
 *   <q>
 *
 *   ## Steps        (rounds.length > 0 时才写)
 *   ### Round N
 *   **Thinking**
 *   <thinking>
 *
 *   **Tool: <name>**
 *   - Input: <input>
 *   - Result: <result>
 *
 *   ## Intervention (interventions.length > 0 时才写)
 *   ...
 *
 *   ## A
 *   <response>
 *
 * 节点 4.9 向后兼容：rounds.length === 0 时不写 ## Steps section。
 */
export function serializeAtom(
  meta: QAAtomMeta,
  q: string,
  rounds: Round[],
  interventions: Intervention[],
  response: string,
): string {
  const fm = _serializeFrontmatter(meta)
  const out: string[] = []
  out.push(fm)
  out.push('')
  out.push('## Q')
  out.push(q)
  out.push('')

  // 节点 4.9：rounds 为空时不写 Steps section（兼容 v0.14 旧格式）
  if (rounds.length > 0) {
    out.push('## Steps')
    rounds.forEach((round, idx) => {
      out.push(`### Round ${idx + 1}`)
      if (round.thinking && round.thinking.trim().length > 0) {
        out.push('**Thinking**')
        out.push(round.thinking)
        out.push('')
      }
      round.tools.forEach((tool) => {
        out.push(`**Tool: ${tool.name}**`)
        out.push(`- Input: ${_singleLineOrBlock(tool.input)}`)
        out.push(`- Result: ${_singleLineOrBlock(tool.result)}`)
        if (tool.status === 'error') {
          out.push(`- Status: error`)
        }
        out.push('')
      })
    })
  }

  if (interventions.length > 0) {
    out.push('## Intervention')
    if (interventions.length === 1) {
      const i = interventions[0]
      out.push(`- 触发时机：Round ${i.afterRound} 完成后`)
      out.push(`- 用户补充：${i.text}`)
      out.push(`- 时间戳：${i.timestamp}`)
    } else {
      interventions.forEach((i, idx) => {
        out.push(`### Intervention ${idx + 1}`)
        out.push(`- 触发时机：Round ${i.afterRound} 完成后`)
        out.push(`- 用户补充：${i.text}`)
        out.push(`- 时间戳：${i.timestamp}`)
        out.push('')
      })
    }
    out.push('')
  }

  out.push('## A')
  out.push(response)
  out.push('')

  return out.join('\n')
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────

function _serializeFrontmatter(meta: QAAtomMeta): string {
  const lines: string[] = ['---']
  lines.push(`id: ${meta.id}`)
  lines.push(`prev: ${_serializeFmList(meta.prev ? [meta.prev] : [])}`)
  lines.push(`children: ${_serializeFmList(meta.children ?? [])}`)
  lines.push(`summary: ${_serializeFmString(meta.summary ?? '')}`)
  lines.push(`timestamp: ${_serializeFmString(meta.timestamp ?? '')}`)
  if (meta.model) lines.push(`model: ${_serializeFmString(meta.model)}`)
  lines.push('---')
  return lines.join('\n')
}

function _serializeFmList(items: string[]): string {
  if (items.length === 0) return '[]'
  return `[${items.map((s) => `'${s.replace(/'/g, "\\'")}'`).join(', ')}]`
}

function _serializeFmString(s: string): string {
  // 简单 yaml 字符串：含特殊字符则加单引号
  if (/[:#'"\n]/.test(s)) {
    return `'${s.replace(/'/g, "''")}'`
  }
  return s
}

/**
 * 若 text 是单行短文本，直接返回；
 * 否则在前面加换行使其后续多行清晰可读。
 */
function _singleLineOrBlock(text: string): string {
  if (text.includes('\n')) {
    // 多行：用换行打头便于后续被作为 sub buffer 累积
    return `\n${text}`
  }
  return text
}

function _stringifyToolPayload(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
