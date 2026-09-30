import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeResponse, StateResponse } from '../../../shared/api.ts';
import { makeEmptyBoard } from '../../../shared/defaults.ts';
import { applyOp, type Op } from '../../../shared/ops.ts';
import type { Board, Note } from '../../../shared/types.ts';
import { HttpError, SyncEngine, type Transport } from './sync.ts';

function note(id: string, fields: Partial<Note> = {}): Note {
  return {
    id,
    laneId: 'todo',
    title: `Note ${id}`,
    body: '',
    checklist: [],
    links: [],
    pinned: false,
    done: false,
    createdAt: '2026-09-30T12:00:00.000Z',
    updatedAt: '2026-09-30T12:00:00.000Z',
    ...fields,
  };
}

/** A pretend board server that can be slow, down, or say no. */
class FakeServer implements Transport {
  board: Board = { ...makeEmptyBoard(), notes: [note('a'), note('b')] };
  rev = 0;
  epoch = 'run-1';
  sent: Op[] = [];
  down = false;
  refuse: { status: number; message: string } | null = null;
  /** Set to hold answers until `release()`. */
  hold = false;
  private held: Array<() => void> = [];

  snapshot(): StateResponse {
    return { epoch: this.epoch, rev: this.rev, board: this.board, connectUrl: null };
  }

  async load(): Promise<StateResponse> {
    if (this.down) throw new TypeError('Failed to fetch');
    return this.snapshot();
  }

  async send(op: Op): Promise<ChangeResponse> {
    if (this.down) throw new TypeError('Failed to fetch');
    if (this.refuse) throw new HttpError(this.refuse.status, this.refuse.message);
    this.sent.push(op);
    this.board = applyOp(this.board, op, new Date());
    this.rev += 1;
    const answer = { epoch: this.epoch, rev: this.rev };
    if (this.hold) await new Promise<void>(resolve => this.held.push(resolve));
    return answer;
  }

  release(): void {
    this.held.splice(0).forEach(resolve => resolve());
  }
}

let server: FakeServer;
let errors: string[];
let reloads: number;

function engine(buildId = 'build-1') {
  return new SyncEngine({
    transport: server,
    initial: server.snapshot(),
    buildId,
    onError: message => errors.push(message),
    onReload: () => reloads++,
  });
}

const titles = (e: SyncEngine) => e.getBoard()?.notes.map(n => n.title);

beforeEach(() => {
  vi.useFakeTimers();
  server = new FakeServer();
  errors = [];
  reloads = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SyncEngine', () => {
  it('shows a change straight away and saves it in the background', async () => {
    const e = engine();
    e.dispatch({ type: 'note.add', note: note('c') });
    expect(titles(e)).toEqual(['Note a', 'Note b', 'Note c']);
    expect(e.getState().waiting).toBe(1);
    await vi.runAllTimersAsync();
    expect(server.sent.map(op => op.type)).toEqual(['note.add']);
    expect(e.getState().waiting).toBe(0);
    expect(titles(e)).toEqual(['Note a', 'Note b', 'Note c']);
  });

  it('sends a run of typing as one change', async () => {
    const e = engine();
    for (const title of ['C', 'Ca', 'Cal', 'Call']) e.dispatch({ type: 'note.patch', id: 'a', patch: { title } }, 600);
    expect(titles(e)?.[0]).toBe('Call');
    await vi.advanceTimersByTimeAsync(599);
    expect(server.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.sent).toEqual([{ type: 'note.patch', id: 'a', patch: { title: 'Call' } }]);
  });

  it('sends waiting typing first when an instant change comes after it', async () => {
    const e = engine();
    e.dispatch({ type: 'note.patch', id: 'a', patch: { title: 'Typed' } }, 600);
    e.dispatch({ type: 'note.patch', id: 'b', patch: { pinned: true } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.sent.map(op => ('id' in op ? op.id : ''))).toEqual(['a', 'b']);
  });

  it('keeps changes while offline and sends them once the server is back', async () => {
    const e = engine();
    e.handleHello({ epoch: 'run-1', rev: 0, buildId: 'build-1' });
    server.down = true;
    e.dispatch({ type: 'note.patch', id: 'a', patch: { title: 'Written offline' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(e.getState()).toMatchObject({ status: 'offline', waiting: 1 });
    expect(titles(e)?.[0]).toBe('Written offline');

    server.down = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.sent).toHaveLength(1);
    expect(server.board.notes[0]?.title).toBe('Written offline');
    expect(e.getState()).toMatchObject({ status: 'live', waiting: 0 });
  });

  it('backs off between retries and retries at once when told the server is back', async () => {
    const e = engine();
    server.down = true;
    e.dispatch({ type: 'note.patch', id: 'a', patch: { pinned: true } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1999);
    server.down = false;
    expect(server.sent).toHaveLength(0);
    e.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.sent).toHaveLength(1);
  });

  it('drops a change the server refuses, shows why, and goes back to the saved board', async () => {
    const e = engine();
    server.refuse = { status: 400, message: 'title: Too big' };
    e.dispatch({ type: 'note.patch', id: 'a', patch: { title: 'x'.repeat(400) } });
    await vi.runAllTimersAsync();
    expect(errors).toEqual(["Couldn't save that change: title: Too big"]);
    expect(titles(e)?.[0]).toBe('Note a');
    expect(e.getState().waiting).toBe(0);
  });

  it('treats "already on the board" as saved (a retry of an add that got through)', async () => {
    const e = engine();
    server.refuse = { status: 409, message: 'That note is already on the board' };
    e.dispatch({ type: 'note.add', note: note('c') });
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toEqual([]);
  });

  it('keeps a saved change on screen until the refreshed board includes it', async () => {
    const e = engine();
    server.hold = true;
    e.dispatch({ type: 'note.patch', id: 'a', patch: { title: 'New title' } });
    await vi.advanceTimersByTimeAsync(0);
    // Another device's change arrives first; ours is on the server but not answered yet.
    e.handleChange({ epoch: 'run-1', rev: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(titles(e)?.[0]).toBe('New title');
    server.release();
    await vi.runAllTimersAsync();
    expect(titles(e)?.[0]).toBe('New title');
    expect(e.getState().waiting).toBe(0);
  });

  it('ignores a board older than the one it has', async () => {
    const e = engine();
    server.board = { ...server.board, notes: [note('a', { title: 'Newer' })] };
    server.rev = 5;
    await e.refresh();
    server.board = { ...server.board, notes: [note('a', { title: 'Older' })] };
    server.rev = 4;
    await e.refresh();
    expect(titles(e)).toEqual(['Newer']);
  });

  it('takes the board of a restarted server even if its revision is lower', async () => {
    const e = engine();
    server.rev = 7;
    await e.refresh();
    server.epoch = 'run-2';
    server.rev = 0;
    server.board = { ...server.board, notes: [note('z', { title: 'Restored from backup' })] };
    e.handleHello({ epoch: 'run-2', rev: 0, buildId: 'build-1' });
    await vi.runAllTimersAsync();
    expect(titles(e)).toEqual(['Restored from backup']);
  });

  it('reloads after the server is updated, but only once changes are saved', async () => {
    const e = engine('build-1');
    server.hold = true;
    e.dispatch({ type: 'note.patch', id: 'a', patch: { pinned: true } });
    await vi.advanceTimersByTimeAsync(0);
    e.handleHello({ epoch: 'run-1', rev: 1, buildId: 'build-2' });
    expect(reloads).toBe(0);
    server.release();
    await vi.runAllTimersAsync();
    expect(reloads).toBe(1);
  });

  it('says "that note was deleted" when another device deleted it first', async () => {
    const e = engine();
    server.refuse = { status: 404, message: 'That note is not on the board' };
    e.dispatch({ type: 'note.patch', id: 'a', patch: { pinned: true } });
    await vi.runAllTimersAsync();
    expect(errors).toEqual(['That note was deleted on another device.']);
  });
});
