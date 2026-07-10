import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createConversationSlice } from '../conversationSlice'
import type { ConversationSlice } from '../conversationSlice'

// v0.15 节点 1.2: renderer 统一通过 window.api.invoke 进入 Electron IPC
;(globalThis as unknown as { window: { api: { invoke: ReturnType<typeof vi.fn> } } }).window = {
  api: { invoke: vi.fn().mockResolvedValue(undefined) },
}
vi.mock('../../utils/paths', () => ({
  getBasePath: () => '/mock/base',
  getProjectsPath: () => '/mock/projects',
  getConversationsPath: () => '/mock/conversations',
  getVaultPath: () => '/mock/vault',
  getVaultConfig: () => null,
  useBasePath: () => '/mock/base',
  useProjectsPath: () => '/mock/projects',
  useConversationsPath: () => '/mock/conversations',
  useVaultPath: () => '/mock/vault',
  buildFilePath: (b: string, i: string) => (b && i ? `${b}/${i}.md` : ''),
  toFilePathFromSnapshot: (i: string) => (i ? `/mock/base/${i}.md` : ''),
}))

const invokeMock = (globalThis as unknown as {
  window: { api: { invoke: ReturnType<typeof vi.fn> } }
}).window.api.invoke

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockResolvedValue(undefined)
})

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

// ── req-067 conversation hierarchy ─────────────────────────────────────────

describe('req-067 conversation hierarchy', () => {
  it('selectAtom is bounded by the selected conversation atomIds', () => {
    const store = makeStore()
    store.setState({
      atoms: {
        r1: { id: 'r1', prev: null, children: [], summary: 'Root 1', timestamp: '' },
        c1: { id: 'c1', prev: '[[r1]]', children: [], summary: 'Child 1', timestamp: '' },
        r2: { id: 'r2', prev: null, children: [], summary: 'Root 2', timestamp: '' },
        c2: { id: 'c2', prev: '[[r2]]', children: [], summary: 'Child 2', timestamp: '' },
      },
      conversations: {
        conv1: {
          id: 'conv1',
          title: 'Conversation 1',
          projectId: 'proj1',
          rootAtomId: 'r1',
          atomIds: ['r1', 'c1'],
          status: 'active',
          createdAt: '',
          updatedAt: '',
        },
      },
      selectedConversationId: 'conv1',
    })

    store.getState().selectAtom('c1')
    expect(store.getState().currentPath.map((atom) => atom.id)).toEqual(['r1', 'c1'])

    store.setState({
      atoms: {
        ...store.getState().atoms,
        c1: { id: 'c1', prev: '[[r2]]', children: [], summary: 'Cross-linked', timestamp: '' },
      },
    })
    store.getState().selectAtom('c1')
    expect(store.getState().currentPath.map((atom) => atom.id)).toEqual(['c1'])
  })

  it('loadProjects splits folder-bound projects from legacy conversation groups', async () => {
    const store = makeStore()
    invokeMock.mockResolvedValueOnce([
      {
        id: 'proj1',
        name: 'Folder Project',
        folderPath: '/work/folder-project',
        rootBranchId: '',
        createdAt: '',
        atomIds: [],
        legacyAtomIds: [],
        conversationIds: [],
      },
      {
        id: 'legacy1',
        name: 'Legacy Group',
        folderPath: 'null',
        rootBranchId: '',
        createdAt: '',
        atomIds: ['root'],
        legacyAtomIds: ['root'],
        conversationIds: [],
      },
    ])

    await store.getState().loadProjects()

    expect(store.getState().projects.map((project) => project.id)).toEqual(['proj1'])
    expect(store.getState().conversationGroups.map((group) => group.id)).toEqual(['legacy1'])
  })

  it('loadConversations assigns persisted conversationIds from folder-bound projects', async () => {
    const store = makeStore()
    store.setState({
      atoms: {},
      projects: [{
        id: 'proj1',
        name: 'Project 1',
        rootBranchId: '',
        folderPath: '/work/project-1',
        createdAt: '',
        atomIds: [],
        legacyAtomIds: [],
        conversationIds: ['conv-project'],
      }],
    })
    invokeMock.mockResolvedValueOnce([{
      id: 'conv-project',
      title: 'Indexed project conversation',
      projectId: null,
      rootAtomId: null,
      atomIds: [],
      status: 'draft',
      createdAt: '',
      updatedAt: '',
    }])

    await store.getState().loadConversations()

    expect(store.getState().conversations['conv-project']).toMatchObject({
      projectId: 'proj1',
      groupId: null,
    })
  })

  it('loadConversations assigns persisted conversationIds from legacy conversation groups', async () => {
    const store = makeStore()
    store.setState({
      atoms: {},
      conversationGroups: [{
        id: 'group1',
        name: 'Legacy Group',
        createdAt: '',
        atomIds: [],
        legacyAtomIds: [],
        conversationIds: ['conv-group'],
      }],
    })
    invokeMock.mockResolvedValueOnce([{
      id: 'conv-group',
      title: 'Indexed group conversation',
      projectId: null,
      rootAtomId: null,
      atomIds: [],
      status: 'draft',
      createdAt: '',
      updatedAt: '',
    }])

    await store.getState().loadConversations()

    expect(store.getState().conversations['conv-group']).toMatchObject({
      projectId: null,
      groupId: 'group1',
    })
  })

  it('loadConversations preserves a legacy group with multiple roots as one canvas conversation', async () => {
    const store = makeStore()
    store.setState({
      atoms: {
        rootA: { id: 'rootA', prev: null, children: [], summary: 'Legacy root A', timestamp: '2026-01-01T00:00:00.000Z' },
        childA: { id: 'childA', prev: '[[rootA]]', children: [], summary: 'Legacy child A', timestamp: '2026-01-01T00:01:00.000Z' },
        rootB: { id: 'rootB', prev: null, children: [], summary: 'Legacy root B', timestamp: '2026-01-01T00:02:00.000Z' },
        childB: { id: 'childB', prev: '[[rootB]]', children: [], summary: 'Legacy child B', timestamp: '2026-01-01T00:03:00.000Z' },
      },
      conversationGroups: [{
        id: 'proj1',
        name: 'Project 1',
        createdAt: '',
        atomIds: [],
        legacyAtomIds: ['rootA', 'childA', 'rootB', 'childB'],
        conversationIds: [],
      }],
    })
    invokeMock.mockResolvedValueOnce([])

    await store.getState().loadConversations()

    const legacyConversations = Object.values(store.getState().conversations)
      .filter((conversation) => conversation.legacy)
    expect(legacyConversations).toHaveLength(1)
    const legacy = legacyConversations[0]
    expect(legacy).toMatchObject({
      id: 'legacy-group-proj1',
      title: 'Project 1',
      projectId: null,
      groupId: 'proj1',
      rootAtomId: 'rootA',
      atomIds: ['rootA', 'childA', 'rootB', 'childB'],
      status: 'active',
      sourcePath: 'Project 1',
    })
  })

  it('loadConversations materializes import bucket atom roots as a single conversation group canvas', async () => {
    const store = makeStore()
    store.setState({
      atoms: {
        root: { id: 'root', prev: null, children: [], summary: 'Imported root', timestamp: '2026-01-01T00:00:00.000Z' },
        child: { id: 'child', prev: '[[root]]', children: [], summary: 'Imported child', timestamp: '2026-01-01T00:01:00.000Z' },
      },
      conversationGroups: [{
        id: 'import-codex-local',
        name: '迁移-Codex',
        createdAt: '',
        atomIds: [],
        legacyAtomIds: ['root', 'child'],
        conversationIds: [],
      }],
    })
    invokeMock.mockResolvedValueOnce([])

    await store.getState().loadConversations()

    const legacy = Object.values(store.getState().conversations).find((conversation) => conversation.legacy)
    expect(legacy).toMatchObject({
      projectId: null,
      groupId: 'import-codex-local',
      rootAtomId: 'root',
      atomIds: ['root', 'child'],
      status: 'active',
      sourcePath: '迁移-Codex',
    })
  })

  it('loadConversations keeps persisted conversations assigned to folder-bound projects under the project', async () => {
    const store = makeStore()
    store.setState({
      atoms: {
        root: { id: 'root', prev: null, children: [], summary: 'Persisted root', timestamp: '2026-01-01T00:00:00.000Z' },
        child: { id: 'child', prev: '[[root]]', children: [], summary: 'Persisted child', timestamp: '2026-01-01T00:01:00.000Z' },
      },
      projects: [{
        id: 'proj1',
        name: 'Project 1',
        rootBranchId: '',
        folderPath: '/work/project-1',
        createdAt: '',
        atomIds: [],
        legacyAtomIds: [],
        conversationIds: ['conv1'],
      }],
    })
    invokeMock.mockResolvedValueOnce([{
      id: 'conv1',
      title: 'Persisted legacy',
      projectId: 'proj1',
      rootAtomId: 'root',
      atomIds: ['root', 'child'],
      status: 'active',
      createdAt: '',
      updatedAt: '',
    }])

    await store.getState().loadConversations()

    expect(store.getState().conversations.conv1).toMatchObject({
      projectId: 'proj1',
      groupId: null,
      rootAtomId: 'root',
      atomIds: ['root', 'child'],
    })
  })

  it('loadConversations moves persisted conversations derived from legacy groups out of projects', async () => {
    const store = makeStore()
    store.setState({
      atoms: {
        root: { id: 'root', prev: null, children: [], summary: 'Persisted import', timestamp: '2026-01-01T00:00:00.000Z' },
        child: { id: 'child', prev: '[[root]]', children: [], summary: 'Persisted child', timestamp: '2026-01-01T00:01:00.000Z' },
      },
      conversationGroups: [{
        id: 'import-claude-local',
        name: '迁移-Claude',
        createdAt: '',
        atomIds: [],
        legacyAtomIds: ['root', 'child'],
        conversationIds: ['conv-import'],
      }],
    })
    invokeMock.mockResolvedValueOnce([{
      id: 'conv-import',
      title: 'Persisted import',
      projectId: 'import-claude-local',
      rootAtomId: 'root',
      atomIds: ['root', 'child'],
      status: 'active',
      createdAt: '',
      updatedAt: '',
    }])

    await store.getState().loadConversations()

    expect(store.getState().conversations['conv-import']).toMatchObject({
      projectId: null,
      groupId: 'import-claude-local',
      rootAtomId: 'root',
      atomIds: ['root', 'child'],
      sourcePath: '迁移-Claude',
    })
  })

  it('loadConversations repairs persisted conversations with rootAtomId but empty atomIds', async () => {
    const store = makeStore()
    store.setState({
      atoms: {
        root: { id: 'root', prev: null, children: [], summary: 'Root', timestamp: '2026-01-01T00:00:00.000Z' },
        child: { id: 'child', prev: '[[root]]', children: [], summary: 'Child', timestamp: '2026-01-01T00:01:00.000Z' },
      },
      projects: [],
    })
    invokeMock.mockResolvedValueOnce([{
      id: 'conv-empty',
      title: 'Empty index',
      projectId: null,
      rootAtomId: 'root',
      atomIds: [],
      status: 'active',
      createdAt: '',
      updatedAt: '',
    }])

    await store.getState().loadConversations()
    store.getState().selectConversation('conv-empty')

    expect(store.getState().conversations['conv-empty']).toMatchObject({
      atomIds: ['root', 'child'],
    })
    expect(store.getState().currentPath.map((atom) => atom.id)).toEqual(['root'])
    expect(store.getState().selectedAtomId).toBe('root')
  })

  it('loadConversations preserves multiple unindexed roots as one unprojected legacy canvas', async () => {
    const store = makeStore()
    store.setState({
      atoms: {
        rootA: { id: 'rootA', prev: null, children: [], summary: 'Loose root A', timestamp: '2026-01-01T00:00:00.000Z' },
        childA: { id: 'childA', prev: '[[rootA]]', children: [], summary: 'Loose child A', timestamp: '2026-01-01T00:01:00.000Z' },
        rootB: { id: 'rootB', prev: null, children: [], summary: 'Loose root B', timestamp: '2026-01-01T00:02:00.000Z' },
        childB: { id: 'childB', prev: '[[rootB]]', children: [], summary: 'Loose child B', timestamp: '2026-01-01T00:03:00.000Z' },
      },
      projects: [],
    })
    invokeMock.mockResolvedValueOnce([])

    await store.getState().loadConversations()

    const legacyConversations = Object.values(store.getState().conversations)
      .filter((conversation) => conversation.legacy)
    expect(legacyConversations).toHaveLength(1)
    const legacy = legacyConversations[0]
    expect(legacy).toMatchObject({
      id: 'legacy-unprojected-canvas',
      title: '无项目旧画布',
      projectId: null,
      rootAtomId: 'rootA',
      atomIds: ['rootA', 'childA', 'rootB', 'childB'],
      status: 'active',
    })
  })
})
