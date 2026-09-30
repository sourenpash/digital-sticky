import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEmptyBoard } from '../shared/defaults.ts';
import type { Board, Note } from '../shared/types.ts';
import { createApp } from './app.ts';
import { EventHub } from './events.ts';
import { BoardStore } from './store.ts';

let dir: string;
let store: BoardStore;
let app: Hono;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sticky-api-'));
  store = await BoardStore.open({ dir, seed: makeEmptyBoard, saveDelayMs: 5 });
  app = createApp({ store, hub: new EventHub(), buildId: 'test-build', staticDir: null, connectUrl: 'http://192.168.1.23:3000' });
});

afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

function send(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function state(): Promise<{ epoch: string; rev: number; board: Board; connectUrl: string }> {
  return (await app.request('/api/state')).json();
}

async function addNote(fields: Record<string, unknown> = {}): Promise<Note> {
  const response = await send('POST', '/api/notes', { laneId: 'todo', title: 'Buy stamps', ...fields });
  expect(response.status).toBe(201);
  return ((await response.json()) as { note: Note }).note;
}

describe('API', () => {
  it('serves the board with its revision and the phone address', async () => {
    const body = await state();
    expect(body.rev).toBe(0);
    expect(body.epoch).toBe(store.epoch);
    expect(body.board.lanes.map(l => l.title)).toEqual(['Applications', 'Double-check', 'To-do', 'Recurring', 'Reminders']);
    expect(body.connectUrl).toBe('http://192.168.1.23:3000');
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true, rev: 0, buildId: 'test-build' });
  });

  it('adds a note from just a column and a title', async () => {
    const note = await addNote();
    expect(note).toMatchObject({ laneId: 'todo', title: 'Buy stamps', body: '', checklist: [], pinned: false, done: false });
    expect(note.id).toMatch(/^[\w-]+$/);
    expect((await state()).board.notes).toHaveLength(1);
  });

  it('answers every change with the revision that includes it', async () => {
    const response = await send('POST', '/api/notes', { laneId: 'todo', title: 'x' });
    expect(await response.json()).toMatchObject({ epoch: store.epoch, rev: 1 });
  });

  it('only takes changes sent as JSON', async () => {
    const response = await app.request('/api/notes', { method: 'POST', body: '{"laneId":"todo","title":"x"}' });
    expect(response.status).toBe(415);
    const garbled = await app.request('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    expect(garbled.status).toBe(400);
    expect(await garbled.json()).toEqual({ error: 'The request body is not valid JSON' });
  });

  it('explains what is wrong with a bad note', async () => {
    const response = await send('POST', '/api/notes', {
      laneId: 'todo',
      title: 'x',
      links: [{ id: 'l1', url: 'javascript:alert(1)', verified: false }],
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'links.0.url: Links must be http:// or https:// web addresses' });
    const noLane = await send('POST', '/api/notes', { laneId: 'nope', title: 'x' });
    expect(await noLane.json()).toEqual({ error: 'That column does not exist' });
  });

  it('edits a note and clears fields sent as null', async () => {
    const { id } = await addNote({ funder: 'NSF', due: '2026-10-03' });
    const response = await send('PATCH', `/api/notes/${id}`, { title: 'Buy more stamps', funder: null });
    expect(response.status).toBe(200);
    const note = (await state()).board.notes[0];
    expect(note?.title).toBe('Buy more stamps');
    expect(note?.funder).toBeUndefined();
    expect(note?.due).toBe('2026-10-03');
    expect((await send('PATCH', '/api/notes/missing', { title: 'x' })).status).toBe(404);
  });

  it('deletes a note to the trash and restores it', async () => {
    const { id } = await addNote();
    expect((await send('DELETE', `/api/notes/${id}`)).status).toBe(200);
    expect((await state()).board.notes).toHaveLength(0);
    expect((await send('POST', `/api/notes/${id}/restore`, {})).status).toBe(200);
    expect((await state()).board.notes).toHaveLength(1);
    expect((await send('POST', '/api/notes/never/restore', {})).status).toBe(404);
  });

  it('logs and takes back recurring "Did it" times', async () => {
    const { id } = await addNote({ laneId: 'routine', repeat: { every: 'week', times: 3 }, completions: [] });
    const at = new Date().toISOString();
    await send('POST', `/api/notes/${id}/completions`, { add: [at] });
    expect((await state()).board.notes[0]?.completions).toEqual([at]);
    await send('POST', `/api/notes/${id}/completions`, { remove: [at] });
    expect((await state()).board.notes[0]?.completions).toEqual([]);
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    expect((await send('POST', `/api/notes/${id}/completions`, { add: [future] })).status).toBe(400);
  });

  it('adds, renames, reorders, deletes and restores columns', async () => {
    const added = await send('POST', '/api/lanes', { title: 'Health', kind: 'routine' });
    expect(added.status).toBe(201);
    const { lane } = (await added.json()) as { lane: { id: string; order: number; color: string } };
    expect(lane).toMatchObject({ order: 5, color: 'white' });

    await send('PATCH', `/api/lanes/${lane.id}`, { title: 'Health & habits', color: 'green' });
    await send('PUT', '/api/lanes/order', { ids: [lane.id, 'apps'] });
    const lanes = [...(await state()).board.lanes].sort((a, b) => a.order - b.order);
    expect(lanes[0]).toMatchObject({ id: lane.id, title: 'Health & habits', color: 'green' });

    await addNote({ laneId: lane.id });
    await send('DELETE', `/api/lanes/${lane.id}`);
    let board = (await state()).board;
    expect(board.lanes.some(l => l.id === lane.id)).toBe(false);
    expect(board.notes).toHaveLength(0);
    await send('POST', `/api/lanes/${lane.id}/restore`, {});
    board = (await state()).board;
    expect(board.lanes.some(l => l.id === lane.id)).toBe(true);
    expect(board.notes).toHaveLength(1);
  });

  it('adds, edits, deletes and restores goals', async () => {
    const added = await send('POST', '/api/goals', { title: 'Submit 5 applications', measure: 'submitted', target: 5, by: '2026-12-31' });
    expect(added.status).toBe(201);
    const { goal } = (await added.json()) as { goal: { id: string; count: number } };
    expect(goal.count).toBe(0);
    await send('PATCH', `/api/goals/${goal.id}`, { target: 6, by: null });
    expect((await state()).board.goals[0]).toMatchObject({ target: 6 });
    expect((await state()).board.goals[0]?.by).toBeUndefined();
    await send('DELETE', `/api/goals/${goal.id}`);
    expect((await state()).board.goals).toHaveLength(0);
    await send('POST', `/api/goals/${goal.id}/restore`, {});
    expect((await state()).board.goals).toHaveLength(1);
  });

  it('merges wall settings', async () => {
    const response = await send('PATCH', '/api/settings', { night: { mode: 'on', start: '21:30' } });
    expect(response.status).toBe(200);
    expect((await state()).board.settings.night).toEqual({ mode: 'on', start: '21:30', end: '07:00', style: 'dim' });
    expect((await send('PATCH', '/api/settings', { night: { start: '9pm' } })).status).toBe(400);
  });

  it('pops a reminder up on the wall and dismisses it', async () => {
    const { id } = await addNote({ laneId: 'remind', remindAt: '2026-10-01T14:00:00.000Z' });
    const fired = await send('POST', '/api/alerts', { noteId: id });
    expect(fired.status).toBe(201);
    const alert = (await state()).board.alerts[0];
    expect(alert).toMatchObject({ noteId: id, title: 'Buy stamps' });
    expect((await send('DELETE', `/api/alerts/${alert?.id}`)).status).toBe(200);
    expect((await send('DELETE', `/api/alerts/${alert?.id}`)).status).toBe(404);
  });

  it('downloads a full backup, trash included', async () => {
    const { id } = await addNote();
    await send('DELETE', `/api/notes/${id}`);
    const response = await app.request('/api/export');
    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; filename="digital-sticky-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = (await response.json()) as { version: number; trash: { notes: unknown[] } };
    expect(body.version).toBe(1);
    expect(body.trash.notes).toHaveLength(1);
  });

  it('refuses huge requests and unknown paths', async () => {
    const response = await send('POST', '/api/notes', { laneId: 'todo', title: 'x', body: 'y'.repeat(600_000) });
    expect(response.status).toBe(413);
    const missing = await app.request('/api/nope');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Not found' });
  });
});
