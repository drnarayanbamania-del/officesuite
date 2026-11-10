import { create } from 'zustand';

export interface ToastItem {
  id: number;
  message: string;
  kind: 'ok' | 'error' | 'info';
}

interface ToastState {
  items: ToastItem[];
  push: (message: string, kind?: ToastItem['kind']) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToasts = create<ToastState>((set) => ({
  items: [],
  push: (message, kind = 'ok') => {
    const id = ++seq;
    set((s) => ({ items: [...s.items, { id, message, kind }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 4200);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export function toast(message: string, kind: ToastItem['kind'] = 'ok'): void {
  useToasts.getState().push(message, kind);
}

export const useTheme = create<{ theme: 'light' | 'dark'; toggle: () => void }>((set, get) => ({
  theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  toggle: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('novaoffice.theme', next);
    } catch {
      /* storage may be unavailable */
    }
    set({ theme: next });
  },
}));
