import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { makeSampleBoard } from '../shared/sample.ts';
import type { Note } from '../shared/types.ts';
import { BoardStore, StoreError, type StoreOptions } from './store.ts';

const DAY = 24 * 60 * 60 * 1000;

let dir: string;
let clock: Date;
const stores: BoardStore[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sticky-store-'));
  clock = new Date('2026-09-30T19:42:00');
});

afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => store.close()));
  await rm(dir, { recursive: true, force: true });
});

async function open(options: Partial<StoreOptions> = {}): Promise<BoardStore> {
  const store = await BoardStore.open({ dir, seed: makeEmptyBoard, now: () => clock, saveDelayMs: 5, ...options });
  stores.push(store);
  return store;
}

function note(fields: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    laneId: 'todo',
    title: 'Email the program officer',
    body: '',
    checklist: [],
    links: [],
    pinned: false,
    done: false,
    createdAt: clock.toISOString(),
    updatedAt: clock.toISOString(),
    ...fields,
  };
}

async function savedFile(): Promise<{ rev: number; board: { notes: Note[] }; trash: { notes: unknown[] } }> {
  return JSON.parse(await readFile(join(dir, 'board.json'), 'utf8'));
}

function statusOf(run: () => unknown): number | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof StoreError) return error.status;
    throw error;
  }
  return undefined;
}

describe('BoardStore', () => {
  it('starts a new board from the seed and saves it right away', async () => {
    const store = await open();
    expect(store.rev).toBe(0);
    expect(store.board.lanes).toHaveLength(5);
    expect((await savedFile()).rev).toBe(0);
  });

  it('applies a change, bumps the revision and tells listeners', async () => {
    const store = await open();
    const heard: number[] = [];
    store.subscribe(rev => heard.push(rev));
    expect(store.apply({ type: 'note.add', note: note() })).toBe(1);
    expect(store.board.notes.map(n => n.title)).toEqual(['Email the program officer']);
    expect(heard).toEqual([1]);
  });

  it('saves changes and reads them back after a restart', async () => {
    const store = await open();
    store.apply({ type: 'note.add', note: note() });
    store.apply({ type: 'note.patch', id: 'n1', patch: { title: 'Call the program officer' } });
    await store.flush();
    await store.close();
    stores.length = 0;

    const reopened = await open();
    expect(reopened.rev).toBe(2);
    expect(reopened.board.notes[0]?.title).toBe('Call the program officer');
    expect(reopened.epoch).not.toBe(store.epoch);
  });

  it('writes through a temp file and leaves none behind', async () => {
    const store = await open();
    store.apply({ type: 'note.add', note: note() });
    await store.flush();
    expect((await readdir(dir)).sort()).toEqual(['backups', 'board.json']);
    expect((await savedFile()).board.notes).toHaveLength(1);
  });

  it('turns down changes it cannot make', async () => {
    const store = await open();
    store.apply({ type: 'note.add', note: note() });
    expect(statusOf(() => store.apply({ type: 'note.add', note: note() }))).toBe(409);
    expect(statusOf(() => store.apply({ type: 'note.add', note: note({ id: 'n2', laneId: 'nope' }) }))).toBe(400);
    expect(statusOf(() => store.apply({ type: 'note.patch', id: 'missing', patch: { title: 'x' } }))).toBe(404);
    expect(statusOf(() => store.apply({ type: 'note.add', note: note({ id: 'n3', title: 'x'.repeat(301) }) }))).toBe(400);
    expect(store.rev).toBe(1);
  });

  it('never deletes the last column', async () => {
    const store = await open();
    for (const lane of store.board.lanes.slice(1)) store.apply({ type: 'lane.delete', id: lane.id });
    const last = store.board.lanes[0]!;
    expect(statusOf(() => store.apply({ type: 'lane.delete', id: last.id }))).toBe(409);
  });

  it('keeps deleted notes in the trash so Undo works from any device', async () => {
    const store = await open();
    store.apply({ type: 'note.add', note: note() });
    store.apply({ type: 'note.delete', id: 'n1' });
    expect(store.board.notes).toHaveLength(0);
    store.apply({ type: 'note.restore', id: 'n1' });
    expect(store.board.notes.map(n => n.id)).toEqual(['n1']);
    // Restoring twice is fine; restoring something that isn't in the trash is not.
    const rev = store.rev;
    expect(store.apply({ type: 'note.restore', id: 'n1' })).toBe(rev);
    expect(statusOf(() => store.apply({ type: 'note.restore', id: 'never' }))).toBe(404);
  });

  it('empties the trash after 30 days', async () => {
    const store = await open();
    store.apply({ type: 'note.add', note: note() });
    store.apply({ type: 'note.delete', id: 'n1' });
    await store.flush();
    expect((await savedFile()).trash.notes).toHaveLength(1);

    clock = new Date(clock.getTime() + 31 * DAY);
    store.apply({ type: 'settings.patch', patch: { wall: { chime: false } } });
    await store.flush();
    expect((await savedFile()).trash.notes).toHaveLength(0);
    expect(statusOf(() => store.apply({ type: 'note.restore', id: 'n1' }))).toBe(404);
  });

  it('brings back a deleted column with its notes', async () => {
    const store = await open();
    store.apply({ type: 'note.add', note: note({ laneId: 'remind' }) });
    store.apply({ type: 'lane.delete', id: 'remind' });
    expect(store.board.notes).toHaveLength(0);
    store.apply({ type: 'lane.restore', id: 'remind' });
    expect(store.board.lanes.map(l => l.id)).toContain('remind');
    expect(store.board.notes.map(n => n.id)).toEqual(['n1']);
  });

  it('puts a restored note in the first column if its column is gone', async () => {
    const store = await open();
    store.apply({ type: 'note.add', note: note({ laneId: 'remind' }) });
    store.apply({ type: 'note.delete', id: 'n1' });
    store.apply({ type: 'lane.delete', id: 'remind' });
    store.apply({ type: 'note.restore', id: 'n1' });
    expect(store.board.notes[0]?.laneId).toBe('apps');
  });

  it('keeps one backup per day and only the newest ones', async () => {
    const store = await open({ keepBackups: 2 });
    for (let day = 1; day <= 4; day++) {
      clock = new Date(clock.getTime() + DAY);
      store.apply({ type: 'note.add', note: note({ id: `n${day}` }) });
      await store.flush();
    }
    const backups = (await readdir(join(dir, 'backups'))).sort();
    expect(backups).toEqual(['board-2026-10-03.json', 'board-2026-10-04.json']);
    // Each backup holds the board as it was before that day's first change.
    const oct4 = JSON.parse(await readFile(join(dir, 'backups', 'board-2026-10-04.json'), 'utf8'));
    expect(oct4.board.notes).toHaveLength(3);
  });

  it('recovers from a damaged board.json using the newest good backup', async () => {
    const store = await open();
    store.apply({ type: 'note.add', note: note() });
    await store.flush();
    clock = new Date(clock.getTime() + DAY);
    store.apply({ type: 'note.add', note: note({ id: 'n2' }) });
    await store.flush();
    await store.close();
    stores.length = 0;
    await writeFile(join(dir, 'board.json'), '{"version": 1, "rev": ');

    const messages: string[] = [];
    const reopened = await open({ log: message => messages.push(message) });
    expect(reopened.board.notes.map(n => n.id)).toEqual(['n1']);
    expect(messages.join('\n')).toMatch(/could not be read[\s\S]*Restored the board from backups\/board-2026-10-01\.json/);
    const files = await readdir(dir);
    expect(files.some(name => name.startsWith('board.damaged-'))).toBe(true);
    expect((await savedFile()).board.notes).toHaveLength(1);
  });

  it('saves synchronously on shutdown', async () => {
    const store = await open({ saveDelayMs: 60_000 });
    store.apply({ type: 'note.add', note: note() });
    store.flushSync();
    expect((await savedFile()).board.notes).toHaveLength(1);
  });

  it('starts over from the sample board in demo mode', async () => {
    const first = await open();
    first.apply({ type: 'note.add', note: note() });
    await first.flush();
    const demo = await open({ reset: true, seed: makeSampleBoard });
    expect(demo.board.notes.some(n => n.title === 'NSF CAREER proposal')).toBe(true);
    expect(demo.board.notes.some(n => n.id === 'n1')).toBe(false);
  });
});
