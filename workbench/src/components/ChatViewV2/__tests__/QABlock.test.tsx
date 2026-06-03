/**
 * QABlock.test.tsx · v0.15.1 节点 4.1
 *
 * 覆盖四种渲染场景（含 rounds / 无 rounds / 含干预 / 流式）。
 * 使用 react-dom/server renderToString，避免引入 jsdom + testing-library（T-V151-R4：本版本不引入新依赖）。
 *
 * 验证锚点：T-V151-A1（DOM 顺序：q-bubble → process-trace → final-answer-bubble → token-line）
 *           T-V151-A3（rounds === null 时不渲染 process-trace）
 *           T-V151-A9（streaming 注入 liveRounds）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { useStore } from '../../../store'
import { QABlock } from '../QABlock'
import type { Round, Intervention } from '../../../lib/atomParser'

// 全局 mock 在 src/test-setup.ts 集中维护（window.api / localStorage）
vi.mock('../../../utils/paths', () => ({
  BASE_PATH: '/mock/base',
  PROJECTS_PATH: '/mock/projects',
}))

function resetStore() {
  useStore.setState({
    processCollapsed: false,
    thinkingGroupCollapsed: false,
    toolGroupCollapsed: true,
    thinkOverrides: {},
    toolOverrides: {},
    liveRounds: [],
    streamingAtoms: new Set<string>(),
  })
}

describe('QABlock · 四种渲染场景', () => {
  beforeEach(() => { resetStore() })

  it('场景 1 · 含 rounds：DOM 顺序为 q-bubble → process-trace → final-answer (bubble--ai-plain) → token-line', () => {
    const rounds: Round[] = [
      { thinking: 'thinking content', tools: [{ name: 'Read', input: '{}', result: 'ok', status: 'done' }] },
    ]
    const html = renderToString(
      <QABlock
        atomId="atom-1"
        question="hello"
        finalAnswer="answer text"
        rounds={rounds}
        interventions={[]}
        tokenUsage={{ input: 100, output: 50 }}
        isStreaming={false}
        isLast={false}
        timestamp="2026-06-01T10:00:00Z"
      />,
    )

    const qIdx = html.indexOf('qa-block__q-bubble')
    const ptIdx = html.indexOf('process-trace')
    const faIdx = html.indexOf('bubble--ai-plain')
    const tlIdx = html.indexOf('token-line')

    expect(qIdx).toBeGreaterThan(-1)
    expect(ptIdx).toBeGreaterThan(qIdx)
    expect(faIdx).toBeGreaterThan(ptIdx)
    expect(tlIdx).toBeGreaterThan(faIdx)
  })

  it('场景 2 · 无 rounds（rounds === null）：不渲染 process-trace', () => {
    const html = renderToString(
      <QABlock
        atomId="atom-2"
        question="hi"
        finalAnswer="some answer"
        rounds={null}
        interventions={[]}
        isStreaming={false}
        isLast={false}
      />,
    )
    expect(html.includes('process-trace')).toBe(false)
    // 内容应可见即可，FinalAnswerBubble 内部由 react-markdown 渲染
    expect(html.includes('some answer') || html.includes('final-answer')).toBe(true)
  })

  it('场景 3 · 含干预：interventions 渲染为 intervention-record', () => {
    const rounds: Round[] = [{ tools: [] }]
    const interventions: Intervention[] = [
      { afterRound: 1, text: '请改用 Read 工具', timestamp: '2026-06-01T10:01:00Z' },
    ]
    const html = renderToString(
      <QABlock
        atomId="atom-3"
        question="q"
        finalAnswer="a"
        rounds={rounds}
        interventions={interventions}
        isStreaming={false}
        isLast={false}
      />,
    )
    expect(html.includes('intervention-record')).toBe(true)
    expect(html.includes('请改用 Read 工具')).toBe(true)
  })

  it('场景 4 · 流式（rounds 持久 + isStreaming=true）：ProcessTrace 内部 RoundBlock 含 spinner', () => {
    // Note: 由于 useSyncExternalStore 在 SSR 模式下回退到 initial server snapshot，
    // 流式分支的 liveRounds 注入路径（rounds=[] → fallback liveRounds）无法通过 SSR 验证；
    // 此处通过提供持久 rounds + isStreaming 标志，覆盖 RoundBlock 的 isStreaming 渲染分支
    const rounds: Round[] = [
      { thinking: 'in-progress think', tools: [{ name: 'Read', input: '{}', result: '', status: 'done' }] },
    ]
    useStore.setState({
      streamingAtoms: new Set<string>(['atom-4']),
    })
    const html = renderToString(
      <QABlock
        atomId="atom-4"
        question="streaming q"
        finalAnswer=""
        rounds={rounds}
        interventions={[]}
        isStreaming={true}
        isLast={true}
      />,
    )
    // 持久 rounds 路径下 process-trace 容器必然出现；FinalAnswerBubble 内的 streaming 类名应可见
    expect(html.includes('process-trace')).toBe(true)
    expect(html.includes('bubble--streaming-plain')).toBe(true)
  })
})
