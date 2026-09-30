import { describe, expect, expectTypeOf, it } from 'vitest';
import { makeEmptyBoard } from './defaults.ts';
import { applyOp, type NotePatch, type Op } from './ops.ts';
import type { Board, Note } from './types.ts';

const now = new Date('2026-09-30T19:42:00');
const later = new Date('2026-09-30T20:00:00');

function note(fields: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    laneId: 'todo',
    title: 'Email program officer',
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

function boardWith(...notes: Note[]): Board {
  return { ...makeEmptyBoard(), notes };
}

const apply = (board: Board, ...ops: Op[]) => ops.reduce((b, op) => applyOp(b, op, now), board);

describe('applyOp', () => {
  it('only lets optional fields be cleared with null', () => {
    expectTypeOf<NotePatch['funder']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<NotePatch['title']>().toEqualTypeOf<string | undefined>();
  });

  it('adds a note once, even when the same add arrives twice', () => {
    const add: Op = { type: 'note.add', note: note() };
    const board = apply(makeEmptyBoard(), add, add);
    expect(board.notes).toHaveLength(1);
  });

  it('patches fields and clears the ones sent as null', () => {
    const board = apply(boardWith(note({ funder: 'NSF', amount: '$5k' })), {
      type: 'note.patch',
      id: 'n1',
      patch: { title: 'Call the NSF', funder: null },
    });
    const [changed] = board.notes;
    expect(changed?.title).toBe('Call the NSF');
    expect(changed && 'funder' in changed).toBe(false);
    expect(changed?.amount).toBe('$5k');
    expect(changed?.updatedAt).toBe(now.toISOString());
  });

  it('stamps doneAt when a note is finished and drops its reminder pop-up', () => {
    const start: Board = { ...boardWith(note()), alerts: [{ id: 'a1', noteId: 'n1', title: 'x', firedAt: now.toISOString() }] };
    const done = apply(start, { type: 'note.patch', id: 'n1', patch: { done: true } });
    expect(done.notes[0]?.doneAt).toBe(now.toISOString());
    expect(done.alerts).toHaveLength(0);
    const undone = apply(done, { type: 'note.patch', id: 'n1', patch: { done: false } });
    expect(undone.notes[0]?.doneAt).toBeUndefined();
  });

  it('leaves the board untouched when the note is gone', () => {
    const board = boardWith(note());
    expect(apply(board, { type: 'note.patch', id: 'missing', patch: { title: 'x' } })).toBe(board);
    expect(apply(board, { type: 'note.delete', id: 'missing' })).toBe(board);
  });

  it('restores a deleted note from the copy the phone kept', () => {
    const original = note();
    const deleted = apply(boardWith(original), { type: 'note.delete', id: 'n1' });
    expect(deleted.notes).toHaveLength(0);
    const restored = apply(deleted, { type: 'note.restore', id: 'n1', note: original }, { type: 'note.restore', id: 'n1', note: original });
    expect(restored.notes).toEqual([original]);
  });

  it('adds and takes back recurring "Did it" times without duplicates', () => {
    const routine = note({ repeat: { every: 'week', times: 3 }, completions: ['2026-09-28T13:00:00.000Z'] });
    const at = '2026-09-30T23:00:00.000Z';
    const logged = apply(boardWith(routine), { type: 'note.completions', id: 'n1', add: [at] }, { type: 'note.completions', id: 'n1', add: [at] });
    expect(logged.notes[0]?.completions).toEqual(['2026-09-28T13:00:00.000Z', at]);
    const undone = apply(logged, { type: 'note.completions', id: 'n1', remove: [at] });
    expect(undone.notes[0]?.completions).toEqual(['2026-09-28T13:00:00.000Z']);
  });

  it('deletes a column with its notes and puts both back', () => {
    const board = boardWith(note({ id: 'a', laneId: 'remind' }), note({ id: 'b', laneId: 'todo' }));
    const lane = board.lanes.find(l => l.id === 'remind');
    const gone = apply(board, { type: 'lane.delete', id: 'remind' });
    expect(gone.lanes.map(l => l.id)).not.toContain('remind');
    expect(gone.notes.map(n => n.id)).toEqual(['b']);
    const back = apply(gone, { type: 'lane.restore', id: 'remind', lane, notes: [board.notes[0]!] });
    expect(back.lanes).toHaveLength(5);
    expect(back.notes.map(n => n.id).sort()).toEqual(['a', 'b']);
  });

  it('reorders columns, keeping any it was not told about at the end', () => {
    const board = apply(makeEmptyBoard(), { type: 'lane.order', ids: ['remind', 'apps'] });
    const order = [...board.lanes].sort((a, b) => a.order - b.order).map(l => l.id);
    expect(order).toEqual(['remind', 'apps', 'check', 'todo', 'routine']);
  });

  it('merges ticker settings without touching the rest', () => {
    const board = apply(makeEmptyBoard(), { type: 'settings.patch', patch: { ticker: { stocks: ['TSLA'] } } });
    expect(board.settings.ticker).toMatchObject({ show: true, crypto: ['BTC', 'ETH'], stocks: ['TSLA'] });
    expect(board.settings.wall.chime).toBe(true);
  });

  it('merges settings without clearing what was not sent', () => {
    const board = apply(makeEmptyBoard(), { type: 'settings.patch', patch: { night: { mode: 'on' }, wall: { chime: false } } });
    expect(board.settings.night).toEqual({ mode: 'on', start: '22:00', end: '07:00', style: 'dim' });
    expect(board.settings.wall.chime).toBe(false);
    expect(board.settings.wall.showConnect).toBe(true);
  });

  it('pops a reminder up once per note', () => {
    const board = apply(
      boardWith(note()),
      { type: 'alert.fire', id: 'a1', noteId: 'n1' },
      { type: 'alert.fire', id: 'a2', noteId: 'n1' },
    );
    expect(board.alerts).toEqual([{ id: 'a1', noteId: 'n1', title: 'Email program officer', firedAt: now.toISOString() }]);
    expect(applyOp(board, { type: 'alert.dismiss', id: 'a1' }, later).alerts).toHaveLength(0);
  });
});
