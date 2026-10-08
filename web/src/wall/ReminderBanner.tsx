import { parseISO } from 'date-fns';
import { Bell, Reply } from 'lucide-react';
import { timeLabel } from '../../../shared/dates.ts';
import { followUpKicker } from '../../../shared/notify.ts';
import type { Alert, Note } from '../../../shared/types.ts';

export function ReminderBanner({ alerts, notes }: { alerts: Alert[]; notes: Note[] }) {
  const alert = alerts[alerts.length - 1];
  if (!alert) return null;
  const note = notes.find(n => n.id === alert.noteId);
  const time = note?.remindAt ? timeLabel(parseISO(note.remindAt)) : timeLabel(parseISO(alert.firedAt));
  const follow = alert.kind === 'follow';
  const Icon = follow ? Reply : Bell;

  return (
    <div className={`wall-banner${follow ? ' is-follow' : ''}`} role="alert">
      <Icon className="wall-banner-icon" aria-hidden="true" />
      <span className="wall-banner-body">
        <span className="wall-banner-kicker">{follow ? followUpKicker(note) : `Reminder · ${time}`}</span>
        <span className="wall-banner-title">{note?.title ?? alert.title}</span>
      </span>
      {alerts.length > 1 && <span className="wall-banner-more">+{alerts.length - 1} more</span>}
    </div>
  );
}
