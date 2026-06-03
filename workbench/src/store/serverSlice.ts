import { StateCreator } from 'zustand'

export type ServerStatus = 'offline' | 'connecting' | 'online'

const STORAGE_KEY = 'wb_server_config'

interface StoredServerConfig {
  url: string    // WebSocket URL: ws://host:3001/ws/agent
  token: string  // Bearer token
}

function loadServerConfig(): StoredServerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as StoredServerConfig
  } catch {}
  return { url: '', token: '' }
}

export interface ServerSlice {
  serverUrl: string
  serverToken: string
  serverStatus: ServerStatus
  serverLastError: string | null

  setServerConfig: (url: string, token: string) => void
  setServerStatus: (status: ServerStatus) => void
  setServerLastError: (error: string | null) => void
}

export const createServerSlice: StateCreator<ServerSlice> = (set) => {
  const stored = loadServerConfig()
  return {
    serverUrl: stored.url,
    serverToken: stored.token,
    serverStatus: 'offline',
    serverLastError: null,

    setServerConfig: (url, token) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, token }))
      set({ serverUrl: url, serverToken: token, serverStatus: 'offline', serverLastError: null })
    },
    setServerStatus: (status) => set({ serverStatus: status }),
    setServerLastError: (error) => set({ serverLastError: error }),
  }
}
