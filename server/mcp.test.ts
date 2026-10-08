import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEmptyBoard } from '../shared/defaults.ts';
import type { AiTask, Board, Note } from '../shared/types.ts';
import { startServer, type RunningServer } from './server.ts';

// The board's MCP server over real HTTP on this computer, with an MCP client playing
// the AI. No AI is involved, and nothing leaves this computer.

const ai: AiTask = { instructions: 'Check grants.gov for new calls', schedule: 'daily', time: '08:00', mayAdd: true, mayEdit: true, since: '2026-09-01T12:00:00.000Z' };

function note(fields: Partial<Note>): Note {
  return {
    id: 'n1',
    laneId: 'todo',
    title: 'Check grants.gov',
    body: '',
    checklist: [{ id: 'c1', text: 'Read the call', done: false }],
    links: [],
    pinned: false,
    done: false,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...fields,
  };
}

function seed(): Board {
  const board = makeEmptyBoard();
  board.notes = [
    note({ ai }),
    note({ id: 'n2', title: 'Scan NIH', ai: { ...ai, time: '17:00', mayAdd: false, mayEdit: false, since: new Date('2026-10-01T08:30:00').toISOString() } }),
    note({ id: 'n3', laneId: 'apps', title: 'NSF CAREER', body: 'Due in July.' }),
  ];
  return board;
}

let dir: string;
let running: RunningServer;
let base: string;
let clients: Client[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sticky-mcp-'));
  clients = [];
  running = await startServer({
    port: 0,
    host: '127.0.0.1',
    dataDir: dir,
    seed,
    staticDir: null,
    connectUrl: null,
    buildId: 'b',
    tickerFetch: false,
    publicPort: 0,
    now: () => new Date('2026-10-01T09:00:00'),
    aiFetch: async () => {
      throw new Error('No wake-ups in these tests');
    },
  });
  base = `http://127.0.0.1:${running.port}`;
});

afterEach(async () => {
  await Promise.all(clients.map(client => client.close().catch(() => {})));
  await running.stop();
  await rm(dir, { recursive: true, force: true });
});

const secret = async () => (await readFile(join(dir, 'mcp-secret'), 'utf8')).trim();
const turnOn = () => running.store.apply({ type: 'settings.patch', patch: { ai: { connect: true } } });

async function connect(url: string, name = 'test-ai'): Promise<Client> {
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // A sentence, not JSON.
  }
  return { text, json: json as Record<string, unknown>, isError: result.isError === true };
}

const sticky = (id: string) => running.store.board.notes.find(n => n.id === id)!;

describe('the board’s MCP server', () => {
  it('keeps its address secret, and answers only while it’s turned on', async () => {
    const key = await secret();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await stat(join(dir, 'mcp-secret'))).mode & 0o777).toBe(0o600);
    const post = (path: string) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect((await post(`/mcp/${key}`)).status).toBe(403);
    expect(await (await post(`/mcp/${key}`)).json()).toEqual({ error: 'The board’s AI connection is turned off. Turn it on in Wall → AI helper.' });
    expect((await post('/mcp/wrong')).status).toBe(404);
    expect((await post('/mcp')).status).toBe(404);
    turnOn();
    expect((await post('/mcp/wrong')).status).toBe(404);
  });

  it('lets an AI read its tasks and report back', async () => {
    turnOn();
    const client = await connect(`${base}/mcp/${await secret()}`);
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(['get_sticky', 'list_ai_tasks', 'list_stickies', 'report_ai_run']);
    expect(client.getInstructions()).toContain('Call list_ai_tasks');

    // Due now: the 8 AM one, not the 5 PM one.
    const tasks = await call(client, 'list_ai_tasks');
    const listed = tasks.json.tasks as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      stickyId: 'n1',
      title: 'Check grants.gov',
      column: 'To-do',
      instructions: ai.instructions,
      schedule: 'Every day at 8 AM',
      due: true,
      mayAddStickies: true,
      mayEditChecklistAndSources: true,
      checklist: [{ id: 'c1', text: 'Read the call', done: false }],
      lastReport: null,
    });
    // The wall says it's being worked on.
    expect(sticky('n1').aiState).toMatchObject({ status: 'running', by: 'test-ai', message: 'test-ai is working on it.' });
    expect((await call(client, 'list_ai_tasks', { dueOnly: false })).json.tasks).toHaveLength(2);

    const report = await call(client, 'report_ai_run', {
      stickyId: 'n1',
      summary: 'One new call: NIH K99/R00, due Feb 12.',
      links: [{ url: 'https://grants.nih.gov/k99', label: 'NIH' }],
      newStickies: [{ title: 'NIH K99/R00', details: 'Due Feb 12.', due: '2027-02-12' }, { title: 'nsf career' }],
      checklist: { tick: ['Read the call'], add: [] },
    });
    expect(report.isError).toBe(false);
    expect(report.text).toBe('Saved on "Check grants.gov". Added a sticky: "NIH K99/R00". Left out: "nsf career": it’s already on the board.');
    const updated = sticky('n1');
    expect(updated.aiState).toBeUndefined();
    expect(updated.aiLog?.[0]).toMatchObject({ status: 'done', summary: 'One new call: NIH K99/R00, due Feb 12.', links: [{ url: 'https://grants.nih.gov/k99', label: 'NIH' }] });
    expect(updated.checklist[0]!.done).toBe(true);
    const found = running.store.board.notes.find(n => n.title === 'NIH K99/R00')!;
    expect(found).toMatchObject({ laneId: 'check', parentId: 'n1', addedBy: 'ai', due: '2027-02-12' });

    // Done for today.
    expect((await call(client, 'list_ai_tasks')).json).toMatchObject({ tasks: [], next: 'Nothing is due. You can stop here.' });
  });

  it('only changes what the sticky allows', async () => {
    turnOn();
    const client = await connect(`${base}/mcp/${await secret()}`);
    const report = await call(client, 'report_ai_run', { stickyId: 'n2', summary: 'Found one.', newStickies: [{ title: 'New thing' }] });
    expect(report.text).toContain('Left out: the new stickies: this sticky’s settings don’t let the AI add stickies.');
    expect(running.store.board.notes.some(n => n.title === 'New thing')).toBe(false);
    const wrong = await call(client, 'report_ai_run', { stickyId: 'n3', summary: 'x' });
    expect(wrong).toMatchObject({ isError: true, text: 'That sticky isn’t handed to the AI helper, so there’s nothing to report on.' });
    expect((await call(client, 'get_sticky', { stickyId: 'nope' })).isError).toBe(true);
  });

  it('lets an AI look around the board', async () => {
    turnOn();
    const client = await connect(`${base}/mcp/${await secret()}`);
    expect((await call(client, 'get_sticky', { stickyId: 'n3' })).json).toMatchObject({ stickyId: 'n3', title: 'NSF CAREER', column: 'Applications', notes: 'Due in July.' });
    expect((await call(client, 'list_stickies', { column: 'applications' })).json).toEqual({ stickies: [{ stickyId: 'n3', title: 'NSF CAREER', column: 'Applications', done: false }] });
    expect((await call(client, 'list_stickies', { query: 'NIH' })).json).toEqual({ stickies: [{ stickyId: 'n2', title: 'Scan NIH', column: 'To-do', done: false }] });
    expect((await call(client, 'list_stickies', { column: 'Ideas' })).text).toBe('There’s no column called "Ideas". The columns are: Applications, Double-check, To-do, Recurring, Reminders.');
  });

  it('answers older (2025) MCP clients too', async () => {
    turnOn();
    const url = `${base}/mcp/${await secret()}`;
    const rpc = async (body: object) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', ...body }),
      });
      const raw = await response.text();
      const data = raw.startsWith('{') ? raw : (raw.split('\n').find(line => line.startsWith('data: ')) ?? '').slice(6);
      return JSON.parse(data) as { result: Record<string, unknown> };
    };
    const init = await rpc({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.0.0' } } });
    expect(init.result).toMatchObject({ serverInfo: { name: 'sticky-wall' } });
    const tools = await rpc({ id: 2, method: 'tools/list', params: {} });
    expect((tools.result.tools as unknown[]).length).toBe(4);
  });

  it('works through the internet door with only its secret, and stops working with a new link', async () => {
    turnOn();
    const old = await secret();
    const outside = `http://127.0.0.1:${running.publicPort}/mcp/${old}`;
    const client = await connect(outside, 'claude-ai');
    expect((await call(client, 'list_stickies')).json.stickies).toHaveLength(3);
    // "Claude" used it (the name the client gives, made readable).
    const overview = (await (await fetch(`${base}/api/ai`)).json()) as { lastUsed: { client: string } };
    expect(overview.lastUsed.client).toBe('Claude');

    // From the internet, the rest of the board still needs signing in.
    expect((await fetch(`http://127.0.0.1:${running.publicPort}/api/ai`)).status).toBe(401);

    const rotated = await fetch(`${base}/api/ai/mcp/rotate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(rotated.status).toBe(200);
    const fresh = await secret();
    expect(fresh).not.toBe(old);
    await expect(connect(outside)).rejects.toThrow();
    expect((await call(await connect(`${base}/mcp/${fresh}`), 'list_stickies')).isError).toBe(false);
  });

  it('slows down guessing, without locking out the right link', async () => {
    turnOn();
    const guess = () => fetch(`${base}/mcp/guess`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    for (let i = 0; i < 20; i++) expect((await guess()).status).toBe(404);
    expect((await guess()).status).toBe(429);
    expect((await call(await connect(`${base}/mcp/${await secret()}`), 'list_stickies')).isError).toBe(false);
  });

  it('saves AI connections without ever sending their tokens back', async () => {
    const send = (method: string, path: string, body: object = {}) =>
      fetch(`${base}/api/ai${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const saved = await send('PUT', '/connections/c1', { kind: 'routine', name: 'Claude routine', url: 'https://routines.test/fire', token: 'sk-ant-oat01-abcdefgh' });
    expect(saved.status).toBe(200);
    const raw = await saved.text();
    expect(raw).not.toContain('sk-ant');
    expect(JSON.parse(raw).connections).toEqual([
      { id: 'c1', kind: 'routine', name: 'Claude routine', url: 'https://routines.test/fire', tokenEnd: 'efgh', isDefault: true, problem: null, lastWake: null },
    ]);
    expect(await (await send('PUT', '/connections/c2', { kind: 'routine', name: 'Other' })).json()).toEqual({ error: 'Claude routine: paste its address' });
    expect((await send('PUT', '/connections/c2', { kind: 'carrier-pigeon', name: 'Other' })).status).toBe(400);

    // Send a test (here it can't reach anything: these tests never wake a real AI).
    expect(await (await send('POST', '/connections/c1/test')).json()).toEqual({ ok: false, message: 'Couldn’t reach Claude routine at that address.' });
    const after = (await (await fetch(`${base}/api/ai`)).json()) as { connections: Array<{ lastWake: { ok: boolean } }> };
    expect(after.connections[0]!.lastWake).toMatchObject({ ok: false });
    expect((await (await send('DELETE', '/connections/c1')).json()).connections).toEqual([]);
  });
});
