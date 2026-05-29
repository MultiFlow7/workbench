import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { toFilePath } from '../../utils/paths'
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
  const atoms = useStore((s) => s.atoms)
  const [atom, setAtom] = useState<QAAtom | null>(null)
  const p4Mode = useStore((s) => s.p4Mode)
  const setP4Mode = useStore((s) => s.setP4Mode)
  const expandedInput = useStore((s) => s.expandedInput)
  const setExpandedInput = useStore((s) => s.setExpandedInput)

  useEffect(() => {
    if (!selectedAtomId) return
    window.api.invoke<QAAtom>('read_qa_atom', { filePath: toFilePath(selectedAtomId) })
      .then(setAtom)
      .catch(console.error)
  }, [selectedAtomId])

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

  if (!atom) {
    return (
      <div className="detail-panel">
        <div className="detail-empty">选择节点以查看详情</div>
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
