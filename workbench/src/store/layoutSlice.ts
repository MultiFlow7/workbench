import { StateCreator } from 'zustand'

export type P4Mode = 'detail' | 'text-input'

// v0.8: token_granted SSE 事件负载
export interface TokenGrantedEvent {
  token_type: string
  project: string
  version: string
  task_id: string
  timestamp: string
}

export interface LayoutSlice {
  p1ListVisible: boolean
  p2Visible: boolean
  p4Visible: boolean
  p2Width: number
  currentMode: 'chat' | 'tools' | 'console' | 'decisions' | 'analytics' | 'dashboard'
  toggleP1List: () => void
  toggleP2: () => void
  toggleP4: () => void
  setP2Width: (w: number) => void
  setMode: (mode: 'chat' | 'tools' | 'console' | 'decisions' | 'analytics' | 'dashboard') => void
  // v0.2 新增字段
  pendingDecisionCount: number
  backendOnline: boolean
  selectedDecisionId: string | null
  p1IconsVisible: boolean
  // v0.2 新增 actions
  setPendingDecisionCount: (n: number) => void
  incrementPendingCount: () => void
  decrementPendingCount: () => void
  resetPendingDecisionCount: () => void
  setBackendOnline: (online: boolean) => void
  setSelectedDecisionId: (id: string | null) => void
  toggleP1Icons: () => void
  toggleP1: () => void
  // v0.6 任务列表实时刷新信号
  taskRefreshTick: number
  bumpTaskRefresh: () => void
  // v0.7 瞬态通知（3秒后自动清除）
  transientNotification: { message: string; type: 'success' | 'error' | 'info' } | null
  setTransientNotification: (n: { message: string; type: 'success' | 'error' | 'info' } | null) => void
  // v0.8: 最近一次 token_granted 事件（用于 DecisionInbox 实时刷新令牌状态）
  lastTokenGranted: TokenGrantedEvent | null
  setLastTokenGranted: (event: TokenGrantedEvent) => void
  // v0.12: P4 模式 + 展开输入
  p4Mode: P4Mode
  setP4Mode: (mode: P4Mode) => void
  expandedInput: string
  setExpandedInput: (v: string) => void
}

export const createLayoutSlice: StateCreator<LayoutSlice> = (set, get) => ({
  p1ListVisible: true,
  p2Visible: true,
  p4Visible: true,
  p2Width: 260,
  currentMode: 'chat',
  // v0.2 新增字段初始值
  pendingDecisionCount: 0,
  backendOnline: false,
  selectedDecisionId: null,
  p1IconsVisible: true,
  // v0.6 任务刷新信号初始值
  taskRefreshTick: 0,
  // v0.7 瞬态通知初始值
  transientNotification: null,
  // v0.8 令牌事件初始值
  lastTokenGranted: null,
  setP2Width: (w) => set({ p2Width: Math.max(160, Math.min(600, w)) }),
  toggleP1List: () => set((state) => ({ p1ListVisible: !state.p1ListVisible })),
  toggleP2: () => {
    const wasVisible = get().p2Visible
    set((state) => ({ p2Visible: !state.p2Visible }))
    window.api.invoke('write_event_log', { event: { event: 'panel_toggle', timestamp: new Date().toISOString(), payload: { panel_id: 'p2', action: wasVisible ? 'collapse' : 'expand' } } }).catch(() => {})
  },
  toggleP4: () => {
    const wasVisible = get().p4Visible
    set((state) => ({ p4Visible: !state.p4Visible }))
    window.api.invoke('write_event_log', { event: { event: 'panel_toggle', timestamp: new Date().toISOString(), payload: { panel_id: 'p4', action: wasVisible ? 'collapse' : 'expand' } } }).catch(() => {})
  },
  setMode: (mode) => set({ currentMode: mode }),
  // v0.2 actions
  setPendingDecisionCount: (n) => set({ pendingDecisionCount: n }),
  incrementPendingCount: () =>
    set((state) => ({ pendingDecisionCount: state.pendingDecisionCount + 1 })),
  decrementPendingCount: () =>
    set((state) => ({
      pendingDecisionCount: Math.max(0, state.pendingDecisionCount - 1),
    })),
  resetPendingDecisionCount: () => set({ pendingDecisionCount: 0 }),
  setBackendOnline: (online) => set({ backendOnline: online }),
  setSelectedDecisionId: (id) => set({ selectedDecisionId: id }),
  toggleP1Icons: () => set((state) => ({ p1IconsVisible: !state.p1IconsVisible })),
  toggleP1: () => set((state) => {
    const anyVisible = state.p1IconsVisible || state.p1ListVisible
    return { p1IconsVisible: !anyVisible, p1ListVisible: !anyVisible }
  }),
  bumpTaskRefresh: () => set((state) => ({ taskRefreshTick: state.taskRefreshTick + 1 })),
  setTransientNotification: (n) => {
    set({ transientNotification: n })
    if (n !== null) {
      setTimeout(() => set({ transientNotification: null }), 3000)
    }
  },
  // v0.8 actions
  setLastTokenGranted: (event) => set({ lastTokenGranted: event }),
  // v0.12 actions
  p4Mode: 'detail',
  setP4Mode: (mode) => set({ p4Mode: mode }),
  expandedInput: '',
  setExpandedInput: (v) => set({ expandedInput: v }),
})
