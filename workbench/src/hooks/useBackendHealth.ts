import { useEffect } from 'react'
import { useStore } from '../store'

const POLL_INTERVAL_MS = 30_000

export function useBackendHealth() {
  const setBackendOnline = useStore((s) => s.setBackendOnline)

  useEffect(() => {
    let mounted = true

    const check = async () => {
      try {
        const online = await window.api.invoke<boolean>('check_backend_health')
        if (mounted) {
          setBackendOnline(online)
        }
      } catch {
        if (mounted) {
          setBackendOnline(false)
        }
      }
    }

    // Run immediately on mount
    check()

    const timer = setInterval(check, POLL_INTERVAL_MS)

    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [setBackendOnline])
}
