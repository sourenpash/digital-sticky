import { parseISO } from 'date-fns';
import { Bell } from 'lucide-react';
import { timeLabel } from '../../../shared/dates.ts';
import type { Alert, Note } from '../../../shared/types.ts';

export function ReminderBanner({ alerts, notes }: { alerts: Alert[]; notes: Note[] }) {
  const alert = alerts[alerts.length - 1];
  if (!alert) return null;
  const note = notes.find(n => n.id === alert.noteId);
  const time = note?.remindAt ? timeLabel(parseISO(note.remindAt)) : timeLabel(parseISO(alert.firedAt));

  return (
    <div className="wall-banner" role="alert">
      <Bell className="wall-banner-icon" aria-hidden="true" />
      <span className="wall-banner-body">
        <span className="wall-banner-kicker">Reminder · {time}</span>
        <span className="wall-banner-title">{note?.title ?? alert.title}</span>
      </span>
      {alerts.length > 1 && <span className="wall-banner-more">+{alerts.length - 1} more</span>}
    </div>
  );
}
