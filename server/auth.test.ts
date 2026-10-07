import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { createApp } from './app.ts';
import { Auth, LoginLimiter, loadSecret, PairingCodes, SESSION_COOKIE } from './auth.ts';
import { EventHub } from './events.ts';
import { hostAllowed } from './hosts.ts';
import { BoardStore } from './store.ts';

const PIN = '482915';
const DAY_S = 24 * 60 * 60;

let dir: string;
let store: BoardStore;
let clock: Date;
let app: Hono;

/** What the server sees of the connection (the Node adapter passes the socket as env). */
const from = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });
const PHONE = from('192.168.1.40');
const WALL = from('127.0.0.1');
/** Through the internet door: Tailscale Funnel connects from this computer, passing the visitor on. */
const OUTSIDE = { ...from('127.0.0.1'), outside: true };
const PUBLIC = 'https://nuc.tail1234.ts.net';

async function makeApp(options: { pin?: string | null; trustLocalhost?: boolean; allowedHosts?: string[]; anywhereUrl?: string | null } = {}) {
  const pin = options.pin === undefined ? PIN : options.pin;
  const auth = new Auth({ pin, secret: await loadSecret(dir), trustLocalhost: options.trustLocalhost ?? true, now: () => clock });
  const anywhereUrl = options.anywhereUrl === undefined ? PUBLIC : options.anywhereUrl;
  return createApp({ store, hub: new EventHub(), buildId: 'b', staticDir: null, connectUrl: null, auth, allowedHosts: options.allowedHosts, anywhereUrl });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sticky-auth-'));
  clock = new Date('2026-09-30T19:42:00Z');
  store = await BoardStore.open({ dir, seed: makeEmptyBoard, saveDelayMs: 5, now: () => clock });
  app = await makeApp();
});

afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

function login(pin: string, env: object = PHONE, headers: Record<string, string> = {}) {
  return app.request('http://192.168.1.23:3000/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ pin }) }, env);
}

/** The session cookie from a response, as a browser would send it back. */
function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  const match = header.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  if (!match) throw new Error(`no session cookie in: ${header}`);
  return `${SESSION_COOKIE}=${match[1]}`;
}

const get = (path: string, env: object = PHONE, headers: Record<string, string> = {}, host = 'http://192.168.1.23:3000') =>
  app.request(`${host}${path}`, { headers }, env);

describe('with a PIN', () => {
  it('asks devices for the PIN, without making the browser pop up its own login box', async () => {
    const response = await get('/api/state');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBeNull();
    expect(await response.json()).toEqual({ error: 'Enter the PIN to open the board', locked: true });
    expect((await get('/api/events')).status).toBe(401);
    expect((await app.request('http://192.168.1.23:3000/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, PHONE)).status).toBe(401);
  });

  it('keeps checking in, signing in and out open', async () => {
    expect((await get('/api/health')).status).toBe(200);
    expect(await (await get('/api/session')).json()).toEqual({ pinSet: true, signedIn: false, wallComputer: false, wallScreen: false, outside: false });
  });

  it('signs a device in with the right PIN and remembers it with a cookie', async () => {
    const response = await login(PIN);
    expect(response.status).toBe(200);
    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Max-Age=31536000/);
    expect(header).not.toMatch(/Secure/i); // plain http at home: a Secure cookie would never come back
    const cookie = cookieFrom(response);
    expect((await get('/api/state', PHONE, { Cookie: cookie })).status).toBe(200);
    expect(await (await get('/api/session', PHONE, { Cookie: cookie })).json()).toEqual({ pinSet: true, signedIn: true, wallComputer: false, wallScreen: false, outside: false });
  });

  it('turns away a wrong PIN, and forged or damaged cookies', async () => {
    const wrong = await login('000000');
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('set-cookie')).toBeNull();
    for (const cookie of [`${SESSION_COOKIE}=1790000000`, `${SESSION_COOKIE}=1790000000.AAAA`, `${SESSION_COOKIE}=%%%`, 'other=1']) {
      expect((await get('/api/state', PHONE, { Cookie: cookie })).status).toBe(401);
    }
  });

  it('lets the wall computer in without the PIN, but only when it really is local', async () => {
    const local = 'http://localhost:3000';
    expect((await get('/api/state', WALL, {}, local)).status).toBe(200);
    expect((await get('/api/state', from('::1'), {}, 'http://[::1]:3000')).status).toBe(200);
    expect(await (await get('/api/session', WALL, {}, local)).json()).toMatchObject({ signedIn: true, wallComputer: true });
    // Passed on by a proxy on this computer (tailscale serve, the dev server): someone else.
    expect((await get('/api/state', WALL, { 'X-Forwarded-For': '100.64.0.7' }, local)).status).toBe(401);
    // Another site's name pointed at this computer (DNS rebinding) is not the wall.
    expect((await get('/api/state', WALL, {}, 'http://nuc.local:3000')).status).toBe(401);
    // A device on the network, and a request with no connection info at all.
    expect((await get('/api/state', PHONE, {}, local)).status).toBe(401);
    expect((await app.request('http://localhost/api/state')).status).toBe(401);
  });

  it('can be told not to trust the wall computer either', async () => {
    app = await makeApp({ trustLocalhost: false });
    expect((await get('/api/state', WALL, {}, 'http://localhost:3000')).status).toBe(401);
  });

  it('slows down guessing: 5 wrong PINs per device, then a wait', async () => {
    for (let i = 0; i < 5; i++) expect((await login('111111')).status).toBe(401);
    const blocked = await login(PIN);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(800);
    // Another device isn't blocked by this one.
    expect((await login(PIN, from('192.168.1.41'))).status).toBe(200);
    clock = new Date(clock.getTime() + 16 * 60_000);
    expect((await login(PIN)).status).toBe(200);
  }, 20_000);

  it('doesn’t let a burst of guesses sent at once past the limit', async () => {
    const answers = await Promise.all(Array.from({ length: 12 }, () => login('222222')));
    const statuses = answers.map(response => response.status);
    expect(statuses.filter(status => status === 401)).toHaveLength(5);
    expect(statuses.filter(status => status === 429)).toHaveLength(7);
  });

  it('counts devices behind a proxy on this computer separately', async () => {
    for (let i = 0; i < 5; i++) expect((await login('111111', WALL, { 'X-Forwarded-For': 'evil, 100.64.0.7' })).status).toBe(401);
    expect((await login(PIN, WALL, { 'X-Forwarded-For': '100.64.0.7' })).status).toBe(429);
    expect((await login(PIN, WALL, { 'X-Forwarded-For': '100.64.0.8' })).status).toBe(200);
  }, 20_000);

  it('believes https only from a proxy on this computer', async () => {
    const viaTailscale = await login(PIN, WALL, { 'X-Forwarded-For': '100.64.0.7', 'X-Forwarded-Proto': 'https' });
    expect(viaTailscale.headers.get('set-cookie')).toMatch(/Secure/i);
    const spoofed = await login(PIN, PHONE, { 'X-Forwarded-Proto': 'https' });
    expect(spoofed.headers.get('set-cookie')).not.toMatch(/Secure/i);
  });

  it('keeps a used device signed in, and lets an unused one lapse after a year', async () => {
    const cookie = cookieFrom(await login(PIN));
    clock = new Date(clock.getTime() + 40 * DAY_S * 1000);
    const renewed = await get('/api/state', PHONE, { Cookie: cookie });
    expect(renewed.status).toBe(200);
    const fresh = cookieFrom(renewed);
    clock = new Date(clock.getTime() + 340 * DAY_S * 1000);
    expect((await get('/api/state', PHONE, { Cookie: cookie })).status).toBe(401);
    expect((await get('/api/state', PHONE, { Cookie: fresh })).status).toBe(200);
  });

  it('signs everyone out when the PIN changes, and one device out on request', async () => {
    const cookie = cookieFrom(await login(PIN));
    const logout = await app.request('http://192.168.1.23:3000/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' }, PHONE);
    expect(logout.headers.get('set-cookie')).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`, 'i'));
    app = await makeApp({ pin: '7777777' });
    expect((await get('/api/state', PHONE, { Cookie: cookie })).status).toBe(401);
  });

  it('keeps the signing secret private in the data folder', async () => {
    const path = join(dir, 'session-secret');
    expect((await readFile(path, 'utf8')).trim()).toMatch(/^[0-9a-f]{64}$/);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await loadSecret(dir)).toString('hex')).toBe((await readFile(path, 'utf8')).trim());
  });
});

describe('without a PIN', () => {
  it('is open, and says so', async () => {
    app = createApp({ store, hub: new EventHub(), buildId: 'b', staticDir: null, connectUrl: null });
    expect((await get('/api/state')).status).toBe(200);
    expect(await (await get('/api/session')).json()).toEqual({ pinSet: false, signedIn: true, wallComputer: false, wallScreen: false, outside: false });
    expect(await (await login('123456')).json()).toEqual({ ok: true });
  });

  it('still tells the wall computer apart from phones (so only phones are asked to hide the code)', async () => {
    const local = 'http://localhost:3000';
    app = createApp({ store, hub: new EventHub(), buildId: 'b', staticDir: null, connectUrl: null });
    expect(await (await get('/api/session', WALL, {}, local)).json()).toMatchObject({ wallComputer: true });
    expect(await (await get('/api/session', WALL, { 'X-Forwarded-For': '100.64.0.7' }, local)).json()).toMatchObject({ wallComputer: false });
    expect(await (await get('/api/session', PHONE)).json()).toMatchObject({ wallComputer: false });
    app = createApp({ store, hub: new EventHub(), buildId: 'b', staticDir: null, connectUrl: null, trustLocalhost: false });
    expect(await (await get('/api/session', WALL, {}, local)).json()).toMatchObject({ wallComputer: false });
  });

  it('still refuses names that aren’t this computer’s or the home network’s', async () => {
    app = createApp({ store, hub: new EventHub(), buildId: 'b', staticDir: null, connectUrl: null, allowedHosts: ['board.example.com'] });
    const rebound = await app.request('http://evil.test/api/state');
    expect(rebound.status).toBe(421);
    expect(await rebound.text()).toMatch(/ALLOWED_HOSTS/);
    expect((await app.request('http://board.example.com/api/state')).status).toBe(200);
    expect((await app.request('http://192.168.1.23:3000/api/state')).status).toBe(200);
  });
});

describe('from the internet', () => {
  const outside = (path: string, headers: Record<string, string> = {}, host = PUBLIC) => app.request(`${host}${path}`, { headers }, OUTSIDE);
  const postOutside = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(`${PUBLIC}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }, OUTSIDE);
  /** The code the wall shows in its QR code. */
  const wallCode = async () => ((await (await get('/api/pair-code', WALL, {}, 'http://localhost:3000')).json()) as { code: string }).code;

  it('always asks to sign in, even when the board has no PIN', async () => {
    app = await makeApp({ pin: null });
    expect((await get('/api/state')).status).toBe(200); // at home it's open
    const response = await outside('/api/state');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Scan the code on your wall to sign in', locked: true });
    expect((await outside('/api/events')).status).toBe(401);
    expect(await (await outside('/api/session')).json()).toEqual({ pinSet: false, signedIn: false, wallComputer: false, wallScreen: false, outside: true });
  });

  it('never counts as the wall computer, whatever the request says about itself', async () => {
    app = await makeApp({ pin: null });
    // From this computer, to "localhost", with no forwarding headers: still from outside.
    expect((await outside('/api/state', {}, 'http://localhost:3000')).status).toBe(401);
    expect(await (await outside('/api/session', {}, 'http://localhost:3000')).json()).toMatchObject({ wallComputer: false, outside: true });
    const cookie = cookieFrom(await postOutside('/api/pair', { code: await wallCode() }));
    // Signed in, but still not the wall computer: no closing the wall screen, no sign-in codes from the wall.
    const close = await app.request('http://localhost:3000/api/wall/close', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' }, OUTSIDE);
    expect(close.status).toBe(403);
    expect((await outside('/api/pair-code', { Cookie: cookie }, 'http://localhost:3000')).status).toBe(403);
  });

  it('signs a device in with the code from the wall, once', async () => {
    app = await makeApp({ pin: null });
    const code = await wallCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    const response = await postOutside('/api/pair', { code });
    expect(response.status).toBe(200);
    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/Secure/i); // the internet address is https
    expect(header).toMatch(/HttpOnly/i);
    const cookie = cookieFrom(response);
    expect((await outside('/api/state', { Cookie: cookie })).status).toBe(200);
    expect(await (await outside('/api/session', { Cookie: cookie })).json()).toMatchObject({ signedIn: true, outside: true });
    // The code is used up, and the wall shows a new one.
    const again = await postOutside('/api/pair', { code });
    expect(again.status).toBe(401);
    expect(await again.json()).toMatchObject({ expired: true });
    expect(await wallCode()).not.toBe(code);
  });

  it('takes codes typed by hand, in any case and with or without the dash', async () => {
    app = await makeApp({ pin: null });
    const code = await wallCode();
    const typed = `${code.slice(0, 4).toLowerCase()} - ${code.slice(4)}`.replace(/0/g, 'o').replace(/1/g, 'l');
    expect((await postOutside('/api/pair', { code: typed })).status).toBe(200);
  });

  it('shows no code on a board that’s only used at home without a PIN', async () => {
    app = await makeApp({ pin: null, anywhereUrl: null });
    expect(await (await get('/api/pair-code', WALL, {}, 'http://localhost:3000')).json()).toEqual({ code: null });
    app = await makeApp({ anywhereUrl: null }); // with a PIN, phones at home can scan instead of typing it
    expect(await (await get('/api/pair-code', WALL, {}, 'http://localhost:3000')).json()).toMatchObject({ code: expect.any(String) });
  });

  it('turns away old codes, and codes for anyone but the wall', async () => {
    app = await makeApp({ pin: null });
    const code = await wallCode();
    clock = new Date(clock.getTime() + PairingCodes.REFRESH_MS);
    const fresh = await wallCode();
    expect(fresh).not.toBe(code); // a new one every couple of minutes; the old one still works for a while
    clock = new Date(clock.getTime() + PairingCodes.LIFE_MS - PairingCodes.REFRESH_MS);
    expect((await postOutside('/api/pair', { code })).status).toBe(401);
    expect((await postOutside('/api/pair', { code: fresh })).status).toBe(200);
    // Phones at home can't read the wall's code (they could pass it to anyone).
    expect((await get('/api/pair-code', PHONE)).status).toBe(403);
    expect((await postOutside('/api/pair', { code: 'x'.repeat(65) })).status).toBe(400);
  });

  it('lets a signed-in device make a code to connect another one', async () => {
    app = await makeApp({ pin: null });
    const cookie = cookieFrom(await postOutside('/api/pair', { code: await wallCode() }));
    expect((await postOutside('/api/pair-code', {})).status).toBe(401);
    const made = await postOutside('/api/pair-code', {}, { Cookie: cookie });
    expect(made.status).toBe(201);
    const { code, expiresAt } = (await made.json()) as { code: string; expiresAt: number };
    expect(expiresAt).toBe(clock.getTime() + PairingCodes.LIFE_MS);
    expect((await postOutside('/api/pair', { code })).status).toBe(200);
  });

  it('takes the PIN too, when there is one, and limits wrong ones harder', async () => {
    const response = await postOutside('/api/login', { pin: PIN });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(/Secure/i);
    for (let i = 0; i < 5; i++) expect((await postOutside('/api/login', { pin: '111111' }, { 'X-Forwarded-For': '203.0.113.9' })).status).toBe(401);
    const blocked = await postOutside('/api/login', { pin: PIN }, { 'X-Forwarded-For': '203.0.113.9' });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(50 * 60); // an hour, not 15 minutes
    // Wrong PINs from the internet don't lock out the home Wi-Fi.
    expect((await login(PIN)).status).toBe(200);
  }, 20_000);

  it('can’t sign in with a PIN on a board that has none', async () => {
    app = await makeApp({ pin: null });
    const response = await postOutside('/api/login', { pin: '123456' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'This board has no PIN. Scan the code on your wall to sign in.' });
  });
});

describe('PairingCodes', () => {
  it('keeps at most 20 codes, dropping the oldest', () => {
    const codes = new PairingCodes();
    const first = codes.issue(0).code;
    for (let i = 1; i <= 20; i++) codes.issue(i);
    expect(codes.redeem(first, 30)).toBe(false);
  });
});

describe('hostAllowed', () => {
  it('answers to addresses, localhost, home-network names and the listed extras', () => {
    for (const host of ['192.168.1.23', '[::1]', 'localhost', 'nuc', 'nuc.local', 'nuc.lan', 'nuc.home.arpa', 'wall.tail1234.ts.net', 'NUC.LOCAL.']) {
      expect(hostAllowed(host), host).toBe(true);
    }
    for (const host of ['evil.test', 'nuc.local.evil.test', 'localhost.evil.test', '']) expect(hostAllowed(host), host).toBe(false);
    expect(hostAllowed('board.example.com', ['board.example.com'])).toBe(true);
  });
});

describe('LoginLimiter', () => {
  it('also caps wrong PINs across all devices', () => {
    const limiter = new LoginLimiter(5, 30, 15 * 60_000);
    for (let i = 0; i < 30; i++) limiter.tried(`device-${i}`, 1000 + i);
    expect(limiter.waitFor('someone-new', 2000)).toBeGreaterThan(0);
    expect(limiter.waitFor('someone-new', 1000 + 15 * 60_000 + 30)).toBe(0);
  });
});
