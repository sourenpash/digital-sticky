import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ScreenInfo } from '../shared/api.ts';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { createApp } from './app.ts';
import { Auth, loadSecret, SCREEN_COOKIE } from './auth.ts';
import { EventHub } from './events.ts';
import { LOCAL_SCREEN_ID, Screens, SHOWING_MS } from './screens.ts';
import { BoardStore } from './store.ts';

const from = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });
const IPAD = from('192.168.1.60');
const PHONE = from('192.168.1.40');
const WALL = from('127.0.0.1');
const HOME = 'http://192.168.1.23:3000';

let dir: string;
let store: BoardStore;
let clock: Date;
let hub: EventHub;
let screens: Screens;
let app: Hono;
let events: string[];

async function makeApp(pin: string | null = null) {
  const auth = new Auth({ pin, secret: await loadSecret(dir), trustLocalhost: true, now: () => clock });
  return createApp({ store, hub, buildId: 'b', staticDir: null, connectUrl: null, auth, screens });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sticky-screens-'));
  clock = new Date('2026-10-07T20:00:00Z');
  store = await BoardStore.open({ dir, seed: makeEmptyBoard, saveDelayMs: 5, now: () => clock });
  hub = new EventHub();
  events = [];
  const broadcast = hub.broadcast.bind(hub);
  hub.broadcast = (event, data) => {
    events.push(event);
    broadcast(event, data);
  };
  screens = new Screens(store, hub);
  app = await makeApp();
});

afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

function send(method: string, path: string, env: object, body?: unknown, headers: Record<string, string> = {}, host = HOME) {
  return app.request(
    `${host}${path}`,
    { method, headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
}

function screenCookie(response: Response): string {
  const match = (response.headers.get('set-cookie') ?? '').match(new RegExp(`${SCREEN_COOKIE}=([^;]*)`));
  if (!match?.[1]) throw new Error('no wall-screen cookie');
  return `${SCREEN_COOKIE}=${match[1]}`;
}

async function list(env: object = PHONE, cookie?: string): Promise<ScreenInfo[]> {
  const host = env === WALL ? 'http://localhost:3000' : HOME;
  const response = await send('GET', '/api/screens', env, undefined, cookie ? { Cookie: cookie } : {}, host);
  expect(response.status).toBe(200);
  return ((await response.json()) as { screens: ScreenInfo[] }).screens;
}

/** Sets up the iPad as a wall screen and returns its cookie. */
async function setUpIpad(name = 'Kitchen iPad'): Promise<string> {
  const response = await send('POST', '/api/screens', IPAD, { name });
  expect(response.status).toBe(201);
  return screenCookie(response);
}

describe('wall screens', () => {
  it('sets a device up as a wall screen, and shows when it’s showing the wall', async () => {
    const response = await send('POST', '/api/screens', IPAD, { name: 'Kitchen iPad' });
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=31536000/);
    const cookie = screenCookie(response);
    expect(await response.json()).toMatchObject({ screen: { name: 'Kitchen iPad', showing: false, thisDevice: true, wallComputer: false } });
    expect(events).toContain('screens');

    const here = await send('POST', '/api/screens/here', IPAD, {}, { Cookie: cookie });
    expect(await here.json()).toMatchObject({ screen: { name: 'Kitchen iPad', showing: true } });
    const seen = await list();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: 'Kitchen iPad', showing: true, thisDevice: false, lastSeenAt: clock.toISOString() });
    expect(await (await send('GET', '/api/session', IPAD, undefined, { Cookie: cookie })).json()).toMatchObject({ wallScreen: true });

    // It stops checking in: a few minutes later it's no longer showing.
    events = [];
    clock = new Date(clock.getTime() + SHOWING_MS);
    screens.sweep();
    expect((await list())[0]).toMatchObject({ showing: false, lastSeenAt: '2026-10-07T20:00:00.000Z' });
    expect(events).toEqual(['screens']);
  });

  it('renames a screen, and keeps one entry per device', async () => {
    const cookie = await setUpIpad();
    const again = await send('POST', '/api/screens', IPAD, { name: 'Hall iPad' }, { Cookie: cookie });
    expect(again.status).toBe(201);
    expect((await list()).map(screen => screen.name)).toEqual(['Hall iPad']);
    const [screen] = await list();
    expect((await send('PATCH', `/api/screens/${screen!.id}`, PHONE, { name: '  Bedroom TV  ' })).status).toBe(200);
    expect((await list()).map(entry => entry.name)).toEqual(['Bedroom TV']);
    expect((await send('PATCH', '/api/screens/missing', PHONE, { name: 'x' })).status).toBe(404);
    expect((await send('POST', '/api/screens', IPAD, { name: ' ' })).status).toBe(400);
  });

  it('adds the wall computer by itself when it shows the wall', async () => {
    expect(await (await send('POST', '/api/screens/here', PHONE, {})).json()).toEqual({ screen: null }); // just looking at the wall
    const here = await send('POST', '/api/screens/here', WALL, {}, {}, 'http://localhost:3000');
    expect(await here.json()).toMatchObject({ screen: { id: LOCAL_SCREEN_ID, name: 'Wall computer', showing: true, thisDevice: true, wallComputer: true } });
    expect(here.headers.get('set-cookie')).toBeNull(); // it's known by being this computer
    expect((await list()).map(screen => screen.id)).toEqual([LOCAL_SCREEN_ID]);
  });

  it('lets a wall screen in without the PIN, until it’s removed', async () => {
    const cookie = await setUpIpad(); // set up while the board was open
    app = await makeApp('482915');
    expect((await send('GET', '/api/state', IPAD)).status).toBe(401);
    expect((await send('GET', '/api/state', IPAD, undefined, { Cookie: cookie })).status).toBe(200);
    expect(await (await send('GET', '/api/session', IPAD, undefined, { Cookie: cookie })).json()).toMatchObject({ signedIn: true, wallScreen: true });
    // It can show the sign-in code, like the wall computer.
    expect((await send('GET', '/api/pair-code', IPAD, undefined, { Cookie: cookie })).status).toBe(200);

    // Removed from another device (the wall computer here): its cookie stops working.
    const [screen] = await list(WALL);
    const removed = await app.request(`http://localhost:3000/api/screens/${screen!.id}`, { method: 'DELETE' }, WALL);
    expect(removed.status).toBe(200);
    expect((await send('GET', '/api/state', IPAD, undefined, { Cookie: cookie })).status).toBe(401);
    const session = await send('GET', '/api/session', IPAD, undefined, { Cookie: cookie });
    expect(await session.json()).toMatchObject({ signedIn: false, wallScreen: false });
    expect(session.headers.get('set-cookie')).toMatch(new RegExp(`${SCREEN_COOKIE}=;.*Max-Age=0`, 'i'));
  });

  it('signs a screen out of being a wall screen when it removes itself', async () => {
    const cookie = await setUpIpad();
    const [screen] = await list();
    const response = await send('DELETE', `/api/screens/${screen!.id}`, IPAD, undefined, { Cookie: cookie });
    expect(response.headers.get('set-cookie')).toMatch(new RegExp(`${SCREEN_COOKIE}=;.*Max-Age=0`, 'i'));
    expect(await list()).toEqual([]);
  });

  it('turns away forged wall-screen cookies', async () => {
    await setUpIpad();
    app = await makeApp('482915');
    const [screen] = await list(WALL);
    for (const cookie of [`${SCREEN_COOKIE}=${screen!.id}`, `${SCREEN_COOKIE}=${screen!.id}.AAAA`]) {
      expect((await send('GET', '/api/state', PHONE, undefined, { Cookie: cookie })).status).toBe(401);
    }
  });

  it('keeps the screens through a restart, apart from the board', async () => {
    await setUpIpad();
    await send('POST', '/api/screens/here', WALL, {}, {}, 'http://localhost:3000');
    await store.close();
    const saved = JSON.parse(await readFile(join(dir, 'board.json'), 'utf8')) as { screens: { name: string }[]; board: object };
    expect(saved.screens.map(screen => screen.name)).toEqual(['Kitchen iPad', 'Wall computer']);
    expect(saved.board).not.toHaveProperty('screens');
    store = await BoardStore.open({ dir, seed: makeEmptyBoard, saveDelayMs: 5, now: () => clock });
    expect(store.screens.map(screen => screen.name)).toEqual(['Kitchen iPad', 'Wall computer']);
    expect(store.rev).toBe(0); // not a board change
  });

  it('saves when a screen was last seen only now and then', async () => {
    const cookie = await setUpIpad();
    await send('POST', '/api/screens/here', IPAD, {}, { Cookie: cookie });
    const first = store.screens[0]!.lastSeenAt;
    clock = new Date(clock.getTime() + 60_000);
    await send('POST', '/api/screens/here', IPAD, {}, { Cookie: cookie });
    expect(store.screens[0]!.lastSeenAt).toBe(first);
    expect((await list())[0]!.lastSeenAt).toBe(clock.toISOString()); // the list shows the latest anyway
    clock = new Date(clock.getTime() + 10 * 60_000);
    await send('POST', '/api/screens/here', IPAD, {}, { Cookie: cookie });
    expect(store.screens[0]!.lastSeenAt).toBe(clock.toISOString());
  });
});
