import { format } from 'date-fns';
import { datedNotes } from '../../../shared/board.ts';
import { dayKey, rollingWeeks } from '../../../shared/dates.ts';
import type { Lane, Note, NoteColor } from '../../../shared/types.ts';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKS = 5;

/** This week plus the next four, so upcoming deadlines always show, even at the end of a month. */
export function CalendarPanel({ notes, lanes, now }: { notes: Note[]; lanes: Lane[]; now: Date }) {
  const weeks = rollingWeeks(now, WEEKS);
  const days = weeks.flat();
  const first = days[0]?.date ?? now;
  const last = days[days.length - 1]?.date ?? now;
  const range =
    format(first, 'MMM') === format(last, 'MMM') ? format(first, 'MMMM') : `${format(first, 'MMM')} – ${format(last, 'MMM')}`;

  const colorsByDay = new Map<string, NoteColor[]>();
  for (const item of datedNotes(notes)) {
    const key = dayKey(item.when.date);
    const color = item.note.color ?? lanes.find(lane => lane.id === item.note.laneId)?.color ?? 'yellow';
    colorsByDay.set(key, [...(colorsByDay.get(key) ?? []), color]);
  }

  return (
    <section className="wall-cal" aria-label="Calendar for the next five weeks">
      <header className="wall-cal-head">
        <span className="wall-cal-month">{range}</span>
        <span className="wall-cal-year">{format(last, 'yyyy')}</span>
      </header>
      <div className="wall-cal-grid">
        {WEEKDAYS.map((d, i) => (
          <span key={`dow-${i}`} className="wall-cal-dow">
            {d}
          </span>
        ))}
        {days.map(day => {
          const dots = colorsByDay.get(day.key) ?? [];
          const firstOfMonth = day.date.getDate() === 1;
          const cls = [
            'wall-cal-day',
            day.inMonth ? '' : 'is-next',
            day.isToday ? 'is-today' : '',
            day.isPast ? 'is-past' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <span key={day.key} className={cls}>
              {firstOfMonth && <span className="wall-cal-mon">{format(day.date, 'MMM')}</span>}
              <span className="wall-cal-num">{format(day.date, 'd')}</span>
              <span className="wall-cal-dots">
                {dots.slice(0, 3).map((color, i) => (
                  <i key={i} className={`dot paper-${color}`} />
                ))}
              </span>
            </span>
          );
        })}
      </div>
    </section>
  );
}
