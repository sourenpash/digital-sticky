import { useState } from 'react';
import { addMonths, format, parseISO, startOfMonth } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { datedNotes } from '../../../shared/board.ts';
import { dayKey, daysUntil, isPast, monthGrid } from '../../../shared/dates.ts';
import type { Board } from '../../../shared/types.ts';
import { AgendaList, type AgendaItem } from './Agenda.tsx';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarTab({ board, now, desktop, onOpen }: { board: Board; now: Date; desktop: boolean; onOpen: (id: string) => void }) {
  const [month, setMonth] = useState(() => startOfMonth(now));
  const [selected, setSelected] = useState(() => dayKey(now));
  const items = datedNotes(board.notes);
  const byDay = new Map<string, AgendaItem[]>();
  for (const item of items) {
    const key = dayKey(item.when.date);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  const colorOf = (item: AgendaItem) =>
    item.note.color ?? board.lanes.find(l => l.id === item.note.laneId)?.color ?? 'yellow';
  const overdue = items.filter(i => i.kind === 'due' && isPast(i.when, now));
  const soon = items.filter(i => !isPast(i.when, now) && daysUntil(i.when, now) <= 14);
  const selectedItems = byDay.get(selected) ?? [];

  return (
    <div className={`cal-tab${desktop ? ' is-desktop' : ''}`}>
      <section className="cal-card" aria-label="Month">
        <header className="cal-head">
          <h2>{format(month, 'MMMM yyyy')}</h2>
          <div className="cal-nav">
            <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setMonth(m => addMonths(m, -1))}>
              <ChevronLeft />
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setMonth(startOfMonth(now));
                setSelected(dayKey(now));
              }}
            >
              Today
            </button>
            <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setMonth(m => addMonths(m, 1))}>
              <ChevronRight />
            </button>
          </div>
        </header>
        <div className="cal-grid">
          {WEEKDAYS.map(d => (
            <span key={d} className="cal-dow">
              {desktop ? d : d.slice(0, 1)}
            </span>
          ))}
          {monthGrid(month, now)
            .flat()
            .map(day => {
              const dayItems = byDay.get(day.key) ?? [];
              const cls = [
                'cal-day',
                day.inMonth ? '' : 'is-out',
                day.isToday ? 'is-today' : '',
                day.isPast ? 'is-past' : '',
                selected === day.key ? 'is-selected' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={day.key}
                  type="button"
                  className={cls}
                  aria-pressed={selected === day.key}
                  aria-label={`${format(day.date, 'EEEE, MMMM d')}${dayItems.length ? `, ${dayItems.length} due` : ''}`}
                  onClick={() => setSelected(day.key)}
                >
                  <span className="cal-num">{format(day.date, 'd')}</span>
                  {desktop ? (
                    <span className="cal-items">
                      {dayItems.slice(0, 3).map(item => (
                        <span key={item.note.id} className={`cal-item paper-${colorOf(item)}`}>
                          {item.note.title}
                        </span>
                      ))}
                      {dayItems.length > 3 && <span className="cal-more">+{dayItems.length - 3} more</span>}
                    </span>
                  ) : (
                    <span className="cal-dots">
                      {dayItems.slice(0, 3).map(item => (
                        <i key={item.note.id} className={`dot-sm paper-${colorOf(item)}`} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
        </div>
      </section>

      <section className="agenda" aria-label="Agenda">
        <h3 className="section-title">{format(parseISO(selected), 'EEEE, MMMM d')}</h3>
        {selectedItems.length > 0 ? (
          <AgendaList items={selectedItems} lanes={board.lanes} now={now} onOpen={onOpen} />
        ) : (
          <p className="empty-line">Nothing due this day.</p>
        )}
        {overdue.length > 0 && (
          <>
            <h3 className="section-title is-danger">Overdue</h3>
            <AgendaList items={overdue} lanes={board.lanes} now={now} onOpen={onOpen} />
          </>
        )}
        <h3 className="section-title">Next 2 weeks</h3>
        {soon.length > 0 ? (
          <AgendaList items={soon} lanes={board.lanes} now={now} onOpen={onOpen} />
        ) : (
          <p className="empty-line">Nothing in the next two weeks.</p>
        )}
      </section>
    </div>
  );
}
