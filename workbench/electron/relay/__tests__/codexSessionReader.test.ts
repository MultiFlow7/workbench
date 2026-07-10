import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { __setCodexSessionsRootForTesting, readCodexSession } from '../codexSessionReader'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-reader-'))
  __setCodexSessionsRootForTesting(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeJsonl(name: string, rows: unknown[]): string {
  const path = join(root, name)
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf-8')
  return path
}

describe('codexSessionReader', () => {
  it('parses session_meta and response_item messages without importing event_msg echoes', async () => {
    const sourcePath = writeJsonl('rollout-session-abc.jsonl', [
      {
        timestamp: '2026-07-09T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          session_id: 'session-abc',
          cwd: '/tmp/project',
        },
      },
      {
        timestamp: '2026-07-09T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'What is the unit?' }],
        },
      },
      {
        timestamp: '2026-07-09T00:00:01.001Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'What is the unit?',
        },
      },
      {
        timestamp: '2026-07-09T00:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'A self-contained unit.' }],
        },
      },
    ])

    const result = await readCodexSession({ sessionId: 'session-abc', sourcePath })

    expect(result.meta.sessionId).toBe('session-abc')
    expect(result.meta.sourceCwdDisplay).toBe('/tmp/project')
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]).toMatchObject({
      question: 'What is the unit?',
      answer: 'A self-contained unit.',
    })
    expect(result.markers).toHaveLength(0)
  })

  it('marks unmapped response items instead of forcing them into QA pairs', async () => {
    const sourcePath = writeJsonl('rollout-session-tool.jsonl', [
      { type: 'session_meta', payload: { session_id: 'session-tool' } },
      {
        timestamp: '2026-07-09T00:00:01.000Z',
        type: 'response_item',
        payload: { type: 'tool_use', name: 'bash' },
      },
    ])

    const result = await readCodexSession({ sessionId: 'session-tool', sourcePath })

    expect(result.pairs).toHaveLength(0)
    expect(result.markers).toEqual([
      expect.objectContaining({
        type: 'tool_trace_candidate',
        reason: '暂不映射 response_item:tool_use',
      }),
    ])
  })

  it('rejects explicit paths outside the configured Codex sessions root', async () => {
    const outside = join(tmpdir(), `outside-${Date.now()}.jsonl`)
    writeFileSync(outside, '{}\n', 'utf-8')

    await expect(readCodexSession({ sourcePath: outside })).rejects.toThrow(/允许/)
    rmSync(outside, { force: true })
  })
})
