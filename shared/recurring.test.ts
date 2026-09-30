import { describe, expect, it } from 'vitest';
import { describeRepeat, isRested, pruneCompletions, repeatStatus, weekDots } from './recurring.ts';
import type { Note, Repeat } from './types.ts';

// Wednesday evening, local time. The week started on Sunday, Sep 27.
const now = new Date('2026-09-30T19:42:00');

function routine(repeat: Repeat, completions: string[]): Note {
  return {
    id: 'r1',
    laneId: 'routine',
    title: 'Routine',
    body: '',
    checklist: [],
    links: [],
    pinned: false,
    done: false,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    repeat,
    completions: completions.map(local => new Date(local).toISOString()),
  };
}

describe('repeatStatus', () => {
  it('counts only this week for weekly goals', () => {
    const note = routine({ every: 'week', times: 5 }, ['2026-09-26T20:00', '2026-09-27T20:00', '2026-09-28T20:00', '2026-09-29T20:00']);
    const status = repeatStatus(note, now);
    expect(status?.done).toBe(3); // Saturday belongs to last week
    expect(status?.target).toBe(5);
    expect(status?.complete).toBe(false);
  });

  it('resets daily tasks at midnight', () => {
    const note = routine({ every: 'day', times: 1 }, ['2026-09-29T09:00']);
    expect(repeatStatus(note, now)?.doneToday).toBe(false);
    expect(isRested(note, now)).toBe(false);
    const doneToday = routine({ every: 'day', times: 1 }, ['2026-09-30T08:00']);
    expect(isRested(doneToday, now)).toBe(true);
  });

  it('uses set weekdays as the weekly count and finds the next one', () => {
    const note = routine({ every: 'week', times: 1, days: [1, 5] }, ['2026-09-28T10:00']);
    const status = repeatStatus(note, now);
    expect(status?.target).toBe(2);
    expect(status?.done).toBe(1);
    expect(status?.scheduledToday).toBe(false);
    expect(status?.nextDay?.getDay()).toBe(5); // Friday
  });

  it('is due today on a set day until it is done', () => {
    const wednesdays = routine({ every: 'week', times: 1, days: [3] }, []);
    expect(repeatStatus(wednesdays, now)?.nextDay?.getDate()).toBe(30);
    const done = routine({ every: 'week', times: 1, days: [3] }, ['2026-09-30T07:30']);
    expect(repeatStatus(done, now)?.complete).toBe(true);
    expect(repeatStatus(done, now)?.nextDay?.getDate()).toBe(7); // next Wednesday
  });

  it('ignores completions logged in the future', () => {
    const note = routine({ every: 'month', times: 2 }, ['2026-09-02T10:00', '2026-09-30T23:00']);
    expect(repeatStatus(note, now)?.done).toBe(1);
  });
});

describe('describeRepeat', () => {
  it('reads like a sentence', () => {
    expect(describeRepeat({ every: 'day', times: 1 })).toBe('Every day');
    expect(describeRepeat({ every: 'week', times: 1 })).toBe('Once a week');
    expect(describeRepeat({ every: 'week', times: 3 })).toBe('3 times a week');
    expect(describeRepeat({ every: 'month', times: 2 })).toBe('Twice a month');
    expect(describeRepeat({ every: 'week', times: 1, days: [1] })).toBe('Every Monday');
    expect(describeRepeat({ every: 'week', times: 1, days: [5, 1, 3] })).toBe('Every Mon, Wed and Fri');
    expect(describeRepeat({ every: 'week', times: 1, days: [1, 2, 3, 4, 5] })).toBe('Every weekday');
  });
});

describe('weekDots', () => {
  it('marks the days of this week that were done', () => {
    const dots = weekDots(routine({ every: 'day', times: 1 }, ['2026-09-28T09:00', '2026-09-29T09:00']), now);
    expect(dots.map(d => d.done)).toEqual([false, true, true, false, false, false, false]);
    expect(dots.findIndex(d => d.isToday)).toBe(3);
    expect(dots.filter(d => d.isFuture)).toHaveLength(3);
  });
});

describe('pruneCompletions', () => {
  it('drops entries older than two months', () => {
    const kept = pruneCompletions([new Date('2026-07-01T10:00').toISOString(), new Date('2026-09-01T10:00').toISOString()], now);
    expect(kept).toHaveLength(1);
  });
});
