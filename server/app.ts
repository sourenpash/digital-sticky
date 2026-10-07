import { randomBytes } from 'node:crypto';
import { serveStatic } from '@hono/node-server/serve-static';
import { format } from 'date-fns';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { secureHeaders } from 'hono/secure-headers';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { AnywhereStatus, PairCode, ScreenInfo, SessionResponse, StateResponse, WallCode } from '../shared/api.ts';
import {
  completionsChangeSchema,
  describeIssues,
  goalPatchSchema,
  laneOrderSchema,
  lanePatchSchema,
  newAlertSchema,
  newGoalSchema,
  newLaneSchema,
  newNoteSchema,
  notePatchSchema,
  remoteRequestSchema,
  screenNameSchema,
  settingsPatchSchema,
} from '../shared/schema.ts';
import type { RemoteStatus } from '../shared/remote.ts';
import type { Goal, Lane, Note } from '../shared/types.ts';
import { Auth, fromThisComputer, isOutside, type LoginLimiter } from './auth.ts';
import type { EventHub } from './events.ts';
import { hostAllowed } from './hosts.ts';
import { RemoteError, type KioskRemote } from './remote.ts';
import { LOCAL_SCREEN_ID, LOCAL_SCREEN_NAME, Screens } from './screens.ts';
import type { TickerFeed } from './ticker.ts';
import { newId, StoreError, type BoardStore } from './store.ts';

export interface AppOptions {
  store: BoardStore;
  hub: EventHub;
  /** Changes with every build; open screens reload when it does. */
  buildId: string;
  /** The built web app (dist/web), or null to serve only the API. */
  staticDir: string | null;
  /** Address phones can open, shown on the wall's "Connect your phone" card. */
  connectUrl: string | null | (() => string | null);
  /** Signing in (the PIN, cookies, sign-in codes). Without one the board is open at home. */
  auth?: Auth | null;
  /** Count the browser on this computer (localhost) as the wall computer (default true). */
  trustLocalhost?: boolean;
  /** The board's internet address (Tailscale Funnel), when it can be used from anywhere. */
  anywhereUrl?: string | null;
  /** The devices showing the wall (made here when not passed). */
  screens?: Screens | null;
  /** Names to answer to besides this computer's own and home-network ones. */
  allowedHosts?: readonly string[];
  /** Live prices and headlines for the wall's ticker. */
  ticker?: TickerFeed | null;
  /** The phone remote, which drives the wall computer's browser; null when it's off. */
  remote?: Pick<KioskRemote, 'status' | 'run'> | null;
  /** Closes the wall screen on the wall computer, so its desktop shows; null where there's none. */
  closeWall?: (() => Promise<void>) | null;
}

/** Open without signing in: checking the server is up, and signing in and out. */
const OPEN_PATHS = new Set(['/api/health', '/api/session', '/api/login', '/api/logout', '/api/pair']);
const loginSchema = z.object({ pin: z.string().max(64) });
const pairSchema = z.object({ code: z.string().min(1).max(64) });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Every change answers with the revision that includes it (and the server run it belongs to). */
function changed(c: Context, store: BoardStore, rev: number, extra: Record<string, unknown> = {}, status: 200 | 201 = 200) {
  return c.json({ epoch: store.epoch, rev, ...extra }, status);
}

async function readBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new StoreError(400, 'The request body is not valid JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new StoreError(400, describeIssues(result.error));
  return result.data;
}

function isJson(contentType: string | undefined): boolean {
  return /^application\/json\b/i.test(contentType ?? '');
}

export function createApp({
  store,
  hub,
  buildId,
  staticDir,
  connectUrl,
  auth: givenAuth = null,
  trustLocalhost = true,
  anywhereUrl = null,
  screens: givenScreens = null,
  allowedHosts = [],
  ticker = null,
  remote = null,
  closeWall = null,
}: AppOptions): Hono {
  const app = new Hono();
  const stamp = () => store.now().toISOString();
  const auth = givenAuth ?? new Auth({ pin: null, secret: randomBytes(32), trustLocalhost });
  const screens = givenScreens ?? new Screens(store, hub);
  /** The wall screen this device was set up as, if it still is one. */
  const screenFor = async (c: Context) => {
    const id = await auth.screenId(c);
    return id ? (store.screens.find(screen => screen.id === id) ?? null) : null;
  };

  app.use(async (c, next) => {
    const host = new URL(c.req.url).hostname;
    if (!hostAllowed(host, allowedHosts)) {
      return c.text(`This board doesn't answer to "${host}". To use that name, add it to ALLOWED_HOSTS in the .env file on the wall computer.`, 421);
    }
    await next();
  });
  app.use(secureHeaders({ referrerPolicy: 'no-referrer' }));
  app.use(compress());

  app.onError((error, c) => {
    if (error instanceof StoreError) return c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: 'Something went wrong on the board server' }, 500);
  });

  const api = new Hono();
  api.use(bodyLimit({ maxSize: 512 * 1024, onError: c => c.json({ error: 'That change is too big' }, 413) }));
  // Changes must be sent as JSON. A web page on another site can't send JSON here
  // without the browser asking first, and this server never says yes.
  api.use(async (c, next) => {
    const method = c.req.method;
    if ((method === 'POST' || method === 'PATCH' || method === 'PUT') && !isJson(c.req.header('Content-Type'))) {
      return c.json({ error: 'Send changes as JSON' }, 415);
    }
    await next();
  });

  // Who may use the board: at home, everyone when there's no PIN. Otherwise, and always
  // from the internet, signed-in devices, plus the wall computer and the wall screens.
  api.use(async (c, next) => {
    if (OPEN_PATHS.has(c.req.path) || !auth.needsSignIn(c) || auth.isWallComputer(c) || (await screenFor(c))) return next();
    const session = await auth.session(c);
    if (!session.signedIn) {
      return c.json({ error: auth.pinSet ? 'Enter the PIN to open the board' : 'Scan the code on your wall to sign in', locked: true }, 401);
    }
    // Keep devices that are used signed in (only on plain requests; a live stream can't set cookies).
    if (session.renew && c.req.path === '/api/state') await auth.signIn(c);
    return next();
  });

  api.get('/health', c => c.json({ ok: true, rev: store.rev, buildId }));

  api.get('/session', async c => {
    c.header('Cache-Control', 'no-store');
    // The app tells the wall apart from phones: phones are asked whether to hide the "Connect your phone" code.
    const wallComputer = auth.isWallComputer(c);
    const screenId = wallComputer ? null : await auth.screenId(c);
    const wallScreen = screenId !== null && store.screens.some(screen => screen.id === screenId);
    // A wall screen's cookie is renewed whenever it opens; a removed one's is cleared.
    if (screenId !== null) {
      if (wallScreen) await auth.setScreen(c, screenId);
      else auth.clearScreen(c);
    }
    const session = await auth.session(c);
    if (session.renew) await auth.signIn(c);
    const signedIn = !auth.needsSignIn(c) || wallComputer || wallScreen || session.signedIn;
    return c.json({ pinSet: auth.pinSet, signedIn, wallComputer, wallScreen, outside: isOutside(c) } satisfies SessionResponse);
  });

  /** Counts a sign-in try against this device's limit: the seconds to wait, or 0 to go ahead. */
  const tryLimit = (c: Context, now: number, limiter: LoginLimiter) => {
    const client = auth.clientKey(c);
    const wait = limiter.waitFor(client, now);
    if (wait === 0) limiter.tried(client, now);
    return { wait, succeeded: () => limiter.succeeded(client, now) };
  };

  api.post('/login', async c => {
    const { pin } = await readBody(c, loginSchema);
    if (!auth.needsSignIn(c)) return c.json({ ok: true });
    if (!auth.pinSet) return c.json({ error: 'This board has no PIN. Scan the code on your wall to sign in.' }, 400);
    const now = store.now().getTime();
    const limit = tryLimit(c, now, auth.limiterFor(c));
    if (limit.wait > 0) {
      c.header('Retry-After', String(limit.wait));
      return c.json({ error: 'Too many wrong PINs. Try again later.', retryAfter: limit.wait }, 429);
    }
    if (!auth.checkPin(pin)) {
      await pause(300);
      return c.json({ error: 'That PIN isn’t right' }, 401);
    }
    limit.succeeded();
    await auth.signIn(c);
    return c.json({ ok: true });
  });

  // Signing in by scanning a code: the one on the wall, or one a signed-in device shows.
  api.post('/pair', async c => {
    const { code } = await readBody(c, pairSchema);
    const now = store.now().getTime();
    if (!auth.needsSignIn(c)) {
      // Open anyway. Still, the code is used up, and the wall shows a fresh one.
      if (auth.codes.redeem(code, now)) hub.broadcast('pair', {});
      return c.json({ ok: true });
    }
    const limit = tryLimit(c, now, auth.codeLimiter);
    if (limit.wait > 0) {
      c.header('Retry-After', String(limit.wait));
      return c.json({ error: 'Too many tries. Try again later.', retryAfter: limit.wait }, 429);
    }
    if (!auth.codes.redeem(code, now)) {
      await pause(300);
      return c.json({ error: 'That code isn’t right, or it has expired. Use the one on the wall now.', expired: true }, 401);
    }
    hub.broadcast('pair', {}); // the wall shows a fresh code
    limit.succeeded();
    await auth.signIn(c);
    return c.json({ ok: true });
  });

  api.post('/logout', c => {
    auth.signOut(c);
    return c.json({ ok: true });
  });

  // The code the wall shows in its QR code, so phones sign in by scanning it. Only the
  // wall (the wall computer and wall screens) gets it, and never over the internet.
  api.get('/pair-code', async c => {
    c.header('Cache-Control', 'no-store');
    if (isOutside(c) || !(auth.isWallComputer(c) || (await screenFor(c)))) return c.json({ error: 'Only the wall shows sign-in codes' }, 403);
    if (!auth.pinSet && !anywhereUrl) return c.json({ code: null } satisfies WallCode);
    return c.json(auth.codes.current(store.now().getTime()) satisfies WallCode);
  });

  // "Connect another device": a code for a signed-in device to show, for the new one to scan.
  api.post('/pair-code', c => {
    c.header('Cache-Control', 'no-store');
    return c.json(auth.codes.issue(store.now().getTime()) satisfies PairCode, 201);
  });

  // Whether the board can be used from anywhere (set up with scripts/linux/anywhere.sh).
  api.get('/anywhere', c => {
    c.header('Cache-Control', 'no-store');
    return c.json({ url: anywhereUrl } satisfies AnywhereStatus);
  });

  // Wall screens: the devices set up to show the wall. The wall computer adds itself.
  const screenList = async (c: Context): Promise<ScreenInfo[]> =>
    screens.list(auth.isWallComputer(c) ? LOCAL_SCREEN_ID : await auth.screenId(c));

  api.get('/screens', async c => {
    c.header('Cache-Control', 'no-store');
    return c.json({ screens: await screenList(c) });
  });

  // "Use this device as a wall screen" (or rename it, if it already is one).
  api.post('/screens', async c => {
    const { name } = await readBody(c, screenNameSchema);
    let id: string;
    if (auth.isWallComputer(c)) {
      id = store.addScreen(LOCAL_SCREEN_NAME, LOCAL_SCREEN_ID).id;
    } else {
      const current = await screenFor(c);
      id = current ? store.renameScreen(current.id, name).id : store.addScreen(name).id;
      await auth.setScreen(c, id);
    }
    screens.changed();
    return c.json({ screen: screens.list(id).find(screen => screen.id === id) }, 201);
  });

  api.patch('/screens/:id', async c => {
    const { name } = await readBody(c, screenNameSchema);
    store.renameScreen(c.req.param('id'), name);
    screens.changed();
    return c.json({ ok: true });
  });

  // Removing a screen also signs it out (unless it signed in some other way).
  api.delete('/screens/:id', async c => {
    const id = c.req.param('id');
    store.removeScreen(id);
    screens.forget(id);
    if ((await auth.screenId(c)) === id) auth.clearScreen(c);
    screens.changed();
    return c.json({ ok: true });
  });

  // A wall screen showing the wall checks in every minute.
  api.post('/screens/here', async c => {
    let id: string | null = null;
    if (auth.isWallComputer(c)) {
      id = store.addScreen(LOCAL_SCREEN_NAME, LOCAL_SCREEN_ID).id;
    } else {
      const screen = await screenFor(c);
      if (screen) id = screen.id;
      else if ((await auth.screenId(c)) !== null) auth.clearScreen(c); // removed in the Wall tab
    }
    if (id === null) return c.json({ screen: null });
    screens.checkIn(id);
    return c.json({ screen: (await screenList(c)).find(screen => screen.id === id) ?? null });
  });

  api.get('/state', c => {
    c.header('Cache-Control', 'no-store');
    const { epoch, rev, board } = store.snapshot();
    return c.json({ epoch, rev, board, connectUrl: typeof connectUrl === 'function' ? connectUrl() : connectUrl } satisfies StateResponse);
  });

  api.get('/ticker', c => {
    c.header('Cache-Control', 'no-store');
    return c.json(ticker?.snapshot() ?? { items: [], updatedAt: null, stale: false });
  });

  api.get('/events', c => {
    c.header('X-Accel-Buffering', 'no'); // don't let a proxy hold events back
    return streamSSE(c, stream => hub.serve(stream, { epoch: store.epoch, rev: store.rev, buildId }));
  });

  // Notes
  api.post('/notes', async c => {
    const input = await readBody(c, newNoteSchema);
    const note: Note = { ...input, id: input.id ?? newId(), createdAt: input.createdAt ?? stamp(), updatedAt: stamp() };
    const rev = store.apply({ type: 'note.add', note });
    return changed(c, store, rev, { note: store.board.notes.find(n => n.id === note.id) }, 201);
  });

  api.patch('/notes/:id', async c => {
    const id = c.req.param('id');
    const patch = await readBody(c, notePatchSchema);
    const rev = store.apply({ type: 'note.patch', id, patch });
    return changed(c, store, rev, { note: store.board.notes.find(n => n.id === id) });
  });

  api.delete('/notes/:id', c => changed(c, store, store.apply({ type: 'note.delete', id: c.req.param('id') })));

  api.post('/notes/:id/restore', c => {
    const id = c.req.param('id');
    const rev = store.apply({ type: 'note.restore', id });
    return changed(c, store, rev, { note: store.board.notes.find(n => n.id === id) });
  });

  api.post('/notes/:id/completions', async c => {
    const id = c.req.param('id');
    const { add, remove } = await readBody(c, completionsChangeSchema);
    const rev = store.apply({ type: 'note.completions', id, add, remove });
    return changed(c, store, rev, { note: store.board.notes.find(n => n.id === id) });
  });

  // Columns
  api.post('/lanes', async c => {
    const input = await readBody(c, newLaneSchema);
    const order = Math.max(-1, ...store.board.lanes.map(l => l.order)) + 1;
    const lane: Lane = { id: input.id ?? newId(), title: input.title, color: input.color, kind: input.kind, order };
    const rev = store.apply({ type: 'lane.add', lane });
    return changed(c, store, rev, { lane }, 201);
  });

  api.put('/lanes/order', async c => {
    const { ids } = await readBody(c, laneOrderSchema);
    return changed(c, store, store.apply({ type: 'lane.order', ids }));
  });

  api.patch('/lanes/:id', async c => {
    const id = c.req.param('id');
    const patch = await readBody(c, lanePatchSchema);
    return changed(c, store, store.apply({ type: 'lane.patch', id, patch }));
  });

  api.delete('/lanes/:id', c => changed(c, store, store.apply({ type: 'lane.delete', id: c.req.param('id') })));

  api.post('/lanes/:id/restore', c => changed(c, store, store.apply({ type: 'lane.restore', id: c.req.param('id') })));

  // Goals
  api.post('/goals', async c => {
    const input = await readBody(c, newGoalSchema);
    const goal: Goal = { ...input, id: input.id ?? newId(), createdAt: input.createdAt ?? stamp() };
    const rev = store.apply({ type: 'goal.add', goal });
    return changed(c, store, rev, { goal }, 201);
  });

  api.patch('/goals/:id', async c => {
    const id = c.req.param('id');
    const patch = await readBody(c, goalPatchSchema);
    return changed(c, store, store.apply({ type: 'goal.patch', id, patch }));
  });

  api.delete('/goals/:id', c => changed(c, store, store.apply({ type: 'goal.delete', id: c.req.param('id') })));

  api.post('/goals/:id/restore', c => changed(c, store, store.apply({ type: 'goal.restore', id: c.req.param('id') })));

  // Wall settings and reminder pop-ups
  api.patch('/settings', async c => {
    const patch = await readBody(c, settingsPatchSchema);
    return changed(c, store, store.apply({ type: 'settings.patch', patch }), { settings: store.board.settings });
  });

  api.post('/alerts', async c => {
    const input = await readBody(c, newAlertSchema);
    const id = input.id ?? newId();
    return changed(c, store, store.apply({ type: 'alert.fire', id, noteId: input.noteId }), { id }, 201);
  });

  api.delete('/alerts/:id', c => changed(c, store, store.apply({ type: 'alert.dismiss', id: c.req.param('id') })));

  // The phone remote: what the wall shows, and touchpad, typing and buttons.
  api.get('/remote', async c => {
    c.header('Cache-Control', 'no-store');
    return c.json(remote ? await remote.status() : ({ available: false, reason: 'off' } satisfies RemoteStatus));
  });

  api.post('/remote', async c => {
    const { commands } = await readBody(c, remoteRequestSchema);
    if (!remote) return c.json({ error: 'Remote control is turned off', available: false, reason: 'off' }, 503);
    try {
      return c.json(await remote.run(commands));
    } catch (error) {
      if (!(error instanceof RemoteError)) throw error;
      return c.json({ error: error.message, ...(error.reason ? { available: false, reason: error.reason } : {}) }, error.status);
    }
  });

  // "Reload the wall" in the app: every screen showing the wall reloads itself.
  api.post('/wall/reload', c => {
    hub.broadcast('reload', {});
    return c.json({ ok: true });
  });

  // "Exit to desktop" on the wall screen. Only the wall computer itself may close it.
  api.post('/wall/close', async c => {
    if (!fromThisComputer(c)) return c.json({ error: 'Only the wall computer can close the wall screen' }, 403);
    if (!closeWall) return c.json({ error: 'The wall screen can’t be closed from here' }, 503);
    try {
      await closeWall();
    } catch (error) {
      console.error('Could not close the wall screen:', error);
      return c.json({ error: 'Couldn’t close the wall screen' }, 500);
    }
    return c.json({ ok: true });
  });

  // A full copy, including the trash, to keep somewhere safe.
  api.get('/export', c => {
    c.header('Content-Disposition', `attachment; filename="digital-sticky-${format(store.now(), 'yyyy-MM-dd')}.json"`);
    c.header('Cache-Control', 'no-store');
    return c.json(store.exportFile());
  });

  api.all('*', c => c.json({ error: 'Not found' }, 404));
  app.route('/api', api);

  if (staticDir) {
    app.use(
      '*',
      serveStatic({
        root: staticDir,
        onFound: (path, c) => {
          // Built assets have content hashes in their names, so they never change.
          c.header('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }),
    );
  }

  return app;
}
