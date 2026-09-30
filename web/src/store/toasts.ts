import { useSyncExternalStore } from 'react';
import { uid } from '../lib/uid.ts';

export interface Toast {
  id: string;
  text: string;
  actionLabel?: string;
  action?: () => void;
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export function showToast(toast: Omit<Toast, 'id'>, ms = 5000): void {
  const id = uid();
  toasts = [...toasts, { ...toast, id }];
  emit();
  window.setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id: string): void {
  toasts = toasts.filter(t => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
  );
}
