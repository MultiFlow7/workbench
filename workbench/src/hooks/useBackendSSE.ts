import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useStore } from '../store'

interface SsePayload {
  type: string
  decision_id?: string
  count?: number
  task_id?: string
  new_status?: string
  decision_request?: unknown
}

export function useBackendSSE() {
  const {
    incrementPendingCount,
    decrementPendingCount,
    setPendingDecisionCount,
    loadDecisions,
    updateDecision,
    bumpTaskRefresh,
  } = useStore()

  useEffect(() => {
    // Start the Rust SSE subscription
    invoke('start_backend_sse').catch((e: unknown) => {
      console.warn('[useBackendSSE] start_backend_sse failed:', e)
    })

    // Listen for events forwarded from Rust to frontend
    const unlistenPromise = listen<SsePayload>('backend-sse', (event) => {
      const payload = event.payload
      const isUserInputting = useStore.getState().isUserInputting

      switch (payload.type) {
        case 'decision_created': {
          incrementPendingCount()
          // If count from server is available, sync it
          if (typeof payload.count === 'number') {
            setPendingDecisionCount(payload.count)
          }
          break
        }

        case 'decision_resolved': {
          decrementPendingCount()
          if (typeof payload.count === 'number') {
            setPendingDecisionCount(payload.count)
          }
          // Remove resolved decision from local list
          if (payload.decision_id) {
            const currentDecisions = useStore.getState().decisions
            const remaining = currentDecisions.filter(
              (d) => d.decision_id !== payload.decision_id
            )
            useStore.setState({ decisions: remaining })
            // Clear selectedDecisionId if it was the resolved one
            if (useStore.getState().selectedDecisionId === payload.decision_id) {
              useStore.getState().setSelectedDecisionId(null)
            }
          }
          break
        }

        case 'task_status_changed': {
          if (isUserInputting) {
            // Buffer event while user is typing
            const current = useStore.getState().pendingBackendEvents
            useStore.setState({
              pendingBackendEvents: [
                ...current,
                { type: payload.type, data: payload },
              ],
            })
          } else {
            // Refresh decisions list to stay in sync
            loadDecisions()
            // Signal TaskOverview to reload
            bumpTaskRefresh()
          }
          break
        }

        case 'reconnected': {
          // Re-sync decisions count after reconnect
          loadDecisions()
          break
        }

        default:
          break
      }
    })

    return () => {
      unlistenPromise.then((unlisten) => unlisten())
      invoke('stop_backend_sse').catch(() => {})
    }
  }, [
    incrementPendingCount,
    decrementPendingCount,
    setPendingDecisionCount,
    loadDecisions,
    updateDecision,
    bumpTaskRefresh,
  ])
}
