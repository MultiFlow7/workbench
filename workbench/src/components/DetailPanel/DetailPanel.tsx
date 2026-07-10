import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { useBasePath, buildFilePath } from '../../utils/paths'
import { formatTokens } from '../../utils/tokenFormat'
import './DetailPanel.css'

interface QAAtom {
  meta: {
    id: string
    prev: string | null
    children: string[]
    summary: string
    timestamp: string
  }
  question: string
  answer: string
}

export function DetailPanel() {
  const selectedAtomId = useStore((s) => s.selectedAtomId)
  const selectedConversationId = useStore((s) => s.selectedConversationId)
  const conversations = useStore((s) => s.conversations)
  const atoms = useStore((s) => s.atoms)
  const [atom, setAtom] = useState<QAAtom | null>(null)
  const p4Mode = useStore((s) => s.p4Mode)
  const setP4Mode = useStore((s) => s.setP4Mode)
  const expandedInput = useStore((s) => s.expandedInput)
  const setExpandedInput = useStore((s) => s.setExpandedInput)
  // v0.16 R-2：vault 路径派生（替代旧 toFilePath 常量函数）
  const basePath = useBasePath()
  const selectedConversation = selectedConversationId
    ? conversations[selectedConversationId] ?? null
    : null

  useEffect(() => {
    if (!selectedAtomId) {
      setAtom(null)
      return
    }
    window.api.invoke<QAAtom>('read_qa_atom', { filePath: buildFilePath(basePath, selectedAtomId) })
      .then(setAtom)
      .catch(console.error)
  }, [selectedAtomId, basePath])

  if (p4Mode === 'text-input') {
    return (
      <div className="p4-text-input">
        <div className="p4-text-input__header">
          <span className="p4-text-input__title">文本输入</span>
          <button className="p4-text-input__collapse" onClick={() => setP4Mode('detail')}>
            收起
          </button>
        </div>
        <textarea
          className="p4-text-input__area"
          value={expandedInput}
          onChange={(e) => setExpandedInput(e.target.value)}
          placeholder="在此输入长文本，内容实时同步至对话输入框…"
        />
        <div className="p4-text-input__footer">{expandedInput.length} 字符</div>
      </div>
    )
  }

  if (!atom && selectedConversation) {
    const createdAt = selectedConversation.createdAt
      ? new Date(selectedConversation.createdAt).toLocaleString('zh-CN')
      : '-'
    const updatedAt = selectedConversation.updatedAt
      ? new Date(selectedConversation.updatedAt).toLocaleString('zh-CN')
      : '-'
    return (
      <div className="detail-panel">
        <div className="detail-section-label">对话</div>
        <div className="detail-title">{selectedConversation.title || '新对话'}</div>

        <div className="detail-meta-grid">
          <span>ID</span>
          <code>{selectedConversation.id}</code>
          <span>状态</span>
          <strong>{selectedConversation.status === 'draft' ? '草稿' : '已激活'}</strong>
          <span>节点</span>
          <strong>{selectedConversation.atomIds.length}</strong>
          <span>Root</span>
          <code>{selectedConversation.rootAtomId ?? '-'}</code>
          <span>创建</span>
          <strong>{createdAt}</strong>
          <span>更新</span>
          <strong>{updatedAt}</strong>
        </div>

        {(selectedConversation.sourcePlatform || selectedConversation.sourceSessionId || selectedConversation.sourcePath) && (
          <>
            <hr className="detail-divider" />
            <div className="detail-section-label">来源</div>
            <div className="detail-meta-grid">
              <span>平台</span>
              <strong>{selectedConversation.sourcePlatform ?? '-'}</strong>
              <span>会话</span>
              <code>{selectedConversation.sourceSessionId ?? '-'}</code>
              <span>路径</span>
              <code>{selectedConversation.sourcePath ?? '-'}</code>
              <span>CWD</span>
              <code>{selectedConversation.sourceCwd ?? '-'}</code>
            </div>
          </>
        )}
      </div>
    )
  }

  if (!atom) {
    return (
      <div className="detail-panel">
        <div className="detail-empty">选择对话或节点以查看详情</div>
      </div>
    )
  }

  const ts = new Date(atom.meta.timestamp).toLocaleString('zh-CN')
  const atomMeta = selectedAtomId ? atoms[selectedAtomId] : null

  return (
    <div className="detail-panel">
      <div className="detail-meta">
        <span className="detail-meta__id">{atom.meta.id}</span>
        <span>{ts}</span>
        <span>done</span>
      </div>

      {atomMeta?.usage && (
        <div className="detail-token-info">
          <span className="detail-token-item">
            ↑ {formatTokens(atomMeta.usage.input_tokens)}
          </span>
          <span className="detail-token-item">
            ↓ {formatTokens(atomMeta.usage.output_tokens)}
          </span>
          {atomMeta.model && (
            <span className="detail-token-item detail-token-model">{atomMeta.model}</span>
          )}
          {atomMeta.context_tokens_used && atomMeta.context_window_limit && (
            <span className="detail-token-item">
              ctx {((atomMeta.context_tokens_used / atomMeta.context_window_limit) * 100).toFixed(1)}%
            </span>
          )}
        </div>
      )}

      <hr className="detail-divider" />
      <div className="detail-section-label">问题</div>
      <div className="detail-body">{atom.question}</div>

      <hr className="detail-divider" />
      <div className="detail-section-label">回答</div>
      <div className="detail-body">{atom.answer}</div>

      <hr className="detail-divider" />
      <div className="detail-children-count">
        子节点：{atom.meta.children.length} 个
      </div>
    </div>
  )
}
