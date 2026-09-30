import { describe, expect, it } from 'vitest';
import { twoWeekDays } from './board.ts';
import type { Note } from './types.ts';

const now = new Date('2026-09-30T19:42:00'); // a Wednesday evening

function note(id: string, fields: Partial<Note> = {}): Note {
  return {
    id,
    laneId: 'todo',
    title: id,
    body: '',
    checklist: [],
    links: [],
    pinned: false,
    done: false,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...fields,
  };
}

const titles = (day: { items: Array<{ note: Note }> } | undefined) => day?.items.map(item => item.note.title);

describe('twoWeekDays', () => {
  it('covers today and the next 13 days, marking today and weekends', () => {
    const days = twoWeekDays([], now);
    expect(days).toHaveLength(14);
    expect(days[0]).toMatchObject({ key: '2026-09-30', isToday: true, isWeekend: false });
    expect(days[3]).toMatchObject({ key: '2026-10-03', isWeekend: true });
    expect(days[13]?.key).toBe('2026-10-13');
  });

  it('writes deadlines and reminders into their days, in time order', () => {
    const days = twoWeekDays(
      [
        note('Call at 10', { remindAt: new Date('2026-10-01T10:00:00').toISOString() }),
        note('All-day', { due: '2026-10-01' }),
        note('Due 5 PM', { due: new Date('2026-10-01T17:00:00').toISOString() }),
        note('Far off', { due: '2026-11-20' }),
        note('Done already', { due: '2026-10-02', done: true }),
      ],
      now,
    );
    expect(titles(days[1])).toEqual(['All-day', 'Call at 10', 'Due 5 PM']);
    expect(days.flatMap(day => day.items)).toHaveLength(3);
  });

  it('puts overdue deadlines on today and leaves out reminders that already went off', () => {
    const [today] = twoWeekDays(
      [
        note('Late', { due: '2026-09-27' }),
        note('Earlier today', { due: new Date('2026-09-30T17:00:00').toISOString() }),
        note('Tonight', { due: new Date('2026-09-30T21:00:00').toISOString() }),
        note('Went off', { remindAt: new Date('2026-09-30T09:00:00').toISOString() }),
      ],
      now,
    );
    expect(titles(today)).toEqual(['Late', 'Earlier today', 'Tonight']);
    expect(today?.items.map(item => item.overdue)).toEqual([true, true, false]);
  });
});
