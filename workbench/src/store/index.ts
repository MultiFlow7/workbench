import { create } from 'zustand'
import { createLayoutSlice, LayoutSlice } from './layoutSlice'
import { createConversationSlice, ConversationSlice } from './conversationSlice'
import { createDecisionsSlice, DecisionsSlice } from './decisionsSlice'
import { createNotificationsSlice, NotificationsSlice } from './notificationsSlice'
import { createSettingsSlice, SettingsSlice } from './settingsSlice'
import { createAppearanceSlice, AppearanceSlice } from './appearanceSlice'

export type StoreState = LayoutSlice
  & ConversationSlice
  & DecisionsSlice
  & NotificationsSlice
  & SettingsSlice
  & AppearanceSlice

export const useStore = create<StoreState>()((...a) => ({
  ...createLayoutSlice(...a),
  ...createConversationSlice(...a),
  ...createDecisionsSlice(...a),
  ...createNotificationsSlice(...a),
  ...createSettingsSlice(...a),
  ...createAppearanceSlice(...a),
}))
