import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AI_AGENT_PROMPT } from '../shared/ai.ts';
import { makeEmptyBoard } from '../shared/defaults.ts';
import type { AiTask, Board, Note } from '../shared/types.ts';
import { AiRunner, TEST_TEXT, wakeRequest, type Fetch } from './ai.ts';
import { AiConnections } from './aiConnections.ts';
import { BoardStore } from './store.ts';

// The AI helper's wake-ups, against a fake clock and a fake internet: nothing is sent anywhere.

const MIN = 60_000;
const ROUTINE_URL = 'https://routines.test/v1/claude_code/routines/trig_01ABC/fire';
const daily: AiTask = { instructions: 'Check grants.gov for new calls', schedule: 'daily', time: '08:00', mayAdd: true, mayEdit: false, since: '2026-09-01T12:00:00.000Z' };

function note(fields: Partial<Note>): Note {
  return {
    id: 'n1',
    laneId: 'todo',
    title: 'Check grants.gov',
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

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string;
}

let dir: string;
let clock: Date;
let store: BoardStore;
let connections: AiConnections;
let calls: Call[];
let answers: Array<() => Response>;
let runner: AiRunner;

const fakeFetch: Fetch = async (url, init) => {
  calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
  const answer = answers.shift();
  if (!answer) throw new TypeError('fetch failed');
  return answer();
};
const json = (body: object, status = 200, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

async function setUp(notes: Note[], settings: Partial<Board['settings']['ai']> = {}) {
  const board = makeEmptyBoard();
  board.notes = notes;
  board.settings.ai = { connect: true, dailyCap: 12, ...settings };
  store = await BoardStore.open({ dir, seed: () => board, now: () => clock });
  connections = await AiConnections.open(dir);
  runner = new AiRunner({ store, connections, mcpUrl: () => 'https://nuc.tail1234.ts.net/mcp/SECRET', fetch: fakeFetch });
}

const stateOf = (id = 'n1') => store.board.notes.find(n => n.id === id)?.aiState;
const later = (minutes: number) => {
  clock = new Date(clock.getTime() + minutes * MIN);
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sticky-ai-'));
  clock = new Date('2026-10-01T08:00:30');
  calls = [];
  answers = [];
});

afterEach(async () => {
  await store?.close();
  await connections?.flush();
  await rm(dir, { recursive: true, force: true });
});

describe('waking an AI', () => {
  it('fires the Claude routine for the stickies that are due, and waits for the report', async () => {
    await setUp([note({ ai: daily }), note({ id: 'n2', title: 'Scan NIH', ai: daily }), note({ id: 'n3', title: 'Later', ai: { ...daily, time: '17:00', since: new Date('2026-10-01T07:00:00').toISOString() } })]);
    await connections.put('c1', { kind: 'routine', name: 'Claude routine', url: ROUTINE_URL, token: 'sk-ant-oat01-secret-wxyz' }, clock);
    answers.push(json({ type: 'routine_fire', claude_code_session_id: 'session_1', claude_code_session_url: 'https://claude.ai/code/session_1' }));

    await runner.tick();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe(ROUTINE_URL);
    expect(call!.headers).toMatchObject({ Authorization: 'Bearer sk-ant-oat01-secret-wxyz', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' });
    const text = (JSON.parse(call!.body) as { text: string }).text;
    expect(text).toContain('2 tasks are due');
    expect(text).toContain('"Check grants.gov" (sticky n1)');
    expect(text).not.toContain('Later');
    expect(stateOf()).toMatchObject({ status: 'queued', by: 'Claude routine', url: 'https://claude.ai/code/session_1' });
    expect(stateOf('n3')).toBeUndefined();
    expect(connections.wakesOn(clock)).toBe(1);

    // Waiting for the report: not woken again.
    later(5);
    await runner.tick();
    expect(calls).toHaveLength(1);

    // No report within 45 minutes: given up on until Run now.
    later(41);
    await runner.tick();
    expect(stateOf()).toMatchObject({ status: 'error', message: 'No report came back from Claude routine. Tap Run now to try again.', url: 'https://claude.ai/code/session_1' });
    expect(calls).toHaveLength(1);
    later(1);
    store.apply({ type: 'note.patch', id: 'n1', patch: { ai: { ...daily, requestedAt: clock.toISOString() } } });
    answers.push(json({}));
    await runner.tick();
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]!.body).text).toContain('a task is due');
    expect(stateOf()?.status).toBe('queued');
  });

  it('keeps tokens in a file only this user can read, and never shows them', async () => {
    await setUp([]);
    await connections.put('c1', { kind: 'routine', name: 'Claude routine', url: ROUTINE_URL, token: 'sk-ant-oat01-secret-wxyz' }, clock);
    await connections.flush();
    expect((await stat(join(dir, 'ai-connections.json'))).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(connections.info())).not.toContain('secret');
    expect(connections.info()).toEqual([expect.objectContaining({ tokenEnd: 'wxyz', isDefault: true, url: ROUTINE_URL })]);
    // Changing the name keeps the token.
    await connections.put('c1', { kind: 'routine', name: 'Grants routine', url: ROUTINE_URL }, clock);
    expect(connections.get('c1')?.token).toBe('sk-ant-oat01-secret-wxyz');
    expect((await readFile(join(dir, 'ai-connections.json'), 'utf8')).includes('Grants routine')).toBe(true);
    await expect(connections.put('c2', { kind: 'openclaw', name: 'OpenClaw', url: 'http://mac.local:18789' }, clock)).rejects.toThrow('OpenClaw: paste its token');
  });

  it('uses the connection each sticky names, else the default', async () => {
    await setUp([note({ ai: daily }), note({ id: 'n2', ai: { ...daily, by: 'c2' } })]);
    await connections.put('c1', { kind: 'routine', name: 'Claude routine', url: ROUTINE_URL, token: 'tok1' }, clock);
    await connections.put('c2', { kind: 'openclaw', name: 'OpenClaw', url: 'http://mac.local:18789', token: 'hook-token' }, clock);
    answers.push(json({}), json({ ok: true }));
    await runner.tick();
    expect(calls.map(call => call.url)).toEqual([ROUTINE_URL, 'http://mac.local:18789/hooks/agent']);
    const openClaw = JSON.parse(calls[1]!.body) as { message: string; name: string };
    expect(calls[1]!.headers.Authorization).toBe('Bearer hook-token');
    expect(openClaw.name).toBe('Sticky Wall');
    expect(openClaw.message).toContain('(sticky n2)');
    expect(openClaw.message).toContain(AI_AGENT_PROMPT);
    expect(stateOf('n2')).toMatchObject({ status: 'queued', by: 'OpenClaw' });
  });

  it('signs webhooks, and passes on the board’s MCP link', async () => {
    await setUp([note({ ai: daily })]);
    await connections.put('c1', { kind: 'webhook', name: 'n8n', url: 'https://n8n.test/webhook/sticky', token: 'shh' }, clock);
    answers.push(json({}));
    await runner.tick();
    const [call] = calls;
    const body = JSON.parse(call!.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      event: 'ai.tasks_due',
      tasks: [{ id: 'n1', title: 'Check grants.gov', instructions: daily.instructions, schedule: 'Every day at 8 AM' }],
      mcpUrl: 'https://nuc.tail1234.ts.net/mcp/SECRET',
      prompt: AI_AGENT_PROMPT,
    });
    expect(call!.headers['X-Sticky-Signature']).toBe(`sha256=${createHmac('sha256', 'shh').update(call!.body).digest('hex')}`);
  });

  it('never wakes one that checks in on its own', async () => {
    await setUp([note({ ai: daily })]);
    await connections.put('c1', { kind: 'self', name: 'Hourly routine' }, clock);
    await runner.tick();
    expect(calls).toEqual([]);
    expect(stateOf()).toBeUndefined();
  });

  it('says what’s missing when no AI can do it', async () => {
    await setUp([note({ ai: daily })], { connect: false });
    await runner.tick();
    expect(stateOf()).toMatchObject({ status: 'needs-setup', message: 'The AI connection is off. Turn it on in Wall → AI helper.' });
    store.apply({ type: 'settings.patch', patch: { ai: { connect: true } } });
    await runner.tick();
    expect(stateOf()).toMatchObject({ status: 'needs-setup', message: 'No AI is connected to the board yet. Add one in Wall → AI helper.' });
    // Once one is added, it's woken straight away.
    await connections.put('c1', { kind: 'routine', name: 'Claude routine', url: ROUTINE_URL, token: 'tok' }, clock);
    answers.push(json({}));
    await runner.tick();
    expect(stateOf()?.status).toBe('queued');
  });

  it('stops on a wrong token or address until it’s fixed', async () => {
    await setUp([note({ ai: daily })]);
    await connections.put('c1', { kind: 'routine', name: 'Claude routine', url: ROUTINE_URL, token: 'old' }, clock);
    answers.push(json({ error: { type: 'authentication_error' } }, 401));
    await runner.tick();
    expect(stateOf()).toMatchObject({ status: 'needs-setup', message: expect.stringContaining('Make a new token in the routine’s API trigger') });
    expect(connections.info()[0]).toMatchObject({ problem: expect.stringContaining('didn’t accept the token'), lastWake: { ok: false } });
    later(2);
    await runner.tick();
    expect(calls).toHaveLength(1);

    // A new token: woken again.
    await connections.put('c1', { kind: 'routine', name: 'Claude routine', url: ROUTINE_URL, token: 'new' }, clock);
    answers.push(json({}));
    await runner.tick();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers.Authorization).toBe('Bearer new');
    expect(stateOf()?.status).toBe('queued');
    expect(connections.info()[0]!.problem).toBeNull();

    // A paused routine says so.
    store.apply({ type: 'ai.state', ids: ['n1'], state: null });
    store.apply({ type: 'note.patch', id: 'n1', patch: { ai: { ...daily, requestedAt: clock.toISOString() } } });
    answers.push(json({ error: { message: 'This routine is paused' } }, 409));
    later(2);
    await runner.tick();
    expect(stateOf()?.message).toBe('Claude routine: The routine is paused. Turn it back on in Claude, then send a test.');
  });

  it('waits as long as a busy AI asks, and longer each time one can’t be reached', async () => {
    await setUp([note({ ai: daily })]);
    await connections.put('c1', { kind: 'openclaw', name: 'OpenClaw', url: 'http://mac.local:18789/hooks/agent', token: 'tok' }, clock);
    answers.push(json({ error: 'rate limited' }, 429, { 'Retry-After': '600' }));
    await runner.tick();
    expect(calls[0]!.url).toBe('http://mac.local:18789/hooks/agent');
    expect(stateOf()).toBeUndefined();
    expect(connections.info()[0]!.lastWake?.message).toBe('OpenClaw is busy (too many runs). Trying again in 10 min.');
    later(9);
    await runner.tick();
    expect(calls).toHaveLength(1);

    // Then it can't be reached (no answer queued): tried again after 1, then 2 minutes.
    later(2);
    await runner.tick();
    expect(calls).toHaveLength(2);
    later(0.5);
    await runner.tick();
    expect(calls).toHaveLength(2);
    later(1);
    await runner.tick();
    expect(calls).toHaveLength(3);
    later(1.5);
    await runner.tick();
    expect(calls).toHaveLength(3);
    later(1);
    await runner.tick();
    expect(calls).toHaveLength(4);
    expect(connections.info()[0]!.lastWake?.message).toBe('Couldn’t reach OpenClaw at that address.');
    expect(stateOf()).toBeUndefined();
  });

  it('stays within the day’s limit and wakes each AI at most once a minute', async () => {
    await setUp([note({ ai: { ...daily, schedule: 'once' } })], { dailyCap: 2 });
    await connections.put('c1', { kind: 'webhook', name: 'Script', url: 'https://hook.test/' }, clock);
    for (let i = 0; i < 5; i++) answers.push(json({}));
    await runner.tick();
    expect(calls).toHaveLength(1);
    // Run now, straight away: it waits for the minute.
    const ask = () => {
      store.apply({ type: 'ai.state', ids: ['n1'], state: null });
      store.apply({ type: 'note.patch', id: 'n1', patch: { ai: { ...daily, schedule: 'once', requestedAt: clock.toISOString() } } });
    };
    later(0.5);
    ask();
    await runner.tick();
    expect(calls).toHaveLength(1);
    later(1);
    await runner.tick();
    expect(calls).toHaveLength(2);
    // The day's limit of 2 is used up: nothing until tomorrow.
    later(1);
    ask();
    await runner.tick();
    expect(calls).toHaveLength(2);
    clock = new Date('2026-10-02T00:01:00');
    await runner.tick();
    expect(calls).toHaveLength(3);
  });

  it('sends a test without touching the stickies', async () => {
    await setUp([note({ ai: daily })]);
    await connections.put('c1', { kind: 'routine', name: 'Claude routine', url: ROUTINE_URL, token: 'tok' }, clock);
    answers.push(json({ claude_code_session_url: 'https://claude.ai/code/session_9' }));
    expect(await runner.test('c1')).toEqual({ ok: true, message: 'Claude routine was woken up.', url: 'https://claude.ai/code/session_9' });
    expect(JSON.parse(calls[0]!.body)).toEqual({ text: TEST_TEXT });
    expect(stateOf()).toBeUndefined();
    expect(await runner.test('gone')).toEqual({ ok: false, message: 'That connection was removed.' });
  });
});

describe('wakeRequest', () => {
  it('names at most 20 stickies', () => {
    const notes = Array.from({ length: 25 }, (_, i) => note({ id: `n${i}`, ai: daily }));
    const request = wakeRequest({ id: 'c', kind: 'routine', name: 'R', url: ROUTINE_URL, token: 't', createdAt: '' }, notes, null, new Date());
    expect(JSON.parse(request.init.body).text).toContain('20 tasks are due');
  });
});
