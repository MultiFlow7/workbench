import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import type { DecisionRecord } from '../../store/decisionsSlice'
import { DecisionCard } from './DecisionCard'
import './DecisionInbox.css'

const RISK_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 }

function sortDecisions(list: DecisionRecord[]): DecisionRecord[] {
  return [...list].sort((a, b) => {
    const riskDiff = (RISK_ORDER[a.risk_level] ?? 3) - (RISK_ORDER[b.risk_level] ?? 3)
    if (riskDiff !== 0) return riskDiff
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })
}

// v0.8: 令牌状态相关类型
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

interface TokenStatusInfo {
  deliverable: { exists: boolean; granted_at?: string }
  approved: { exists: boolean; granted_at?: string }
}

// v0.8: 令牌状态展示子组件
interface TokenStatusPanelProps {
  taskId: string
  lastTokenGrantedTs: string | null
}

function TokenStatusPanel({ taskId, lastTokenGrantedTs }: TokenStatusPanelProps) {
  const [tokenStatus, setTokenStatus] = useState<TokenStatusInfo | null>(null)
  const [loading, setLoading] = useState(false)

  const loadTokenStatus = async (tid: string) => {
    setLoading(true)
    try {
      const tokens = await window.api.invoke<CapabilityToken[]>(
        'list_capability_tokens',
        { filter: { task_id: tid, active_only: false } }
      )
      setTokenStatus({
        deliverable: {
          exists: tokens.some(
            (t) => t.token_type === 'DELIVERABLE' && !t.revoked_at
          ),
          granted_at: tokens.find(
            (t) => t.token_type === 'DELIVERABLE'
          )?.granted_at,
        },
        approved: {
          exists: tokens.some(
            (t) => t.token_type === 'APPROVED' && !t.revoked_at
          ),
          granted_at: tokens.find(
            (t) => t.token_type === 'APPROVED'
          )?.granted_at,
        },
      })
    } catch (e) {
      console.error('[TokenStatusPanel] loadTokenStatus failed', e)
      setTokenStatus(null)
    } finally {
      setLoading(false)
    }
  }

  // 初始加载
  useEffect(() => {
    if (taskId) {
      loadTokenStatus(taskId)
    }
  }, [taskId])

  // SSE 驱动：token_granted 事件后实时刷新
  useEffect(() => {
    if (lastTokenGrantedTs && taskId) {
      loadTokenStatus(taskId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTokenGrantedTs])

  if (loading) {
    return (
      <div className="token-status-section">
        <h4 className="token-status-title">令牌状态</h4>
        <div className="token-status-loading">加载中...</div>
      </div>
    )
  }

  if (!tokenStatus) return null

  return (
    <div className="token-status-section">
      <h4 className="token-status-title">令牌状态</h4>
      <div className="token-status-item">
        <span className="token-status-label">DELIVERABLE</span>
        {tokenStatus.deliverable.exists ? (
          <span className="token-status-badge token-status-badge--valid">
            ✓ 已颁发
            {tokenStatus.deliverable.granted_at && (
              <span className="token-status-time">
                {new Date(tokenStatus.deliverable.granted_at).toLocaleString('zh-CN')}
              </span>
            )}
          </span>
        ) : (
          <span className="token-status-badge token-status-badge--missing">
            ✗ 未颁发（review-agent 尚未通过）
          </span>
        )}
      </div>
      <div className="token-status-item">
        <span className="token-status-label">APPROVED</span>
        {tokenStatus.approved.exists ? (
          <span className="token-status-badge token-status-badge--valid">
            ✓ 已颁发（Approve 后自动颁发）
          </span>
        ) : (
          <span className="token-status-badge token-status-badge--pending">
            待审批
          </span>
        )}
      </div>
    </div>
  )
}

export function DecisionInbox() {
  const {
    decisions,
    loadDecisions,
    setSelectedDecisionId,
    selectedDecisionId,
    setPendingDecisionCount,
    setMode,
  } = useStore()

  // v0.8: 监听 token_granted 事件时间戳，触发令牌状态刷新
  const lastTokenGranted = useStore((s) => s.lastTokenGranted)
  const lastTokenGrantedTs = lastTokenGranted?.timestamp ?? null

  const [snoozedIds, setSnoozedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadDecisions()
  }, [loadDecisions])

  const sorted = sortDecisions(decisions.filter((d) => !snoozedIds.has(d.decision_id)))

  const handleSelect = (id: string) => {
    setSelectedDecisionId(id)
    // Ensure P4 is visible when a card is selected
    useStore.getState().p4Visible || useStore.getState().toggleP4()
  }

  const handleSnooze = (id: string) => {
    setSnoozedIds((prev) => new Set([...prev, id]))
  }

  const handleResolve = async (decisionId: string, resolution: string) => {
    try {
      await window.api.invoke('resolve_decision', { decisionId, resolution })
      // Remove resolved decision from list and update count
      const currentDecisions = useStore.getState().decisions
      const remaining = currentDecisions.filter((d) => d.decision_id !== decisionId)
      useStore.setState({ decisions: remaining })
      setPendingDecisionCount(remaining.length)
      if (useStore.getState().selectedDecisionId === decisionId) {
        setSelectedDecisionId(null)
      }
    } catch (e) {
      console.error('[DecisionInbox] resolve failed:', e)
    }
  }

  const selectedDecision = decisions.find(
    (d) => d.decision_id === selectedDecisionId
  ) ?? null

  return (
    <div className="decision-inbox">
      <div className="decision-inbox__header">
        <h2 className="decision-inbox__title">决策收件箱</h2>
        <button
          className="decision-inbox__back-btn"
          onClick={() => setMode('chat')}
        >
          切回对话
        </button>
      </div>

      <div className="decision-inbox__list">
        {sorted.length === 0 ? (
          <div className="decision-inbox__empty">暂无待处理决策</div>
        ) : (
          sorted.map((d) => (
            <DecisionCard
              key={d.decision_id}
              decision={d}
              selected={selectedDecisionId === d.decision_id}
              onSelect={handleSelect}
              onResolve={handleResolve}
              onSnooze={handleSnooze}
            />
          ))
        )}
      </div>

      {/* v0.8: 选中决策时显示令牌状态 */}
      {selectedDecision && (
        <TokenStatusPanel
          taskId={selectedDecision.task_id}
          lastTokenGrantedTs={lastTokenGrantedTs}
        />
      )}
    </div>
  )
}
