/**
 * Transient UI state — toasts and global overlays.
 *
 * Client state only. Anything that comes from Supabase belongs in TanStack
 * Query, not here.
 */

import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface UIState {
  toasts: Toast[];
  showToast: (toast: Omit<Toast, 'id'>) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  toasts: [],

  showToast: (toast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    return id;
  },

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  clearToasts: () => set({ toasts: [] }),
}));
