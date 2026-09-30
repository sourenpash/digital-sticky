import { X } from 'lucide-react';
import { dismissToast, useToasts } from '../store/toasts.ts';

export function Toasts() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(toast => (
        <div key={toast.id} className="toast">
          <span className="toast-text">{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action?.();
                dismissToast(toast.id);
              }}
            >
              {toast.actionLabel ?? 'Undo'}
            </button>
          )}
          <button type="button" className="icon-btn toast-close" aria-label="Dismiss" onClick={() => dismissToast(toast.id)}>
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}
