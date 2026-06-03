import { StateCreator } from 'zustand'
import { BASE_PATH, PROJECTS_PATH } from '../utils/paths'

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
}

export interface QAAtomMeta {
  id: string
  prev: string | null
  children: string[]
  summary: string
  aPreview?: string
  timestamp: string
  // v0.3: token tracking (absent on older atoms)
  model?: string
  usage?: TokenUsage
  context_tokens_used?: number
  context_window_limit?: number
}

export interface ProjectMeta {
  id: string
  name: string
  rootBranchId: string
  createdAt: string
  atomIds: string[]
}

// v0.2: SSE 暂存事件类型
export interface SseEvent {
  type: string
  data: unknown
}

export interface ConversationSlice {
  atoms: Record<string, QAAtomMeta>
  selectedAtomId: string | null
  currentPath: QAAtomMeta[]
  streamingState: 'idle' | 'streaming' | 'cancelled' | 'error' | 'paused'
  /**
   * v0.15.1 P5 r14：error 状态下的具体错误消息（来自 agent:event { type:'error', message }）。
   * ChatViewV2 错误区优先显示这条具体消息，否则回退到「请检查网络或 API Key」兜底文案。
   */
  lastErrorMessage: string | null
  projects: ProjectMeta[]
  selectedProjectId: string | null
  // v0.2 新增
  pendingBackendEvents: SseEvent[]
  isUserInputting: boolean
  // v0.14 req-051: 并发流状态
  streamingAtoms: Set<string>
  streamingTexts: Map<string, string>
  loadAtoms: () => Promise<void>
  selectAtom: (id: string) => void
  appendAtom: (atom: QAAtomMeta) => void
  setStreamingState: (s: 'idle' | 'streaming' | 'cancelled' | 'error' | 'paused') => void
  /** v0.15.1 P5 r14：写入具体错误消息（与 setStreamingState('error') 配对使用） */
  setLastErrorMessage: (msg: string | null) => void
  loadProjects: () => Promise<void>
  createProject: (name: string) => Promise<void>
  addAtomToProject: (projectName: string, atomId: string) => Promise<void>
  selectProject: (id: string | null) => void
  // v0.2 actions
  setPendingBackendEvent: (event: SseEvent) => void
  setIsUserInputting: (inputting: boolean) => void
  clearPendingEvents: () => void
  // v0.3 actions
  updateAtomTokens: (id: string, meta: { model?: string; usage?: TokenUsage; contextTokensUsed?: number; contextWindowLimit?: number }) => void
  // v0.14 req-051 actions
  setAtomStreaming: (atomId: string) => void
  setAtomDone: (atomId: string) => void
  appendStreamingText: (atomId: string, text: string) => void
  clearStreamingText: (atomId: string) => void
}

export const createConversationSlice: StateCreator<ConversationSlice> = (set, get) => ({
  atoms: {},
  selectedAtomId: null,
  currentPath: [],
  streamingState: 'idle',
  lastErrorMessage: null,
  projects: [],
  selectedProjectId: null,
  // v0.2 初始值
  pendingBackendEvents: [],
  isUserInputting: false,
  // v0.14 req-051 初始值
  streamingAtoms: new Set<string>(),
  streamingTexts: new Map<string, string>(),

  loadAtoms: async () => {
    const list = await window.api.invoke<QAAtomMeta[]>('list_qa_atoms', {
      conversationDir: BASE_PATH,
    })
    const atomMap: Record<string, QAAtomMeta> = {}
    for (const atom of list) {
      atomMap[atom.id] = atom
    }
    set({ atoms: atomMap })
  },

  // v0.15.1 P3 验收修订（2026-06-03，r10）：先 trim 再 strip [[]]，避免「[[id]]  」尾随空白
  // 导致 `]]$` 不匹配（strip 后剩 `id]]`）；同时加 visited Set 兜底 prev 链路成环不死循环。
  selectAtom: (id) => {
    set((state) => {
      const path: QAAtomMeta[] = []
      const visited = new Set<string>()
      let cur: QAAtomMeta | undefined = state.atoms[id]
      while (cur && !visited.has(cur.id)) {
        visited.add(cur.id)
        path.unshift(cur)
        const prevId: string | null = cur.prev
          ? cur.prev.trim().replace(/^\[\[|\]\]$/g, '') || null
          : null
        cur = prevId ? state.atoms[prevId] : undefined
      }
      return { selectedAtomId: id, currentPath: path }
    })
    const { currentPath, atoms } = get()
    const depth = Object.keys(atoms).indexOf(id)
    window.api.invoke('write_event_log', { event: { event: 'node_selected', timestamp: new Date().toISOString(), payload: { atom_id: id, depth, path_length: currentPath.length } } }).catch(() => {})
  },

  appendAtom: (atom) =>
    set((state) => ({
      atoms: { ...state.atoms, [atom.id]: atom },
    })),

  setStreamingState: (s) =>
    set((state) => ({
      streamingState: s,
      // 进入 idle / streaming / paused 时清除上一次错误，避免错误条残留
      lastErrorMessage: s === 'error' ? state.lastErrorMessage : null,
    })),
  setLastErrorMessage: (msg) => set({ lastErrorMessage: msg }),

  loadProjects: async () => {
    const list = await window.api.invoke<ProjectMeta[]>('list_projects', {
      projectsDir: PROJECTS_PATH,
    })
    set({ projects: list })
  },

  createProject: async (name) => {
    const newProject = await window.api.invoke<ProjectMeta>('create_project', {
      projectsDir: PROJECTS_PATH,
      name,
    })
    // 追加到本地状态并自动选中，避免再次 invoke list_projects（减少 I/O）
    set((state) => ({
      projects: [...state.projects, newProject],
      selectedProjectId: newProject.id,
    }))
  },

  addAtomToProject: async (projectName, atomId) => {
    await window.api.invoke('add_atom_to_project', {
      projectsDir: PROJECTS_PATH,
      projectName,
      atomId,
    })
    set((state) => ({
      projects: state.projects.map((p) =>
        p.name === projectName && !p.atomIds.includes(atomId)
          ? { ...p, atomIds: [...p.atomIds, atomId] }
          : p
      ),
    }))
  },

  // 切换项目时清空节点选中状态，根节点由发送第一条消息时自动创建
  selectProject: (id) => set({ selectedProjectId: id, selectedAtomId: null, currentPath: [] }),

  // v0.2 actions
  setPendingBackendEvent: (event) =>
    set((state) => ({
      pendingBackendEvents: [...state.pendingBackendEvents, event],
    })),
  setIsUserInputting: (inputting) => set({ isUserInputting: inputting }),
  clearPendingEvents: () => set({ pendingBackendEvents: [] }),
  // v0.3
  updateAtomTokens: (id, meta) =>
    set((state) => {
      const atom = state.atoms[id]
      if (!atom) return {}
      return {
        atoms: {
          ...state.atoms,
          [id]: {
            ...atom,
            ...(meta.model !== undefined ? { model: meta.model } : {}),
            ...(meta.usage !== undefined ? { usage: meta.usage } : {}),
            ...(meta.contextTokensUsed !== undefined ? { context_tokens_used: meta.contextTokensUsed } : {}),
            ...(meta.contextWindowLimit !== undefined ? { context_window_limit: meta.contextWindowLimit } : {}),
          },
        },
      }
    }),
  // v0.14 req-051 actions
  setAtomStreaming: (atomId) =>
    set((state) => ({
      streamingAtoms: new Set([...state.streamingAtoms, atomId]),
    })),
  setAtomDone: (atomId) =>
    set((state) => {
      const next = new Set(state.streamingAtoms)
      next.delete(atomId)
      return { streamingAtoms: next }
    }),
  appendStreamingText: (atomId, text) =>
    set((state) => {
      const next = new Map(state.streamingTexts)
      next.set(atomId, (next.get(atomId) ?? '') + text)
      return { streamingTexts: next }
    }),
  clearStreamingText: (atomId) =>
    set((state) => {
      const next = new Map(state.streamingTexts)
      next.delete(atomId)
      return { streamingTexts: next }
    }),
})
