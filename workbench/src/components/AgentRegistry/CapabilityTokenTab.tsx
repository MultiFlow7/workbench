import { useState, useEffect } from 'react'
import './CapabilityTokenTab.css'

interface CapabilityToken {
  id: string
  project: string
  version: string
  token_type: 'DELIVERABLE' | 'APPROVED' | 'MERGEABLE'
  granted_by: string
  granted_at: string
  revoked_at: string | null
  task_id: string | null
  expires_at: string | null
}

interface TokenFilter {
  project: string
  version: string
  token_type: string
  active_only: boolean
}

interface GrantFormData {
  project: string
  version: string
  token_type: string
  granted_by: string
}

export function CapabilityTokenTab() {
  const [tokens, setTokens] = useState<CapabilityToken[]>([])
  const [filter, setFilter] = useState<TokenFilter>({
    project: '',
    version: '',
    token_type: '',
    active_only: false,
  })
  const [showGrantModal, setShowGrantModal] = useState(false)
  const [grantForm, setGrantForm] = useState<GrantFormData>({
    project: '',
    version: '',
    token_type: 'DELIVERABLE',
    granted_by: 'ceo-agent',
  })
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadTokens = async () => {
    setLoading(true)
    try {
      const result = await window.api.invoke<CapabilityToken[]>(
        'list_capability_tokens',
        { filter }
      )
      setTokens(result)
    } catch (e) {
      console.error('[CapabilityTokenTab] loadTokens failed', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTokens()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleGrant = async () => {
    try {
      await window.api.invoke('create_capability_token', { req: grantForm })
      setShowGrantModal(false)
      setGrantForm({
        project: '',
        version: '',
        token_type: 'DELIVERABLE',
        granted_by: 'ceo-agent',
      })
      await loadTokens()
    } catch (e) {
      console.error('[CapabilityTokenTab] create_capability_token failed', e)
    }
  }

  const handleRevoke = async (tokenId: string) => {
    try {
      await window.api.invoke('revoke_capability_token', { tokenId })
      setRevokeConfirmId(null)
      await loadTokens()
    } catch (e) {
      console.error('[CapabilityTokenTab] revoke_capability_token failed', e)
    }
  }

  const getStatusBadge = (token: CapabilityToken) => {
    if (token.revoked_at) {
      return <span className="token-status-badge token-status-badge--revoked">已撤销</span>
    }
    if (token.expires_at && new Date(token.expires_at) < new Date()) {
      return <span className="token-status-badge token-status-badge--expired">已过期</span>
    }
    return <span className="token-status-badge token-status-badge--active">有效</span>
  }

  const getTypeBadgeClass = (tokenType: string): string => {
    switch (tokenType) {
      case 'DELIVERABLE': return 'token-type-badge token-type-badge--deliverable'
      case 'APPROVED': return 'token-type-badge token-type-badge--approved'
      case 'MERGEABLE': return 'token-type-badge token-type-badge--mergeable'
      default: return 'token-type-badge'
    }
  }

  return (
    <div className="capability-token-tab">
      {/* 过滤栏 */}
      <div className="token-filter-bar">
        <input
          placeholder="项目"
          value={filter.project}
          onChange={(e) => setFilter({ ...filter, project: e.target.value })}
        />
        <input
          placeholder="版本"
          value={filter.version}
          onChange={(e) => setFilter({ ...filter, version: e.target.value })}
        />
        <select
          value={filter.token_type}
          onChange={(e) => setFilter({ ...filter, token_type: e.target.value })}
        >
          <option value="">全部类型</option>
          <option value="DELIVERABLE">DELIVERABLE</option>
          <option value="APPROVED">APPROVED</option>
          <option value="MERGEABLE">MERGEABLE</option>
        </select>
        <label className="token-active-only">
          <input
            type="checkbox"
            checked={filter.active_only}
            onChange={(e) => setFilter({ ...filter, active_only: e.target.checked })}
          />
          仅显示有效
        </label>
        <button onClick={loadTokens} disabled={loading}>
          {loading ? '加载中...' : '刷新'}
        </button>
        <button
          className="token-grant-btn"
          onClick={() => setShowGrantModal(true)}
        >
          + 手动颁发
        </button>
      </div>

      {/* 令牌列表 */}
      <div className="token-list">
        {tokens.length === 0 ? (
          <div className="token-empty">暂无令牌记录</div>
        ) : (
          <table className="token-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>项目</th>
                <th>版本</th>
                <th>颁发来源</th>
                <th>颁发时间</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr
                  key={token.id}
                  className={token.revoked_at ? 'token-revoked-row' : ''}
                >
                  <td>
                    <span className={getTypeBadgeClass(token.token_type)}>
                      {token.token_type}
                    </span>
                  </td>
                  <td>{token.project}</td>
                  <td>{token.version}</td>
                  <td>{token.granted_by}</td>
                  <td>{new Date(token.granted_at).toLocaleString('zh-CN')}</td>
                  <td>{getStatusBadge(token)}</td>
                  <td>
                    {!token.revoked_at && (
                      <button
                        className="token-revoke-btn"
                        onClick={() => setRevokeConfirmId(token.id)}
                      >
                        撤销
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 手动颁发弹窗 */}
      {showGrantModal && (
        <div className="token-modal-overlay">
          <div className="token-modal-content">
            <h3>手动颁发令牌</h3>
            <p className="token-modal-warning">
              ⚠️ CEO 专属操作，颁发后立即生效
            </p>
            <div className="token-form-group">
              <label>项目</label>
              <input
                value={grantForm.project}
                onChange={(e) => setGrantForm({ ...grantForm, project: e.target.value })}
                placeholder="如：工作台"
              />
            </div>
            <div className="token-form-group">
              <label>版本</label>
              <input
                value={grantForm.version}
                onChange={(e) => setGrantForm({ ...grantForm, version: e.target.value })}
                placeholder="如：v0.8"
              />
            </div>
            <div className="token-form-group">
              <label>令牌类型</label>
              <select
                value={grantForm.token_type}
                onChange={(e) => setGrantForm({ ...grantForm, token_type: e.target.value })}
              >
                <option value="DELIVERABLE">DELIVERABLE</option>
                <option value="APPROVED">APPROVED</option>
                <option value="MERGEABLE">MERGEABLE</option>
              </select>
            </div>
            <div className="token-form-group">
              <label>颁发来源</label>
              <input
                value={grantForm.granted_by}
                onChange={(e) => setGrantForm({ ...grantForm, granted_by: e.target.value })}
              />
            </div>
            <div className="token-modal-actions">
              <button onClick={() => setShowGrantModal(false)}>取消</button>
              <button
                className="token-modal-confirm-btn"
                onClick={handleGrant}
              >
                确认颁发
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 撤销确认弹窗 */}
      {revokeConfirmId && (
        <div className="token-modal-overlay">
          <div className="token-modal-content">
            <h3>确认撤销令牌</h3>
            <p>撤销操作不可逆，但不影响已完成的任务。</p>
            <div className="token-modal-actions">
              <button onClick={() => setRevokeConfirmId(null)}>取消</button>
              <button
                className="token-modal-danger-btn"
                onClick={() => handleRevoke(revokeConfirmId)}
              >
                确认撤销
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
