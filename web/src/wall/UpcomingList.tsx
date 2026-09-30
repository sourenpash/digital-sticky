import { format } from 'date-fns';
import { Bell } from 'lucide-react';
import { datedNotes } from '../../../shared/board.ts';
import { countdownLabel, daysUntil, isPast, timeLabel, urgencyOf } from '../../../shared/dates.ts';
import type { Note } from '../../../shared/types.ts';

export function UpcomingList({ notes, now, max = 8 }: { notes: Note[]; now: Date; max?: number }) {
  const dated = datedNotes(notes);
  const items = dated.filter(item => item.kind === 'due' || !isPast(item.when, now)).slice(0, max);
  const deadlines = dated.filter(item => item.kind === 'due');
  const overdue = deadlines.filter(item => isPast(item.when, now)).length;
  const thisWeek = deadlines.filter(item => !isPast(item.when, now) && daysUntil(item.when, now) <= 7).length;

  return (
    <section className="wall-up">
      <header className="wall-up-head">
        <h3 className="wall-side-title">Coming up</h3>
        <span className="wall-up-pills">
          {overdue > 0 && <span className="pill pill-overdue">{overdue} overdue</span>}
          {thisWeek > 0 && <span className="pill pill-week">{thisWeek} due this week</span>}
        </span>
      </header>
      {items.length === 0 ? (
        <p className="wall-up-empty">Nothing scheduled.</p>
      ) : (
        <ol className="wall-up-list">
          {items.map(({ note, when, kind }) => {
            const tone = kind === 'remind' ? 'remind' : urgencyOf(when, now);
            return (
              <li key={note.id} className={`wall-up-row tone-${tone}`}>
                <span className="wall-up-date">
                  <span className="wall-up-dow">{format(when.date, 'EEE')}</span>
                  <span className="wall-up-md">{format(when.date, 'MMM d')}</span>
                </span>
                <span className="wall-up-title">
                  {kind === 'remind' && <Bell aria-label="Reminder" />}
                  {note.title}
                </span>
                <span className="wall-up-left">
                  {kind === 'remind' && !when.allDay ? timeLabel(when.date) : countdownLabel(when, now)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
