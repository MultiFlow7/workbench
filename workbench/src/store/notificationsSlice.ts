import { StateCreator } from 'zustand'

export interface ToastNotification {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
  autoDismiss: boolean // true: 3s auto-dismiss; false: manual close
}

export interface NotificationsSlice {
  toasts: ToastNotification[]
  addToast: (toast: ToastNotification) => void
  removeToast: (id: string) => void
}

export const createNotificationsSlice: StateCreator<NotificationsSlice> = (set) => ({
  toasts: [],
  addToast: (toast) =>
    set((state) => ({ toasts: [...state.toasts, toast] })),
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
})
