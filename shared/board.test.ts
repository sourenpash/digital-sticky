import { describe, expect, it } from 'vitest';
import { childProgress, compareNotes, linksByNote, noteWhen, relatedTo, twoWeekDays } from './board.ts';
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

describe('follow-ups and messages', () => {
  const nudge = { at: new Date('2026-10-14T09:00:00').toISOString(), everyDays: 14 };

  it('counts the follow-up instead of the deadline once an application is in or a message is sent', () => {
    expect(noteWhen(note('a', { stage: 'Submitted', due: '2026-09-28' }))).toBeNull();
    expect(noteWhen(note('a', { stage: 'Submitted', due: '2026-09-28', followUp: nudge }))).toMatchObject({ kind: 'follow' });
    expect(noteWhen(note('m', { channel: 'email', due: '2026-10-02' }))).toMatchObject({ kind: 'due' });
    expect(noteWhen(note('m', { channel: 'email', due: '2026-10-02', sentAt: now.toISOString() }))).toBeNull();
  });

  it('puts a follow-up that has come on today in the calendar strip', () => {
    const late = note('Follow up late', { stage: 'Submitted', followUp: { at: new Date('2026-09-29T09:00:00').toISOString(), everyDays: 7 } });
    const later = note('Follow up later', { channel: 'text', sentAt: now.toISOString(), followUp: { at: new Date('2026-10-12T09:00:00').toISOString(), everyDays: 3 } });
    const days = twoWeekDays([late, later], now);
    expect(days[0]?.items).toEqual([expect.objectContaining({ kind: 'follow', overdue: true, note: late })]);
    expect(titles(days.find(day => day.key === '2026-10-12'))).toEqual(['Follow up later']);
  });

  it('brings a submitted application back up when it is time to follow up', () => {
    const waiting = note('waiting', { stage: 'Submitted', followUp: nudge });
    const due = note('due', { stage: 'Submitted', followUp: { at: new Date('2026-09-30T09:00:00').toISOString(), everyDays: 14 } });
    const open = note('open', { due: '2026-11-01' });
    const sorted = [waiting, open, due].sort((a, b) => compareNotes(a, b, now)).map(n => n.id);
    expect(sorted).toEqual(['due', 'open', 'waiting']);
  });
});

describe('related tasks', () => {
  it('finds the parent and the related tasks, and how many are done', () => {
    const parent = note('p');
    const notes = [parent, note('c1', { parentId: 'p', done: true }), note('c2', { parentId: 'p' }), note('loop', { parentId: 'loop' })];
    expect(relatedTo(notes, parent).children.map(n => n.id)).toEqual(['c1', 'c2']);
    expect(relatedTo(notes, notes[1]!).parent?.id).toBe('p');
    expect(relatedTo(notes, notes[3]!)).toEqual({ parent: undefined, children: [] });
    expect(relatedTo(notes, note('orphan', { parentId: 'deleted' })).parent).toBeUndefined();
    expect(childProgress(notes, parent)).toEqual({ done: 1, total: 2 });
    expect(childProgress(notes, notes[2]!)).toBeNull();
  });

  it('works out every square’s links at once, with the parent’s color', () => {
    const lanes = [{ id: 'apps', title: 'Applications', color: 'yellow' as const, order: 0, kind: 'application' as const }];
    const notes = [note('p', { laneId: 'apps' }), note('c1', { parentId: 'p', done: true }), note('c2', { parentId: 'p' }), note('orphan', { parentId: 'gone' })];
    const links = linksByNote(notes, lanes);
    expect(links.get('p')).toEqual({ tasks: { done: 1, total: 2 } });
    expect(links.get('c2')).toMatchObject({ parent: notes[0], parentColor: 'yellow' });
    expect(links.get('orphan')).toBeUndefined();
  });
});
