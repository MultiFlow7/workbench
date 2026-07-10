import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import type { ConversationMeta, QAAtomMeta } from '../../store/conversationSlice'
import './NavList.css'

function formatShortDate(conversation: ConversationMeta): string | null {
  const time = getConversationTime(conversation)
  if (!time) return null
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

function formatConversationTitle(conversation: ConversationMeta, duplicateTitle: boolean): string {
  const title = conversation.title?.trim() || '新对话'
  const base = title.length > 22 ? `${title.slice(0, 22)}...` : title
  const needsQualifier = duplicateTitle || title === '新对话' || !conversation.title?.trim()
  if (!needsQualifier) return base
  const qualifier = formatShortDate(conversation) ?? conversation.sourcePlatform
  return qualifier ? `${base} · ${qualifier}` : base
}

function getConversationTime(conversation: ConversationMeta): number {
  const ts = Date.parse(conversation.updatedAt || conversation.createdAt || '')
  return Number.isNaN(ts) ? 0 : ts
}

function conversationCountLabel(conversation: ConversationMeta): string | null {
  if (conversation.status === 'draft') return '草稿'
  if (conversation.atomIds.length === 0) return null
  return String(conversation.atomIds.length)
}

function stripWikiRef(value: string | null | undefined): string | null {
  return value ? value.trim().replace(/^\[\[|\]\]$/g, '') || null : null
}

function getConversationRoots(
  conversation: ConversationMeta,
  atoms: Record<string, QAAtomMeta>,
): QAAtomMeta[] {
  const allowed = new Set(conversation.atomIds)
  return conversation.atomIds
    .map((id) => atoms[id])
    .filter((atom): atom is QAAtomMeta => !!atom)
    .filter((atom) => {
      const parentId = stripWikiRef(atom.prev)
      return parentId === null || !allowed.has(parentId)
    })
}

function formatRootTitle(atom: QAAtomMeta): string {
  const title = atom.summary?.trim() || atom.id
  return title.length > 24 ? `${title.slice(0, 24)}...` : title
}

export function NavList() {
  const {
    atoms,
    projects,
    setMode,
    createProject,
    conversations,
    selectedConversationId,
    selectedAtomId,
    createConversation,
    readCodexSession,
    selectConversation,
    selectAtom,
  } = useStore()

  const [newProjectError, setNewProjectError] = useState<string | null>(null)
  const [newProjectLoading, setNewProjectLoading] = useState(false)
  const [relayLoading, setRelayLoading] = useState(false)
  const [relayError, setRelayError] = useState<string | null>(null)
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set())
  const [expandedConversationIds, setExpandedConversationIds] = useState<Set<string>>(new Set())

  // 内存优先策略：先解锁 textarea，再异步处理项目关联和磁盘写入
  const handleNewConversation = async () => {
    setMode('chat')
    try {
      await createConversation('新对话', null)
    } catch (e) {
      console.error('[NavList] createConversation failed:', String(e))
    }
  }

  const folderNameFromPath = (folderPath: string) => {
    const normalized = folderPath.replace(/[/\\]+$/, '')
    return normalized.split(/[/\\]/).pop()?.trim() || '新项目'
  }

  const handleNewProject = async () => {
    setNewProjectLoading(true)
    setNewProjectError(null)
    try {
      const folderPath = await window.api.invoke<string | null>('vault:pick-folder', {
        title: '选择项目文件夹',
      })
      if (!folderPath) return
      await createProject(folderNameFromPath(folderPath), folderPath)
    } catch (e) {
      setNewProjectError(String(e))
    } finally {
      setNewProjectLoading(false)
    }
  }

  const handleReadCodexSession = async () => {
    const input = window.prompt('输入 Codex session id 或 ~/.codex/sessions 下的 jsonl 路径')
    const value = input?.trim()
    if (!value) return
    setRelayLoading(true)
    setRelayError(null)
    try {
      const looksLikePath = value.includes('/') || value.endsWith('.jsonl')
      const result = await readCodexSession(looksLikePath ? { sourcePath: value } : { sessionId: value })
      setExpandedConversationIds((prev) => new Set(prev).add(result.conversation.id))
      setMode('chat')
    } catch (e) {
      setRelayError(String(e))
    } finally {
      setRelayLoading(false)
    }
  }

  const getProjectConversations = (projectId: string) => Object.values(conversations)
    .filter((conversation) => conversation.projectId === projectId)
    .sort((a, b) => getConversationTime(b) - getConversationTime(a))
  const unprojectedConversations = Object.values(conversations)
    .filter((conversation) => conversation.projectId === null)
    .sort((a, b) => getConversationTime(b) - getConversationTime(a))
  const titleCounts = Object.values(conversations).reduce<Record<string, number>>((acc, conversation) => {
    const title = conversation.title?.trim() || '新对话'
    acc[title] = (acc[title] ?? 0) + 1
    return acc
  }, {})

  useEffect(() => {
    const selectedConversation = selectedConversationId
      ? conversations[selectedConversationId]
      : null
    const projectId = selectedConversation?.projectId
    if (selectedConversationId) {
      setExpandedConversationIds((prev) => {
        if (prev.has(selectedConversationId)) return prev
        const next = new Set(prev)
        next.add(selectedConversationId)
        return next
      })
    }
    if (projectId) {
      setExpandedProjectIds((prev) => {
        if (prev.has(projectId)) return prev
        const next = new Set(prev)
        next.add(projectId)
        return next
      })
    }
  }, [conversations, selectedConversationId])

  const handleSelectConversation = (conversationId: string) => {
    selectConversation(conversationId)
    setMode('chat')
  }

  const handleSelectStartPoint = (conversationId: string, atomId: string) => {
    selectConversation(conversationId)
    selectAtom(atomId)
    setMode('chat')
  }

  const toggleProject = (projectId: string) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const toggleConversation = (conversationId: string) => {
    setExpandedConversationIds((prev) => {
      const next = new Set(prev)
      if (next.has(conversationId)) next.delete(conversationId)
      else next.add(conversationId)
      return next
    })
  }

  const renderConversationRow = (conversation: ConversationMeta) => {
    const countLabel = conversationCountLabel(conversation)
    const title = conversation.title?.trim() || '新对话'
    const duplicateTitle = (titleCounts[title] ?? 0) > 1
    const roots = getConversationRoots(conversation, atoms)
    const expanded = expandedConversationIds.has(conversation.id)
    const canExpand = roots.length > 0
    return (
      <li key={conversation.id}>
        <button
          className={`nav-list__item nav-list__item--conversation${
            selectedConversationId === conversation.id ? ' nav-list__item--active' : ''
          }`}
          onClick={() => handleSelectConversation(conversation.id)}
          title={conversation.title || conversation.id}
        >
          <span
            className={`nav-list__chevron nav-list__chevron--conversation${expanded ? ' nav-list__chevron--open' : ''}${!canExpand ? ' nav-list__chevron--hidden' : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              if (canExpand) toggleConversation(conversation.id)
            }}
          >
            ›
          </span>
          <span
            className={`nav-list__pip${
              selectedConversationId === conversation.id ? ' nav-list__pip--active' : ''
            }`}
          />
          <span className="nav-list__item-name">
            {formatConversationTitle(conversation, duplicateTitle)}
          </span>
          {conversation.legacy && (
            <span className="nav-list__badge">旧</span>
          )}
          {countLabel && (
            <span className="nav-list__item-count">{countLabel}</span>
          )}
        </button>
        {expanded && roots.length > 0 && (
          <ul className="nav-list__items nav-list__items--starts">
            {roots.map((root) => (
              <li key={`${conversation.id}-${root.id}`}>
                <button
                  className={`nav-list__item nav-list__item--start${
                    selectedConversationId === conversation.id && selectedAtomId === root.id
                      ? ' nav-list__item--active'
                      : ''
                  }`}
                  onClick={() => handleSelectStartPoint(conversation.id, root.id)}
                  title={root.summary || root.id}
                >
                  <span
                    className={`nav-list__pip nav-list__pip--start${
                      selectedConversationId === conversation.id && selectedAtomId === root.id
                        ? ' nav-list__pip--active'
                        : ''
                    }`}
                  />
                  <span className="nav-list__item-name">{formatRootTitle(root)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <div className="nav-list">
      {/* 新建对话 */}
      <div className="nav-list__new">
        <button className="nav-list__new-btn" onClick={handleNewConversation}>
          + 新建对话
        </button>
        <button className="nav-list__relay-btn" onClick={handleReadCodexSession} disabled={relayLoading}>
          {relayLoading ? '读取中…' : '读取 Codex 会话'}
        </button>
      </div>
      {relayError && (
        <div className="nav-list__error" onClick={() => setRelayError(null)}>
          {relayError}
        </div>
      )}

      <section className="nav-list__section">
        <div className="nav-list__section-header">
          <h3 className="nav-list__heading">项目</h3>
          <button
            className="nav-list__section-add"
            onClick={handleNewProject}
            title="选择文件夹创建项目"
            disabled={newProjectLoading}
          >
            +
          </button>
        </div>

        {newProjectError && (
          <div className="nav-list__error">{newProjectError}</div>
        )}

        {projects.length === 0 ? (
          <p className="nav-list__empty">暂无项目</p>
        ) : (
          <div className="nav-list__project-groups">
            {projects.map((project) => {
              const projectConversations = getProjectConversations(project.id)
              const expanded = expandedProjectIds.has(project.id)
              return (
                <div className="nav-list__project-group" key={project.id}>
                  <button
                    className={`nav-list__item nav-list__item--project${expanded ? ' nav-list__item--project-open' : ''}`}
                    onClick={() => toggleProject(project.id)}
                    title={project.name}
                  >
                    <span className={`nav-list__chevron${expanded ? ' nav-list__chevron--open' : ''}`}>›</span>
                    <span className="nav-list__folder-icon">◫</span>
                    <span className="nav-list__item-name">{project.name}</span>
                    <span className="nav-list__item-count">
                      {projectConversations.length}
                    </span>
                  </button>
                  {expanded && projectConversations.length > 0 && (
                    <ul className="nav-list__items nav-list__items--nested">
                      {projectConversations.map(renderConversationRow)}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="nav-list__section">
        <h3 className="nav-list__heading">对话</h3>
        {unprojectedConversations.length === 0 ? (
          <p className="nav-list__empty">暂无对话</p>
        ) : (
          <ul className="nav-list__items">
            {unprojectedConversations.map(renderConversationRow)}
          </ul>
        )}
      </section>
    </div>
  )
}
