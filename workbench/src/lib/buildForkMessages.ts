/**
 * buildForkMessages — Fork 时从历史路径重建 Anthropic API messages 数组
 * （v0.15 节点 4.10）
 *
 * 当用户在分支树点击某节点 D 进行后续提问时，需要把 root → D 的完整历史
 * 转换为 Anthropic API 协议要求的 messages 数组：
 *   - 每个 atom 的 ## Q                 → { role: 'user', content: q }
 *   - 每个 atom 的 ## Steps（按轮次）   → assistant(thinking + tool_use) → user(tool_result)
 *   - Intervention（按 afterRound 插入）→ 在对应 round 的 tool_result 之后插入额外 user 消息
 *   - 每个 atom 的 ## A                  → assistant text block（追加或新建 assistant 消息）
 *   - 旧 atom（steps === null）         → 仅用 ## A 作为 assistant text，hasOldAtom = true
 *
 * 严格遵循 Anthropic API 协议：tool_use 与 tool_result 一一对应，
 * thinking + tool_use 同条 assistant 消息内允许 multi-block。
 */

import type { ParsedAtom } from './atomParser'

// ─── Anthropic API 类型（与 SDK Message 子集对齐）──────────────────────────

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export interface AnthropicContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result'
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: string
  /** 内部标记：来自旧 atom 重建的 block，不发给 API（仅供 UI 标识橙色 banner） */
  isOldAtom?: boolean
}

// ─── 主入口 ────────────────────────────────────────────────────────────────

/**
 * 从有序的 atom 路径重建 Anthropic API messages。
 *
 * @param path  有序 ParsedAtom 数组（path[0] = 根 atom，path[last] = fork 起点）
 * @returns { messages, hasOldAtom }
 *          hasOldAtom 为 true 时 UI 层应显示「历史含 v0.14 旧 atom」橙色提示
 */
export function buildForkMessages(
  path: ParsedAtom[],
): { messages: AnthropicMessage[]; hasOldAtom: boolean } {
  const messages: AnthropicMessage[] = []
  let hasOldAtom = false

  for (const atom of path) {
    // 1. ## Q → user message
    messages.push({ role: 'user', content: atom.q })

    // 2. ## Steps → 按轮次展开为 assistant + user(tool_result) pair
    if (atom.steps === null) {
      // 旧 atom：仅有 ## A，整段作为 assistant text
      hasOldAtom = true
      messages.push({
        role: 'assistant',
        content: [
          { type: 'text', text: atom.response, isOldAtom: true },
        ],
      })
      continue
    }

    // 按 afterRound 索引干预，便于在轮次后插入
    const interventionsByRound = new Map<number, string[]>()
    for (const intv of atom.interventions) {
      const list = interventionsByRound.get(intv.afterRound) ?? []
      list.push(intv.text)
      interventionsByRound.set(intv.afterRound, list)
    }

    // 累积 assistant 消息的 blocks（thinking + tool_use），
    // 最后一轮结束后追加 text block（## A），形成单条 assistant 消息。
    // 由于每轮 tool_use 后需要紧跟 tool_result(user)，每轮单独 push 一条 assistant。
    atom.steps.forEach((round, ri) => {
      const roundNumber = ri + 1
      const assistantBlocks: AnthropicContentBlock[] = []

      if (round.thinking && round.thinking.trim().length > 0) {
        assistantBlocks.push({ type: 'thinking', thinking: round.thinking })
      }

      round.tools.forEach((tool, ti) => {
        const toolUseId = `tool_${atom.frontmatter.id}_r${ri}_t${ti}`
        assistantBlocks.push({
          type: 'tool_use',
          id: toolUseId,
          name: tool.name,
          input: _parseToolInput(tool.input),
        })
      })

      if (assistantBlocks.length > 0) {
        messages.push({ role: 'assistant', content: assistantBlocks })
      }

      // 对应 tool_results 作为 user 消息
      if (round.tools.length > 0) {
        const resultBlocks: AnthropicContentBlock[] = round.tools.map((tool, ti) => ({
          type: 'tool_result',
          tool_use_id: `tool_${atom.frontmatter.id}_r${ri}_t${ti}`,
          content: tool.result,
        }))
        messages.push({ role: 'user', content: resultBlocks })
      }

      // 干预消息：在该轮 tool_result 之后、下一轮 assistant 之前
      const intvs = interventionsByRound.get(roundNumber)
      if (intvs && intvs.length > 0) {
        for (const text of intvs) {
          messages.push({ role: 'user', content: text })
        }
      }
    })

    // 3. ## A → assistant text block
    // 若最后一条 message 是 assistant 且无 tool_use（即只有 thinking 没结尾），
    // 追加 text block；否则新建 assistant 消息。
    if (atom.response && atom.response.length > 0) {
      const last = messages[messages.length - 1]
      const canAppend =
        last &&
        last.role === 'assistant' &&
        Array.isArray(last.content) &&
        !last.content.some((b) => b.type === 'tool_use')
      if (canAppend && Array.isArray(last.content)) {
        last.content.push({ type: 'text', text: atom.response })
      } else {
        messages.push({
          role: 'assistant',
          content: [{ type: 'text', text: atom.response }],
        })
      }
    }
  }

  return { messages, hasOldAtom }
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────

/**
 * 工具 input 在 atom 文件中以字符串形式存储；
 * 重建时尝试解析为 JSON 对象（API 期望 object），失败则降级为字符串。
 */
function _parseToolInput(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return {}
  // 多行 input 通常是 shell 命令或代码片段，原样保留为字符串包装
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return { command: raw }
    }
  }
  return { command: raw }
}
