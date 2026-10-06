import { format } from 'date-fns';
import { Bell, Reply } from 'lucide-react';
import { datedNotes, noteColor, twoWeekDays, type StripItem } from '../../../shared/board.ts';
import { daysUntil, isPast, timeLabel } from '../../../shared/dates.ts';
import type { Lane, Note } from '../../../shared/types.ts';

/** Chips that fit in a day; more than this shows "+N more". */
const PER_DAY = 3;

function Item({ item, lanes }: { item: StripItem; lanes: Lane[] }) {
  const { note, when, kind, overdue } = item;
  const follow = kind === 'follow';
  const tone = kind === 'remind' ? 'remind' : overdue ? (follow ? 'follow-now' : 'overdue') : follow ? 'follow' : 'due';
  // Follow-ups go out in the morning; the time would only crowd the day.
  const time = when.allDay || follow ? null : timeLabel(when.date);
  return (
    <li className={`wall-wk-item paper-${noteColor(note, lanes.find(l => l.id === note.laneId))} is-${tone}`}>
      {kind === 'remind' && <Bell aria-label="Reminder" />}
      {follow && <Reply aria-label="Follow up" />}
      <span className="wall-wk-title">{note.title || 'Untitled note'}</span>
      {overdue ? <span className="wall-wk-time">{follow ? 'now' : 'late'}</span> : time && <span className="wall-wk-time">{time}</span>}
    </li>
  );
}

/** The next two weeks, with what's due (and reminders) written into each day. */
export function TwoWeeks({ notes, lanes, now }: { notes: Note[]; lanes: Lane[]; now: Date }) {
  const days = twoWeekDays(notes, now);
  const first = days[0]!.date;
  const last = days[days.length - 1]!.date;
  const range = `${format(first, 'MMM d')} – ${format(last, first.getMonth() === last.getMonth() ? 'd' : 'MMM d')}`;
  const deadlines = datedNotes(notes).filter(item => item.kind === 'due');
  const overdue = deadlines.filter(item => isPast(item.when, now)).length;
  const thisWeek = deadlines.filter(item => !isPast(item.when, now) && daysUntil(item.when, now) <= 7).length;

  return (
    <section className="wall-weeks" aria-label="The next two weeks">
      <header className="wall-weeks-head">
        <h3 className="wall-side-title">Next 2 weeks</h3>
        <span className="wall-weeks-range">{range}</span>
        <span className="wall-up-pills">
          {overdue > 0 && <span className="pill pill-overdue">{overdue} overdue</span>}
          {thisWeek > 0 && <span className="pill pill-week">{thisWeek} due this week</span>}
        </span>
      </header>
      <ol className="wall-weeks-grid">
        {days.map(day => {
          const soon = day.items.some(item => item.kind === 'due' && !item.overdue && daysUntil(item.when, now) <= 3);
          const shown = day.items.length > PER_DAY ? day.items.slice(0, PER_DAY - 1) : day.items;
          const more = day.items.length - shown.length;
          const cls = [
            'wall-wk-day',
            `load-${Math.min(3, day.items.length)}`,
            day.isToday ? 'is-today' : '',
            day.isWeekend ? 'is-weekend' : '',
            soon ? 'is-soon' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={day.key} className={cls}>
              <span className="wall-wk-date">
                <span className="wall-wk-dow">{day.isToday ? 'Today' : format(day.date, 'EEE')}</span>
                <span className="wall-wk-num">{day.isToday || day.date.getDate() === 1 ? format(day.date, 'MMM d') : format(day.date, 'd')}</span>
              </span>
              <ul className="wall-wk-items">
                {shown.map(item => (
                  <Item key={`${item.note.id}-${item.kind}`} item={item} lanes={lanes} />
                ))}
                {more > 0 && <li className="wall-wk-more">+{more} more</li>}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
