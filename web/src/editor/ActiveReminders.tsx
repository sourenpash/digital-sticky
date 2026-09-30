import { Bell, Check, X } from 'lucide-react';
import { parseWhen, timeLabel } from '../../../shared/dates.ts';
import type { Board } from '../../../shared/types.ts';
import { board as store } from '../store/board.ts';
import { showToast } from '../store/toasts.ts';

/** Reminders going off on the wall right now, at the top of every screen, with Done and Dismiss. */
export function ActiveReminders({ board, onOpen }: { board: Board; onOpen: (noteId: string) => void }) {
  if (board.alerts.length === 0) return null;

  const done = (alertId: string, noteId: string) => {
    const note = board.notes.find(n => n.id === noteId);
    if (!note) {
      store.dismissAlert(alertId);
      return;
    }
    if (note.repeat) {
      // Marking a recurring task done would end it; log this time instead.
      const at = store.logRoutine(note.id);
      store.dismissAlert(alertId);
      if (at) showToast({ text: `Logged “${note.title}”`, action: () => store.undoRoutine(note.id, at) });
      return;
    }
    store.setDone(note.id, true);
    showToast({ text: `Marked “${note.title}” done`, action: () => store.setDone(note.id, false) });
  };

  return (
    <section className="reminders" aria-label="Reminders going off">
      {board.alerts.map(alert => {
        const note = board.notes.find(n => n.id === alert.noteId);
        const when = parseWhen(note?.remindAt) ?? parseWhen(alert.firedAt);
        return (
          <div key={alert.id} className="reminder">
            <Bell className="reminder-bell" aria-hidden="true" />
            <button type="button" className="reminder-title" onClick={() => note && onOpen(note.id)}>
              {alert.title || 'Reminder'}
              {when && <span className="reminder-time">{timeLabel(when.date)}</span>}
            </button>
            <button type="button" className="btn btn-sm reminder-done" onClick={() => done(alert.id, alert.noteId)}>
              <Check aria-hidden="true" /> Done
            </button>
            <button type="button" className="icon-btn reminder-dismiss" aria-label={`Dismiss “${alert.title}”`} onClick={() => store.dismissAlert(alert.id)}>
              <X />
            </button>
          </div>
        );
      })}
    </section>
  );
}
