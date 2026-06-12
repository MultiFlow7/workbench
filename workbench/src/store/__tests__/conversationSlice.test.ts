import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createConversationSlice } from '../conversationSlice'
import type { ConversationSlice } from '../conversationSlice'

// v0.15 节点 1.2: window.api.invoke 替代 @tauri-apps/api/core invoke
;(globalThis as unknown as { window: { api: { invoke: ReturnType<typeof vi.fn> } } }).window = {
  api: { invoke: vi.fn().mockResolvedValue(undefined) },
}
vi.mock('../../utils/paths', () => ({
  getBasePath: () => '/mock/base',
  getProjectsPath: () => '/mock/projects',
  getVaultPath: () => '/mock/vault',
  getVaultConfig: () => null,
  useBasePath: () => '/mock/base',
  useProjectsPath: () => '/mock/projects',
  useVaultPath: () => '/mock/vault',
  buildFilePath: (b: string, i: string) => (b && i ? `${b}/${i}.md` : ''),
  toFilePathFromSnapshot: (i: string) => (i ? `/mock/base/${i}.md` : ''),
}))

function makeStore() {
  return createStore<ConversationSlice>()(createConversationSlice)
}

// ── streamingAtoms ─────────────────────────────────────────────────────────

describe('streamingAtoms', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => { store = makeStore() })

  it('initial state is empty Set', () => {
    expect(store.getState().streamingAtoms.size).toBe(0)
  })

  it('setAtomStreaming adds the atomId', () => {
    store.getState().setAtomStreaming('a1')
    expect(store.getState().streamingAtoms.has('a1')).toBe(true)
  })

  it('setAtomStreaming for two atoms results in size 2', () => {
    store.getState().setAtomStreaming('a1')
    store.getState().setAtomStreaming('a2')
    expect(store.getState().streamingAtoms.size).toBe(2)
  })

  it('setAtomStreaming is idempotent', () => {
    store.getState().setAtomStreaming('a1')
    store.getState().setAtomStreaming('a1')
    expect(store.getState().streamingAtoms.size).toBe(1)
  })

  it('setAtomDone removes the atomId', () => {
    store.getState().setAtomStreaming('a1')
    store.getState().setAtomDone('a1')
    expect(store.getState().streamingAtoms.has('a1')).toBe(false)
  })

  it('setAtomDone only removes the target, leaves others', () => {
    store.getState().setAtomStreaming('a1')
    store.getState().setAtomStreaming('a2')
    store.getState().setAtomDone('a1')
    expect(store.getState().streamingAtoms.has('a1')).toBe(false)
    expect(store.getState().streamingAtoms.has('a2')).toBe(true)
  })

  it('setAtomDone on nonexistent id is a noop', () => {
    store.getState().setAtomStreaming('a1')
    store.getState().setAtomDone('nonexistent')
    expect(store.getState().streamingAtoms.size).toBe(1)
  })

  it('all atoms done results in empty Set', () => {
    store.getState().setAtomStreaming('a1')
    store.getState().setAtomStreaming('a2')
    store.getState().setAtomDone('a1')
    store.getState().setAtomDone('a2')
    expect(store.getState().streamingAtoms.size).toBe(0)
  })

  it('each call returns a new Set reference (Zustand reactivity)', () => {
    const before = store.getState().streamingAtoms
    store.getState().setAtomStreaming('a1')
    const after = store.getState().streamingAtoms
    expect(after).not.toBe(before)
  })

  it('setAtomDone returns a new Set reference', () => {
    store.getState().setAtomStreaming('a1')
    const before = store.getState().streamingAtoms
    store.getState().setAtomDone('a1')
    const after = store.getState().streamingAtoms
    expect(after).not.toBe(before)
  })
})

// ── streamingTexts ─────────────────────────────────────────────────────────

describe('streamingTexts', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => { store = makeStore() })

  it('initial state is empty Map', () => {
    expect(store.getState().streamingTexts.size).toBe(0)
  })

  it('appendStreamingText sets initial text', () => {
    store.getState().appendStreamingText('a1', 'Hello')
    expect(store.getState().streamingTexts.get('a1')).toBe('Hello')
  })

  it('appendStreamingText concatenates subsequent chunks', () => {
    store.getState().appendStreamingText('a1', 'Hello')
    store.getState().appendStreamingText('a1', ' world')
    expect(store.getState().streamingTexts.get('a1')).toBe('Hello world')
  })

  it('appendStreamingText for two atoms does not cross-contaminate', () => {
    store.getState().appendStreamingText('a1', 'AAA')
    store.getState().appendStreamingText('a2', 'BBB')
    expect(store.getState().streamingTexts.get('a1')).toBe('AAA')
    expect(store.getState().streamingTexts.get('a2')).toBe('BBB')
  })

  it('clearStreamingText removes the entry', () => {
    store.getState().appendStreamingText('a1', 'Hello')
    store.getState().clearStreamingText('a1')
    expect(store.getState().streamingTexts.has('a1')).toBe(false)
  })

  it('clearStreamingText only removes the target atom', () => {
    store.getState().appendStreamingText('a1', 'AAA')
    store.getState().appendStreamingText('a2', 'BBB')
    store.getState().clearStreamingText('a1')
    expect(store.getState().streamingTexts.has('a1')).toBe(false)
    expect(store.getState().streamingTexts.get('a2')).toBe('BBB')
  })

  it('clearStreamingText on nonexistent id is a noop', () => {
    store.getState().appendStreamingText('a1', 'AAA')
    store.getState().clearStreamingText('nonexistent')
    expect(store.getState().streamingTexts.get('a1')).toBe('AAA')
  })

  it('appendStreamingText returns a new Map reference', () => {
    const before = store.getState().streamingTexts
    store.getState().appendStreamingText('a1', 'chunk')
    const after = store.getState().streamingTexts
    expect(after).not.toBe(before)
  })

  it('clearStreamingText returns a new Map reference', () => {
    store.getState().appendStreamingText('a1', 'chunk')
    const before = store.getState().streamingTexts
    store.getState().clearStreamingText('a1')
    const after = store.getState().streamingTexts
    expect(after).not.toBe(before)
  })
})

// ── concurrent lifecycle ───────────────────────────────────────────────────

describe('concurrent streaming lifecycle', () => {
  it('two concurrent streams: both appear in streamingAtoms, texts are independent', () => {
    const store = makeStore()
    const { setAtomStreaming, appendStreamingText } = store.getState()

    setAtomStreaming('a1')
    setAtomStreaming('a2')
    appendStreamingText('a1', 'response A')
    appendStreamingText('a2', 'response B')

    const { streamingAtoms, streamingTexts } = store.getState()
    expect(streamingAtoms.size).toBe(2)
    expect(streamingTexts.get('a1')).toBe('response A')
    expect(streamingTexts.get('a2')).toBe('response B')
  })

  it('first stream done: removed from streamingAtoms, second unaffected', () => {
    const store = makeStore()
    store.getState().setAtomStreaming('a1')
    store.getState().setAtomStreaming('a2')
    store.getState().appendStreamingText('a1', 'done text')
    store.getState().setAtomDone('a1')
    store.getState().clearStreamingText('a1')

    const { streamingAtoms, streamingTexts } = store.getState()
    expect(streamingAtoms.has('a1')).toBe(false)
    expect(streamingAtoms.has('a2')).toBe(true)
    expect(streamingTexts.has('a1')).toBe(false)
  })

  it('error path: setAtomDone + clearStreamingText leaves store clean', () => {
    const store = makeStore()
    store.getState().setAtomStreaming('a1')
    store.getState().appendStreamingText('a1', 'partial...')
    // error occurs
    store.getState().setAtomDone('a1')
    store.getState().clearStreamingText('a1')

    expect(store.getState().streamingAtoms.size).toBe(0)
    expect(store.getState().streamingTexts.size).toBe(0)
  })
})
