import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { applyOp } from '../shared/ops.ts';
import type { Alert, Board, Note } from '../shared/types.ts';
import { reminderTick, startReminders } from './reminders.ts';
import { BoardStore } from './store.ts';

const MIN = 60_000;
const now = new Date('2026-10-01T10:00:00');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * MIN).toISOString();

function note(fields: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    laneId: 'remind',
    title: 'Call the financial office',
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

function boardWith(notes: Note[], alerts: Alert[] = []): Board {
  return { ...makeEmptyBoard(), notes, alerts };
}

let ids = 0;
const nextId = () => `a${++ids}`;

/** One tick at `at`: what it decided, and the board after applying it. */
function tick(board: Board, at = now) {
  const change = reminderTick(board, at, nextId);
  return { change, board: change ? applyOp(board, change, at) : board };
}

describe('reminderTick', () => {
  it('pops a reminder up once when its time comes', () => {
    const due = note({ remindAt: minutesAgo(1) });
    const first = tick(boardWith([due]));
    expect(first.change?.fire).toEqual([expect.objectContaining({ noteId: 'n1', show: true })]);
    expect(first.board.alerts).toEqual([expect.objectContaining({ noteId: 'n1', title: due.title, firedAt: now.toISOString() })]);
    expect(first.board.notes[0]?.remindedFor).toBe(due.remindAt);
    expect(tick(first.board).change).toBeNull();
  });

  it('waits for reminders that are still ahead', () => {
    const later = new Date(now.getTime() + 5 * MIN).toISOString();
    expect(tick(boardWith([note({ remindAt: later })])).change).toBeNull();
  });

  it('goes off again when the reminder is moved to a new time', () => {
    const fired = tick(boardWith([note({ remindAt: minutesAgo(1) })])).board;
    const later = new Date(now.getTime() + 10 * MIN);
    const moved = applyOp(fired, { type: 'note.patch', id: 'n1', patch: { remindAt: later.toISOString() } }, now);
    expect(tick(moved).change).toBeNull();
    expect(tick(moved, later).change?.fire).toEqual([expect.objectContaining({ show: true })]);
  });

  it('marks finished notes and long-missed reminders without popping them up', () => {
    const board = boardWith([
      note({ id: 'done', remindAt: minutesAgo(5), done: true }),
      note({ id: 'old', remindAt: minutesAgo(25 * 60) }),
      note({ id: 'recent', remindAt: minutesAgo(23 * 60) }),
    ]);
    const { change, board: after } = tick(board);
    expect(change?.fire.map(f => [f.noteId, f.show])).toEqual([
      ['done', false],
      ['old', false],
      ['recent', true],
    ]);
    expect(after.alerts.map(a => a.noteId)).toEqual(['recent']);
    expect(after.notes.every(n => n.remindedFor === n.remindAt)).toBe(true);
    // Un-doing the finished one later doesn't bring its old reminder back.
    const undone = applyOp(after, { type: 'note.patch', id: 'done', patch: { done: false } }, now);
    expect(tick(undone).change).toBeNull();
  });

  it('replaces a "Try it" pop-up for the same note, so it stays up for the full time', () => {
    const tryIt: Alert = { id: 'try', noteId: 'n1', title: 'Call the financial office', firedAt: minutesAgo(30) };
    const { board } = tick(boardWith([note({ remindAt: minutesAgo(1) })], [tryIt]));
    expect(board.alerts).toHaveLength(1);
    expect(board.alerts[0]?.id).not.toBe('try');
    expect(board.alerts[0]?.firedAt).toBe(now.toISOString());
  });

  it('takes pop-ups down after the "stay up for" time', () => {
    const board = boardWith(
      [note({ id: 'n1' }), note({ id: 'n2' })],
      [
        { id: 'old', noteId: 'n1', title: 'x', firedAt: minutesAgo(60) },
        { id: 'new', noteId: 'n2', title: 'y', firedAt: minutesAgo(59) },
      ],
    );
    const { change, board: after } = tick(board);
    expect(change).toEqual({ type: 'reminders.tick', fire: [], expire: ['old'] });
    expect(after.alerts.map(a => a.id)).toEqual(['new']);
    const shorter = { ...board, settings: { ...board.settings, wall: { ...board.settings.wall, alertMinutes: 15 } } };
    expect(tick(shorter).change?.expire).toEqual(['old', 'new']);
  });

  it('keeps no more than 200 pop-ups; the rest wait their turn', () => {
    const notes = Array.from({ length: 200 }, (_, i) => note({ id: `n${i}` }));
    const alerts = notes.map((n, i) => ({ id: `x${i}`, noteId: n.id, title: n.title, firedAt: minutesAgo(1) }));
    const board = boardWith([...notes, note({ id: 'waiting', remindAt: minutesAgo(1) })], alerts);
    expect(tick(board).change).toBeNull();
    const roomMade = { ...board, alerts: alerts.slice(1) };
    expect(tick(roomMade).change?.fire).toEqual([expect.objectContaining({ noteId: 'waiting', show: true })]);
  });

  it('skips a reminder that was moved between the check and the change', () => {
    const board = boardWith([note({ remindAt: minutesAgo(1) })]);
    const change = reminderTick(board, now, nextId);
    const later = new Date(now.getTime() + 60 * MIN).toISOString();
    const moved = applyOp(board, { type: 'note.patch', id: 'n1', patch: { remindAt: later } }, now);
    const after = applyOp(moved, change!, now);
    expect(after.alerts).toEqual([]);
    expect(after.notes[0]?.remindedFor).toBeUndefined();
  });
});

describe('follow-up nudges', () => {
  const DAY = 24 * 60 * MIN;
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
  const submitted = (fields: Partial<Note> = {}) =>
    note({ laneId: 'apps', title: 'NSF CAREER', stage: 'Submitted', followUp: { at: minutesAgo(1), everyDays: 14 }, ...fields });

  it('nudges when the follow-up time comes, then again each interval until it is dealt with', () => {
    const first = tick(boardWith([submitted()]));
    expect(first.change?.fire).toEqual([expect.objectContaining({ noteId: 'n1', kind: 'follow', show: true, remindAt: minutesAgo(1) })]);
    expect(first.board.alerts).toEqual([expect.objectContaining({ noteId: 'n1', kind: 'follow', title: 'NSF CAREER' })]);
    expect(first.board.notes[0]?.followedUpFor).toBe(minutesAgo(1));
    // Nothing more until the next interval (the pop-up itself times out after an hour).
    expect(tick(first.board, at(13 * DAY)).change?.fire).toEqual([]);
    const second = tick(first.board, at(14 * DAY));
    expect(second.change?.fire).toEqual([expect.objectContaining({ kind: 'follow', show: true })]);
    expect(second.board.notes[0]?.followedUpFor).toBe(new Date(Date.parse(minutesAgo(1)) + 14 * DAY).toISOString());
  });

  it('nudges a one-time follow-up only once', () => {
    const once = tick(boardWith([submitted({ followUp: { at: minutesAgo(1), everyDays: 0 } })])).board;
    expect(tick(once, at(30 * DAY)).change?.fire ?? []).toEqual([]);
  });

  it('stops once the follow-up is moved on, stopped or the note is done', () => {
    const fired = tick(boardWith([submitted()])).board;
    // "I followed up": the next nudge is two weeks away, and the pop-up goes.
    const movedOn = applyOp(fired, { type: 'note.patch', id: 'n1', patch: { followUp: { at: at(14 * DAY).toISOString(), everyDays: 14 } } }, now);
    expect(movedOn.alerts).toEqual([]);
    expect(tick(movedOn, at(13 * DAY)).change?.fire ?? []).toEqual([]);
    // "Heard back": the stage moves on and the follow-up is cleared.
    const heard = applyOp(fired, { type: 'note.patch', id: 'n1', patch: { stage: 'Interview', followUp: null } }, now);
    expect(heard.alerts).toEqual([]);
    expect(tick(heard, at(60 * DAY)).change?.fire ?? []).toEqual([]);
    // A reply to a message marks it done.
    const replied = applyOp(fired, { type: 'note.patch', id: 'n1', patch: { done: true } }, now);
    expect(replied.alerts).toEqual([]);
    expect(tick(replied, at(14 * DAY)).change?.fire).toEqual([expect.objectContaining({ show: false })]);
  });

  it('skips nudges missed by more than a day, but still nudges at the next one', () => {
    const missed = tick(boardWith([submitted({ followUp: { at: minutesAgo(25 * 60), everyDays: 7 } })]));
    expect(missed.change?.fire).toEqual([expect.objectContaining({ kind: 'follow', show: false })]);
    expect(missed.board.alerts).toEqual([]);
    expect(tick(missed.board, at(7 * DAY - 25 * 60 * MIN)).change?.fire).toEqual([expect.objectContaining({ show: true })]);
  });

  it('can nudge and remind about the same note, keeping one pop-up for it', () => {
    const { change, board } = tick(boardWith([submitted({ remindAt: minutesAgo(2) })]));
    expect(change?.fire.map(f => f.kind ?? 'remind')).toEqual(['remind', 'follow']);
    expect(board.alerts).toEqual([expect.objectContaining({ kind: 'follow' })]);
    expect(board.notes[0]).toMatchObject({ remindedFor: minutesAgo(2), followedUpFor: minutesAgo(1) });
  });

  it('skips a nudge whose follow-up changed between the check and the change', () => {
    const board = boardWith([submitted()]);
    const change = reminderTick(board, now, nextId);
    const stopped = applyOp(board, { type: 'note.patch', id: 'n1', patch: { followUp: null } }, now);
    const after = applyOp(stopped, change!, now);
    expect(after.alerts).toEqual([]);
    expect(after.notes[0]?.followedUpFor).toBeUndefined();
  });
});

describe('startReminders', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  it('catches up as soon as the server starts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sticky-reminders-'));
    dirs.push(dir);
    const store = await BoardStore.open({
      dir,
      seed: () => boardWith([note({ remindAt: minutesAgo(3) })]),
      now: () => now,
      saveDelayMs: 5,
    });
    const stop = startReminders(store, { tickMs: 60_000 });
    expect(store.board.alerts).toHaveLength(1);
    const rev = store.rev;
    stop();
    expect(store.rev).toBe(rev);
    await store.close();
  });

  it('keeps going when a check fails', () => {
    vi.useFakeTimers();
    try {
      const log = vi.fn();
      const board = boardWith([note({ remindAt: minutesAgo(1) })]);
      const apply = vi.fn(() => {
        throw new Error('disk full');
      });
      const store = { board, now: () => now, apply } as unknown as BoardStore;
      const stop = startReminders(store, { tickMs: 1000, log });
      vi.advanceTimersByTime(2500);
      stop();
      expect(apply).toHaveBeenCalledTimes(3);
      expect(log).toHaveBeenCalledWith('Could not update reminders: disk full');
    } finally {
      vi.useRealTimers();
    }
  });
});
