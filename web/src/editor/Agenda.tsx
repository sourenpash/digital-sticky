import { format } from 'date-fns';
import { Bell, CalendarDays, Reply } from 'lucide-react';
import type { NoteWhen } from '../../../shared/board.ts';
import { timeLabel } from '../../../shared/dates.ts';
import { spanLabel, spanOnDay, spanOver } from '../../../shared/spans.ts';
import type { Lane, Note } from '../../../shared/types.ts';
import { chipFor } from '../components/chip.ts';

export type AgendaItem = { note: Note } & NoteWhen;

/** `day`: the list is for that calendar day, so an event of several days says how it stands on it. */
export function AgendaList({ items, lanes, now, day, onOpen }: { items: AgendaItem[]; lanes: Lane[]; now: Date; day?: Date; onOpen: (id: string) => void }) {
  return (
    <ul className="agenda-list">
      {items.map(({ note, when, kind, span }) => {
        const lane = lanes.find(l => l.id === note.laneId);
        const chip = chipFor(note, now);
        const eventTime = span ? ((day && spanOnDay(span, day)) ?? spanLabel(span)) : null;
        return (
          <li key={`${note.id}-${kind}`}>
            <button type="button" className="agenda-row" onClick={() => onOpen(note.id)}>
              <span className="agenda-date">
                <span className="agenda-dow">{format(when.date, 'EEE')}</span>
                <span className="agenda-day">{format(when.date, 'd')}</span>
              </span>
              <span className="agenda-main">
                <span className="agenda-title">
                  {kind === 'remind' && <Bell aria-label="Reminder" />}
                  {kind === 'follow' && <Reply aria-label="Follow up" />}
                  {kind === 'event' && <CalendarDays aria-label="Event" />}
                  {note.title}
                </span>
                <span className="agenda-meta">
                  <span className={`dot-sm paper-${note.color ?? lane?.color ?? 'yellow'}`} aria-hidden="true" />
                  {lane?.title}
                  {note.funder ? ` · ${note.funder}` : ''}
                </span>
              </span>
              {span ? (
                <span className={`chip chip-${spanOver(span, now) ? 'muted' : 'remind'} chip-ui`}>{eventTime}</span>
              ) : chip && (
                <span className={`chip chip-${chip.tone} chip-ui`}>
                  {kind === 'remind' && chip.tone === 'remind' && !when.allDay ? timeLabel(when.date) : chip.label}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
