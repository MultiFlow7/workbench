import { useState, useRef, useEffect } from 'react'
import { useStore } from '../../store'
import { ContextIndicator } from '../ContextIndicator/ContextIndicator'
import type { ToastNotification } from '../../store/notificationsSlice'
import './TopBar.css'

type ServiceStatus = 'ok' | 'warn' | 'error'

interface ServiceIndicator {
  name: string
  status: ServiceStatus
}

const SERVICES: ServiceIndicator[] = [
  { name: 'API Layer', status: 'warn' },
]

export function TopBar() {
  const toggleP1 = useStore((s) => s.toggleP1)
  const p1IconsVisible = useStore((s) => s.p1IconsVisible)
  const backendOnline = useStore((s) => s.backendOnline)
  const pendingDecisionCount = useStore((s) => s.pendingDecisionCount)
  const toasts = useStore((s) => s.toasts)
  const removeToast = useStore((s) => s.removeToast)
  const setMode = useStore((s) => s.setMode)

  // v0.8: badge 点击跳转决策收件箱并归零计数
  const handleBadgeClick = () => {
    useStore.getState().resetPendingDecisionCount()
    setMode('decisions')
  }

  // Banner state: visible when backend first goes offline
  const [bannerVisible, setBannerVisible] = useState(false)
  // Track if user has manually closed the banner for the current offline period
  const bannerClosedRef = useRef(false)
  // Track previous online state to detect transitions
  const prevOnlineRef = useRef<boolean | null>(null)

  useEffect(() => {
    if (prevOnlineRef.current === null) {
      // First check result
      prevOnlineRef.current = backendOnline
      if (!backendOnline) {
        setBannerVisible(true)
      }
      return
    }

    if (!backendOnline && prevOnlineRef.current === true) {
      // Transitioned offline → show banner (reset closed state)
      bannerClosedRef.current = false
      setBannerVisible(true)
    } else if (backendOnline && prevOnlineRef.current === false) {
      // Recovered online → hide banner and reset closed flag
      bannerClosedRef.current = false
      setBannerVisible(false)
    }

    prevOnlineRef.current = backendOnline
  }, [backendOnline])

  const handleCloseBanner = () => {
    bannerClosedRef.current = true
    setBannerVisible(false)
  }

  // v0.7: auto-dismiss toasts with autoDismiss=true after 3 seconds
  useEffect(() => {
    const autoDismissToasts = toasts.filter((t) => t.autoDismiss)
    if (autoDismissToasts.length === 0) return

    const timers = autoDismissToasts.map((t) =>
      window.setTimeout(() => {
        removeToast(t.id)
      }, 3000)
    )

    return () => {
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [toasts, removeToast])

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <button
            className="topbar__sidebar-toggle"
            onClick={toggleP1}
            title={p1IconsVisible ? '折叠侧栏' : '展开侧栏'}
            aria-label={p1IconsVisible ? '折叠侧栏' : '展开侧栏'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="12" height="1.5" rx="0.75" fill="currentColor" />
              <rect x="2" y="7.25" width="12" height="1.5" rx="0.75" fill="currentColor" />
              <rect x="2" y="11.5" width="12" height="1.5" rx="0.75" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div className="topbar__center">
          <span className="topbar__title">工作台</span>
        </div>

        <div className="topbar__right">
          <ContextIndicator />
          {SERVICES.map(({ name, status }) => (
            <span key={name} className="topbar__service">
              <span className={`topbar__pip topbar__pip--${status}`} />
              <span className="topbar__service-name">{name}</span>
            </span>
          ))}
          {/* v0.2: 后端在线状态指示 */}
          <span className="topbar__service">
            <span
              className={
                backendOnline
                  ? 'topbar__pip topbar__pip--ok'
                  : 'topbar__pip topbar__pip--backend-offline'
              }
              title={backendOnline ? '工作台服务在线' : '工作台服务不可达'}
            />
            <span className="topbar__service-name">工作台服务</span>
          </span>
          {/* v0.6/v0.8: 决策 Badge，点击跳转收件箱并归零 */}
          {pendingDecisionCount > 0 && (
            <button
              className="topbar__badge topbar__badge--btn"
              title={`${pendingDecisionCount} 个待决策，点击查看`}
              aria-label={`${pendingDecisionCount} 个待决策，点击查看`}
              onClick={handleBadgeClick}
            >
              {pendingDecisionCount > 99 ? '99+' : pendingDecisionCount}
            </button>
          )}
          {/* v0.7: 瞬态通知 Toasts */}
          {toasts.length > 0 && (
            <div className="topbar__toast-container">
              {toasts.map((toast: ToastNotification) => (
                <div
                  key={toast.id}
                  className={`topbar__toast topbar__toast--${toast.type}`}
                  role="status"
                  aria-live="polite"
                >
                  <span className="topbar__toast-msg">{toast.message}</span>
                  {!toast.autoDismiss && (
                    <button
                      className="topbar__toast-close"
                      onClick={() => removeToast(toast.id)}
                      aria-label="关闭通知"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* v0.2: 离线 Banner */}
      {bannerVisible && !backendOnline && (
        <div className="topbar-offline-banner">
          <span className="topbar-offline-banner__text">
            工作台服务暂时不可达，请检查网络或稍后重试
          </span>
          <button
            className="topbar-offline-banner__close"
            onClick={handleCloseBanner}
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      )}
    </>
  )
}
