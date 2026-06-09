import { StateCreator } from 'zustand'

const LS_KEYS = 'wb_api_keys'

export interface StoredApiKey {
  id: string
  label: string
  key: string
  baseUrl?: string
  models: string[]
}

export function findKeyForModel(keys: StoredApiKey[], model: string): StoredApiKey | undefined {
  const lm = model.toLowerCase()
  return (
    keys.find(k => k.models.some(m => lm === m.toLowerCase() || lm.startsWith(m.toLowerCase()))) ??
    keys.find(k => k.models.length === 0) ??
    keys[0]
  )
}

function loadKeys(): StoredApiKey[] {
  try {
    const raw = localStorage.getItem(LS_KEYS)
    if (raw) {
      const parsed = JSON.parse(raw) as StoredApiKey[]
      return parsed.map(k => ({ ...k, models: k.models ?? [] }))
    }
    // Migrate from old single-key format
    const oldKey = localStorage.getItem('wb_api_key')
    const oldUrl = localStorage.getItem('wb_api_base_url')
    if (oldKey) {
      const migrated: StoredApiKey[] = [{
        id: crypto.randomUUID(),
        label: '默认',
        key: oldKey,
        baseUrl: oldUrl || undefined,
        models: [],
      }]
      localStorage.setItem(LS_KEYS, JSON.stringify(migrated))
      localStorage.removeItem('wb_api_key')
      localStorage.removeItem('wb_api_base_url')
      return migrated
    }
  } catch {}
  return []
}

function persistKeys(keys: StoredApiKey[], cachingEnabled: boolean) {
  localStorage.setItem(LS_KEYS, JSON.stringify(keys))
  localStorage.setItem('wb_caching_enabled', JSON.stringify(cachingEnabled))
  window.api.invoke('write_settings', {
    data: JSON.stringify({ apiKeys: keys, cachingEnabled })
  }).catch(() => {})
}

export interface SettingsSlice {
  apiKeys: StoredApiKey[]
  cachingEnabled: boolean
  setCachingEnabled: (v: boolean) => void
  addApiKey: (entry: Omit<StoredApiKey, 'id'>) => void
  updateApiKey: (entry: StoredApiKey) => void
  removeApiKey: (id: string) => void
  /**
   * v0.16 QA 决策：SettingsPanel overlay 全局可见性。
   * 由 NavIcons 齿轮按钮 + FirstLaunchToast 「打开 Settings」联动设置为 true，
   * NavIcons 内 SettingsPanel 据此渲染。不持久化（会话内瞬态状态）。
   *
   * 历史：v0.16 R-4 曾用 `activeSection: 'vault' | 'apikey' | 'theme' | null` 作为
   * P3 SettingsView 的分区锚点；R-4 已撤销，改用 overlay 后无需分区锚点状态。
   */
  settingsPanelOpen: boolean
  setSettingsPanelOpen: (open: boolean) => void
}

export const createSettingsSlice: StateCreator<SettingsSlice> = (set, get) => ({
  apiKeys: loadKeys(),

  // 初始值（从 localStorage fast 读）
  cachingEnabled: JSON.parse(localStorage.getItem('wb_caching_enabled') ?? 'false'),

  // action
  setCachingEnabled: (v) => {
    localStorage.setItem('wb_caching_enabled', JSON.stringify(v))
    set({ cachingEnabled: v })
    window.api.invoke('write_settings', {
      data: JSON.stringify({ apiKeys: get().apiKeys, cachingEnabled: v })
    }).catch(() => {})
  },

  addApiKey: (entry) => {
    const newKey: StoredApiKey = { ...entry, id: crypto.randomUUID() }
    const next = [...get().apiKeys, newKey]
    persistKeys(next, get().cachingEnabled)
    set({ apiKeys: next })
  },

  updateApiKey: (entry) => {
    const next = get().apiKeys.map(k => k.id === entry.id ? entry : k)
    persistKeys(next, get().cachingEnabled)
    set({ apiKeys: next })
  },

  removeApiKey: (id) => {
    const next = get().apiKeys.filter(k => k.id !== id)
    persistKeys(next, get().cachingEnabled)
    set({ apiKeys: next })
  },

  // v0.16 QA 决策：SettingsPanel overlay 全局可见性（不持久化）
  settingsPanelOpen: false,
  setSettingsPanelOpen: (open) => set({ settingsPanelOpen: open }),
})

// Call this on app startup to hydrate from the durable file.
// File takes priority over localStorage if present.
export async function hydrateSettingsFromFile(
  setState: (partial: Partial<SettingsSlice>) => void
): Promise<void> {
  try {
    const raw = await window.api.invoke<string>('read_settings')
    const data = JSON.parse(raw) as { apiKeys?: StoredApiKey[]; cachingEnabled?: boolean }
    if (data.apiKeys && data.apiKeys.length > 0) {
      // Sync back to localStorage so the next cold start is also fast
      localStorage.setItem(LS_KEYS, JSON.stringify(data.apiKeys))
      setState({ apiKeys: data.apiKeys })
    }
    // cachingEnabled 单独处理（文件值优先，undefined 时保留 localStorage 初始值）
    if (data.cachingEnabled !== undefined) {
      localStorage.setItem('wb_caching_enabled', JSON.stringify(data.cachingEnabled))
      setState({ cachingEnabled: data.cachingEnabled })
    }
  } catch (e) {
    console.error('[settings] hydrateSettingsFromFile failed:', e)
  }
}
