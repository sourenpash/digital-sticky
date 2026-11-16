import { format } from 'date-fns';
import { Bell, CalendarDays, Reply } from 'lucide-react';
import { datedNotes } from '../../../shared/board.ts';
import { countdownLabel, isPast, reminderLabel, timeLabel, urgencyOf } from '../../../shared/dates.ts';
import { multiDay, spanLabel, spanNow, spanOver } from '../../../shared/spans.ts';
import type { Note } from '../../../shared/types.ts';

export function UpcomingList({ notes, now, max = 8 }: { notes: Note[]; now: Date; max?: number }) {
  const dated = datedNotes(notes);
  // Reminders that already went off, and events that are over, drop out; overdue deadlines and follow-ups stay until dealt with.
  const items = dated
    .filter(item => (item.span ? !spanOver(item.span, now) : item.kind !== 'remind' || !isPast(item.when, now)))
    .slice(0, max);

  return (
    <section className="wall-up">
      <header className="wall-up-head">
        <h3 className="wall-side-title">Coming up</h3>
      </header>
      {items.length === 0 ? (
        <p className="wall-up-empty">Nothing scheduled.</p>
      ) : (
        <ol className="wall-up-list">
          {items.map(({ note, when, kind, span }) => {
            const past = isPast(when, now);
            const tone = kind === 'remind' || kind === 'event' ? 'remind' : kind === 'follow' ? (past ? 'today' : 'follow') : urgencyOf(when, now);
            return (
              <li key={note.id} className={`wall-up-row tone-${tone}`}>
                <span className="wall-up-date">
                  <span className="wall-up-dow">{format(when.date, 'EEE')}</span>
                  <span className="wall-up-md">{format(when.date, 'MMM d')}</span>
                </span>
                <span className="wall-up-title">
                  {kind === 'remind' && <Bell aria-label="Reminder" />}
                  {kind === 'follow' && <Reply className="is-follow" aria-label="Follow up" />}
                  {kind === 'event' && <CalendarDays aria-label="Event" />}
                  {note.title}
                </span>
                <span className="wall-up-left">
                  {span
                    ? spanNow(span, now)
                      ? 'Now'
                      : multiDay(span) || span.start.allDay
                        ? countdownLabel({ ...span.start, allDay: true }, now)
                        : `${reminderLabel({ ...span.start, allDay: true }, now)} ${spanLabel(span)}`
                    : kind === 'follow'
                      ? past
                        ? 'Now'
                        : countdownLabel({ ...when, allDay: true }, now)
                      : kind === 'remind' && !when.allDay
                        ? timeLabel(when.date)
                        : countdownLabel(when, now)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
