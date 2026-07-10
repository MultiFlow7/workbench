import { StateCreator } from 'zustand'
import { getBasePath, getProjectsPath, getConversationsPath } from '../utils/paths'

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
  folderPath?: string
  source?: string
  atomIds: string[]
  conversationIds: string[]
  legacyAtomIds?: string[]
}

export interface ConversationGroupMeta {
  id: string
  name: string
  createdAt: string
  source?: string
  atomIds: string[]
  conversationIds: string[]
  legacyAtomIds?: string[]
}

export interface ConversationMeta {
  id: string
  title: string
  projectId: string | null
  groupId?: string | null
  rootAtomId: string | null
  atomIds: string[]
  status: 'draft' | 'active'
  createdAt: string
  updatedAt: string
  sourcePlatform?: 'workbench' | 'codex' | 'claude'
  sourceSessionId?: string
  sourcePath?: string
  sourceCwd?: string
  legacy?: boolean
}

// v0.2: SSE 暂存事件类型
export interface SseEvent {
  type: string
  data: unknown
}

function stripWikiRef(value: string | null | undefined): string | null {
  return value ? value.trim().replace(/^\[\[|\]\]$/g, '') || null : null
}

function normalizeOptionalScalar(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return undefined
  return trimmed
}

function buildPathWithinConversation(
  atomId: string,
  atoms: Record<string, QAAtomMeta>,
  conversation: ConversationMeta | null,
): QAAtomMeta[] {
  const path: QAAtomMeta[] = []
  const visited = new Set<string>()
  const allowed = conversation
    ? new Set(conversation.atomIds)
    : new Set(Object.keys(atoms))
  let cur: QAAtomMeta | undefined = atoms[atomId]
  while (cur && !visited.has(cur.id) && allowed.has(cur.id)) {
    visited.add(cur.id)
    path.unshift(cur)
    const prevId = stripWikiRef(cur.prev)
    if (!prevId || !allowed.has(prevId)) break
    cur = atoms[prevId]
  }
  return path
}

function collectConversationSubtree(
  rootAtomId: string,
  atoms: Record<string, QAAtomMeta>,
  allowedIds: Set<string>,
): string[] {
  const result: string[] = []
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visited.has(id) || !allowedIds.has(id) || !atoms[id]) return
    visited.add(id)
    result.push(id)
    for (const atom of Object.values(atoms)) {
      if (stripWikiRef(atom.prev) === id) visit(atom.id)
    }
  }
  visit(rootAtomId)
  return result
}

function findRootsWithinIds(
  ids: string[],
  atoms: Record<string, QAAtomMeta>,
): string[] {
  const allowed = new Set(ids)
  return ids.filter((id) => {
    const atom = atoms[id]
    if (!atom) return false
    const parentId = stripWikiRef(atom.prev)
    return parentId === null || !allowed.has(parentId)
  })
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)]
}

function buildLegacyConversations(
  groups: ConversationGroupMeta[],
  atoms: Record<string, QAAtomMeta>,
  persisted: Record<string, ConversationMeta>,
): Record<string, ConversationMeta> {
  const legacy: Record<string, ConversationMeta> = {}
  const processedRoots = new Set<string>()
  const coveredRoots = new Set(
    Object.values(persisted)
      .filter((c) => c.rootAtomId)
      .map((c) => c.rootAtomId as string),
  )
  for (const group of groups) {
    const indexedIds = uniqueIds((group.legacyAtomIds ?? group.atomIds ?? []).filter((id) => atoms[id]))
    if (indexedIds.length === 0) continue
    const indexedRoots = findRootsWithinIds(indexedIds, atoms)
    const rootIds = indexedRoots.length > 0 ? indexedRoots : [indexedIds[0]]
    const primaryRootId = rootIds[0]
    if (coveredRoots.has(primaryRootId)) {
      rootIds.forEach((rootId) => processedRoots.add(rootId))
      continue
    }
    const allAtomIds = new Set(Object.keys(atoms))
    const atomIds = uniqueIds([
      ...rootIds.flatMap((rootId) => collectConversationSubtree(rootId, atoms, allAtomIds)),
      ...indexedIds,
    ])
    const timestamps = atomIds.map((id) => atoms[id]?.timestamp).filter(Boolean) as string[]
    rootIds.forEach((rootId) => processedRoots.add(rootId))
    const id = `legacy-group-${group.id}`
    legacy[id] = {
      id,
      title: group.name || atoms[primaryRootId]?.summary || '旧画布',
      projectId: null,
      groupId: group.id,
      rootAtomId: primaryRootId,
      atomIds,
      status: 'active',
      createdAt: timestamps[0] ?? '',
      updatedAt: timestamps[timestamps.length - 1] ?? timestamps[0] ?? '',
      sourcePlatform: 'workbench',
      sourcePath: group.name,
      legacy: true,
    }
  }

  const allAtomIds = new Set(Object.keys(atoms))
  const unindexedRoots = Object.values(atoms).filter((atom) => {
    if (coveredRoots.has(atom.id) || processedRoots.has(atom.id)) return false
    const parentId = stripWikiRef(atom.prev)
    return parentId === null || !allAtomIds.has(parentId)
  })
  if (unindexedRoots.length > 0) {
    const root = unindexedRoots[0]
    const atomIds = uniqueIds(unindexedRoots.flatMap((candidate) =>
      collectConversationSubtree(candidate.id, atoms, allAtomIds)
    ))
    const timestamps = atomIds.map((id) => atoms[id]?.timestamp).filter(Boolean) as string[]
    const id = 'legacy-unprojected-canvas'
    legacy[id] = {
      id,
      title: '无项目旧画布',
      projectId: null,
      rootAtomId: root.id,
      atomIds,
      status: 'active',
      createdAt: timestamps[0] ?? root.timestamp ?? '',
      updatedAt: timestamps[timestamps.length - 1] ?? root.timestamp ?? '',
      sourcePlatform: 'workbench',
      legacy: true,
    }
  }
  return legacy
}

function normalizePersistedConversations(
  projects: ProjectMeta[],
  groups: ConversationGroupMeta[],
  atoms: Record<string, QAAtomMeta>,
  list: ConversationMeta[],
): Record<string, ConversationMeta> {
  const allAtomIds = new Set(Object.keys(atoms))
  const legacyAtomIds = new Set<string>()
  const legacyRootSource = new Map<string, string>()
  const legacyRootGroupId = new Map<string, string>()
  const projectIds = new Set(projects.map((project) => project.id))
  const groupIds = new Set(groups.map((group) => group.id))
  const projectConversationIds = new Map<string, string>()
  const groupConversationIds = new Map<string, string>()

  for (const project of projects) {
    for (const conversationId of project.conversationIds ?? []) {
      projectConversationIds.set(conversationId, project.id)
    }
  }

  for (const group of groups) {
    for (const conversationId of group.conversationIds ?? []) {
      groupConversationIds.set(conversationId, group.id)
    }
    const ids = group.legacyAtomIds ?? group.atomIds ?? []
    const allowed = new Set(ids)
    for (const id of ids) {
      legacyAtomIds.add(id)
      const atom = atoms[id]
      if (!atom) continue
      const parentId = stripWikiRef(atom.prev)
      if (parentId === null || !allowed.has(parentId)) {
        legacyRootSource.set(id, group.name)
        legacyRootGroupId.set(id, group.id)
      }
    }
  }

  const persisted: Record<string, ConversationMeta> = {}
  for (const conv of list) {
    const rootAtomId = conv.rootAtomId && atoms[conv.rootAtomId]
      ? conv.rootAtomId
      : conv.atomIds.find((id) => atoms[id]) ?? conv.rootAtomId
    let atomIds = conv.atomIds.filter((id) => atoms[id])
    if (rootAtomId && atoms[rootAtomId] && (!atomIds.includes(rootAtomId) || atomIds.length === 0)) {
      const allowed = atomIds.length > 0 ? new Set([...atomIds, rootAtomId]) : allAtomIds
      atomIds = collectConversationSubtree(rootAtomId, atoms, allowed)
    }

    const isLegacyDerived = !!rootAtomId && legacyAtomIds.has(rootAtomId)
    const groupIdFromRoot = rootAtomId ? legacyRootGroupId.get(rootAtomId) : undefined
    const groupIdFromLegacyProject = conv.projectId && groupIds.has(conv.projectId)
      ? conv.projectId
      : undefined
    const groupIdFromIndex = groupConversationIds.get(conv.id)
    const projectIdFromIndex = projectConversationIds.get(conv.id)
    const normalizedGroupId = isLegacyDerived
      ? groupIdFromRoot ?? groupIdFromLegacyProject ?? groupIdFromIndex ?? conv.groupId ?? null
      : groupIdFromIndex ?? conv.groupId ?? null
    const normalizedProjectId = normalizedGroupId
      ? null
      : projectIds.has(conv.projectId ?? '')
        ? conv.projectId
        : projectIdFromIndex ?? null
    persisted[conv.id] = {
      ...conv,
      projectId: normalizedProjectId,
      groupId: normalizedGroupId,
      rootAtomId: rootAtomId ?? null,
      atomIds,
      status: rootAtomId || atomIds.length > 0 ? 'active' : conv.status,
      ...(isLegacyDerived && !conv.sourcePath && rootAtomId && legacyRootSource.has(rootAtomId)
        ? { sourcePath: legacyRootSource.get(rootAtomId) }
        : {}),
    }
  }
  return persisted
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
  conversationGroups: ConversationGroupMeta[]
  selectedProjectId: string | null
  conversations: Record<string, ConversationMeta>
  selectedConversationId: string | null
  conversationPanelMode: 'list' | 'tree'
  // v0.2 新增
  pendingBackendEvents: SseEvent[]
  isUserInputting: boolean
  // v0.14 req-051: 并发流状态
  streamingAtoms: Set<string>
  streamingTexts: Map<string, string>
  /**
   * v0.15.1 P7（r16）：atom 落盘版本号。每次 dispatcher `_flushAtomToDisk`
   * 成功后递增对应 atom 的版本号，触发 useChatSend 的 atomEntries 重载，让
   * 末位 atom 从「流式 streamingTexts」平滑切换到「磁盘 parsed.response」。
   */
  atomDiskRevisions: Record<string, number>
  loadAtoms: () => Promise<void>
  selectAtom: (id: string) => void
  appendAtom: (atom: QAAtomMeta) => void
  /**
   * v0.15.1 P7（r16）：把新 atom 追加到 `currentPath` 末尾（仅当其 prev 与
   * 当前 path 末位匹配 / 或 path 为空 + prev=null）。`appendAtom` 仅写入
   * `atoms` 字典，不更新 path —— 流式发送时若不显式扩展 path，
   * `useChatSend` useEffect 不会重载 atomEntries，导致新节点流式期间无法
   * 在 P3 渲染（详见 v0.15.1 P7 复盘）。
   */
  extendCurrentPath: (atom: QAAtomMeta) => void
  bumpAtomDiskRevision: (atomId: string) => void
  setStreamingState: (s: 'idle' | 'streaming' | 'cancelled' | 'error' | 'paused') => void
  /** v0.15.1 P5 r14：写入具体错误消息（与 setStreamingState('error') 配对使用） */
  setLastErrorMessage: (msg: string | null) => void
  loadProjects: () => Promise<void>
  loadConversations: () => Promise<void>
  createProject: (name: string, folderPath: string) => Promise<void>
  createConversation: (title?: string, projectId?: string | null) => Promise<ConversationMeta>
  selectConversation: (id: string) => void
  returnToConversationList: () => void
  addAtomToConversation: (conversationId: string, atomId: string, rootAtomId?: string | null) => Promise<ConversationMeta | null>
  materializeLegacyConversation: (conversationId: string) => Promise<ConversationMeta | null>
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
  conversationGroups: [],
  selectedProjectId: null,
  conversations: {},
  selectedConversationId: null,
  conversationPanelMode: 'list',
  // v0.2 初始值
  pendingBackendEvents: [],
  isUserInputting: false,
  // v0.14 req-051 初始值
  streamingAtoms: new Set<string>(),
  streamingTexts: new Map<string, string>(),
  // v0.15.1 P7（r16）初始值
  atomDiskRevisions: {},

  loadAtoms: async () => {
    const list = await window.api.invoke<QAAtomMeta[]>('list_qa_atoms', {
      conversationDir: getBasePath(),
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
      const conversation = state.selectedConversationId
        ? state.conversations[state.selectedConversationId] ?? null
        : null
      const path = buildPathWithinConversation(id, state.atoms, conversation)
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

  // v0.15.1 P7（r16）：扩展 currentPath，让流式新节点立即出现在 P3 渲染队列。
  // 只在 atom.prev 与 path 末位匹配 / 或 path 为空 + prev=null 时追加，避免错配。
  extendCurrentPath: (atom) =>
    set((state) => {
      const stripWiki = (s: string | null | undefined) =>
        s ? s.trim().replace(/^\[\[|\]\]$/g, '') : null
      const tail = state.currentPath[state.currentPath.length - 1]
      const atomPrevId = stripWiki(atom.prev)
      const matchesTail = tail
        ? atomPrevId === tail.id
        : atomPrevId === null
      if (!matchesTail) return {}
      // 已在 path 中则不重复追加
      if (state.currentPath.some((m) => m.id === atom.id)) return {}
      return {
        currentPath: [...state.currentPath, atom],
        selectedAtomId: atom.id,
      }
    }),

  bumpAtomDiskRevision: (atomId) =>
    set((state) => ({
      atomDiskRevisions: {
        ...state.atomDiskRevisions,
        [atomId]: (state.atomDiskRevisions[atomId] ?? 0) + 1,
      },
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
      projectsDir: getProjectsPath(),
    })
    const normalized = list.map((p) => ({
      ...p,
      folderPath: normalizeOptionalScalar(p.folderPath),
      conversationIds: p.conversationIds ?? [],
      legacyAtomIds: p.legacyAtomIds ?? p.atomIds ?? [],
      atomIds: p.atomIds ?? [],
    }))
    set({
      projects: normalized.filter((p) => !!p.folderPath),
      conversationGroups: normalized
        .filter((p) => !p.folderPath)
        .map((p) => ({
          id: p.id,
          name: p.name,
          createdAt: p.createdAt,
          source: p.source,
          conversationIds: p.conversationIds,
          legacyAtomIds: p.legacyAtomIds,
          atomIds: p.atomIds,
        })),
    })
  },

  loadConversations: async () => {
    const list = await window.api.invoke<ConversationMeta[]>('list_conversations', {
      conversationsDir: getConversationsPath(),
    })
    set((state) => {
      const persisted = normalizePersistedConversations(state.projects, state.conversationGroups, state.atoms, list)
      const legacy = buildLegacyConversations(state.conversationGroups, state.atoms, persisted)
      return { conversations: { ...persisted, ...legacy } }
    })
  },

  createProject: async (name, folderPath) => {
    const newProject = await window.api.invoke<ProjectMeta>('create_project', {
      projectsDir: getProjectsPath(),
      name,
      folderPath,
    })
    // 追加到本地状态并自动选中，避免再次 invoke list_projects（减少 I/O）
    set((state) => ({
      projects: [...state.projects, newProject],
      selectedProjectId: newProject.id,
      selectedConversationId: null,
      selectedAtomId: null,
      currentPath: [],
      conversationPanelMode: 'list',
    }))
  },

  createConversation: async (title, projectId) => {
    const targetProjectId = projectId === undefined ? get().selectedProjectId : projectId
    const conversation = await window.api.invoke<ConversationMeta>('create_conversation', {
      conversationsDir: getConversationsPath(),
      projectsDir: getProjectsPath(),
      title,
      projectId: targetProjectId,
      sourcePlatform: 'workbench',
    })
    set((state) => ({
      conversations: { ...state.conversations, [conversation.id]: conversation },
      projects: state.projects.map((p) =>
        targetProjectId && p.id === targetProjectId && !p.conversationIds.includes(conversation.id)
          ? { ...p, conversationIds: [...p.conversationIds, conversation.id] }
          : p
      ),
      selectedProjectId: targetProjectId,
      selectedConversationId: conversation.id,
      selectedAtomId: null,
      currentPath: [],
      conversationPanelMode: 'tree',
    }))
    return conversation
  },

  selectConversation: (id) => {
    set((state) => {
      const conversation = state.conversations[id]
      if (!conversation) return {}
      const targetAtomId = conversation.rootAtomId && state.atoms[conversation.rootAtomId]
        ? conversation.rootAtomId
        : conversation.atomIds.find((atomId) => state.atoms[atomId]) ?? null
      if (!targetAtomId) {
        return {
          selectedProjectId: conversation.projectId,
          selectedConversationId: id,
          selectedAtomId: null,
          currentPath: [],
          conversationPanelMode: 'tree',
        }
      }
      const normalizedConversation = conversation.atomIds.includes(targetAtomId)
        ? conversation
        : { ...conversation, atomIds: [targetAtomId, ...conversation.atomIds] }
      const path = buildPathWithinConversation(targetAtomId, state.atoms, normalizedConversation)
      return {
        selectedProjectId: conversation.projectId,
        selectedConversationId: id,
        selectedAtomId: targetAtomId,
        currentPath: path,
        conversationPanelMode: 'tree',
      }
    })
  },

  returnToConversationList: () => set({ conversationPanelMode: 'list' }),

  addAtomToConversation: async (conversationId, atomId, rootAtomId) => {
    const updated = await window.api.invoke<ConversationMeta | null>('add_atom_to_conversation', {
      conversationsDir: getConversationsPath(),
      conversationId,
      atomId,
      rootAtomId,
    })
    if (!updated) return null
    set((state) => ({
      conversations: { ...state.conversations, [updated.id]: updated },
    }))
    return updated
  },

  materializeLegacyConversation: async (conversationId) => {
    const legacy = get().conversations[conversationId]
    if (!legacy) return null
    if (!legacy.legacy) return legacy
    const created = await get().createConversation(legacy.title, legacy.projectId)
    const active: ConversationMeta = {
      ...created,
      groupId: legacy.groupId ?? null,
      rootAtomId: legacy.rootAtomId,
      atomIds: legacy.atomIds,
      status: legacy.rootAtomId ? 'active' : 'draft',
      updatedAt: new Date().toISOString(),
    }
    const updated = await window.api.invoke<ConversationMeta>('update_conversation', {
      conversationsDir: getConversationsPath(),
      conversation: active,
    })
    set((state) => {
      const conversations = { ...state.conversations }
      delete conversations[conversationId]
      conversations[updated.id] = updated
      return {
        conversations,
        selectedConversationId: updated.id,
      }
    })
    return updated
  },

  addAtomToProject: async (projectName, atomId) => {
    await window.api.invoke('add_atom_to_project', {
      projectsDir: getProjectsPath(),
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

  // 切换项目/无项目入口时回到 conversation list，根节点由发送第一条消息时自动创建
  selectProject: (id) => set({
    selectedProjectId: id,
    selectedConversationId: null,
    selectedAtomId: null,
    currentPath: [],
    conversationPanelMode: 'list',
  }),

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
