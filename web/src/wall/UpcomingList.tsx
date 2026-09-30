import { format } from 'date-fns';
import { Bell } from 'lucide-react';
import { datedNotes } from '../../../shared/board.ts';
import { countdownLabel, isPast, timeLabel, urgencyOf } from '../../../shared/dates.ts';
import type { Note } from '../../../shared/types.ts';

export function UpcomingList({ notes, now, max = 8 }: { notes: Note[]; now: Date; max?: number }) {
  const items = datedNotes(notes)
    .filter(item => item.kind === 'due' || !isPast(item.when, now))
    .slice(0, max);

  return (
    <section className="wall-up">
      <h3 className="wall-side-title">Coming up</h3>
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
