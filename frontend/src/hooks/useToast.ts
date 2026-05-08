import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info' | 'warn';

export interface Toast {
  id:      string;
  message: string;
  type:    ToastType;
}

interface ToastStore {
  toasts: Toast[];
  add:    (message: string, type: ToastType) => void;
  remove: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (message, type) => {
    const id = Math.random().toString(36).slice(2);
    set(s => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 4000);
  },
  remove: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));

export function useToast() {
  const { add } = useToastStore();
  return {
    success: (msg: string) => add(msg, 'success'),
    error:   (msg: string) => add(msg, 'error'),
    info:    (msg: string) => add(msg, 'info'),
    warn:    (msg: string) => add(msg, 'warn'),
  };
}
