import { StateCreator } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export interface DecisionOption {
  key: string
  label: string
  description?: string
}

export interface DecisionRecord {
  decision_id: string
  task_id: string
  agent_role: string
  question: string
  options: DecisionOption[]
  risk_level: 'Low' | 'Medium' | 'High'
  created_at: string
  resolved_at: string | null
  resolution: string | null
}

export interface DecisionsSlice {
  decisions: DecisionRecord[]
  loadDecisions: () => Promise<void>
  updateDecision: (record: DecisionRecord) => void
}

export const createDecisionsSlice: StateCreator<DecisionsSlice> = (set) => ({
  decisions: [],

  loadDecisions: async () => {
    try {
      const raw = await invoke<DecisionRecord[]>('list_decisions', {
        filter: 'pending',
      })
      set({ decisions: raw })
    } catch (e) {
      console.error('[decisionsSlice] loadDecisions failed:', e)
    }
  },

  updateDecision: (record) => {
    set((state) => {
      const idx = state.decisions.findIndex(
        (d) => d.decision_id === record.decision_id
      )
      if (idx === -1) {
        return { decisions: [...state.decisions, record] }
      }
      const updated = [...state.decisions]
      updated[idx] = record
      return { decisions: updated }
    })
  },
})
