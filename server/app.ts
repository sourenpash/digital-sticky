import { serveStatic } from '@hono/node-server/serve-static';
import { format } from 'date-fns';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { secureHeaders } from 'hono/secure-headers';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { StateResponse } from '../shared/api.ts';
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
  settingsPatchSchema,
} from '../shared/schema.ts';
import type { RemoteStatus } from '../shared/remote.ts';
import type { Goal, Lane, Note } from '../shared/types.ts';
import type { Auth } from './auth.ts';
import type { EventHub } from './events.ts';
import { hostAllowed } from './hosts.ts';
import { RemoteError, type KioskRemote } from './remote.ts';
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
  /** Set when there's a PIN: everything but signing in needs it. */
  auth?: Auth | null;
  /** Names to answer to besides this computer's own and home-network ones. */
  allowedHosts?: readonly string[];
  /** Live prices and headlines for the wall's ticker. */
  ticker?: TickerFeed | null;
  /** The phone remote, which drives the wall computer's browser; null when it's off. */
  remote?: Pick<KioskRemote, 'status' | 'run'> | null;
}

/** Open without the PIN: checking the server is up, and signing in and out. */
const OPEN_PATHS = new Set(['/api/health', '/api/session', '/api/login', '/api/logout']);
const loginSchema = z.object({ pin: z.string().max(64) });
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

export function createApp({ store, hub, buildId, staticDir, connectUrl, auth = null, allowedHosts = [], ticker = null, remote = null }: AppOptions): Hono {
  const app = new Hono();
  const stamp = () => store.now().toISOString();

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

  if (auth) {
    api.use(async (c, next) => {
      if (OPEN_PATHS.has(c.req.path) || auth.isWallComputer(c)) return next();
      const session = await auth.session(c);
      if (!session.signedIn) return c.json({ error: 'Enter the PIN to open the board', locked: true }, 401);
      // Keep devices that are used signed in (only on plain requests; a live stream can't set cookies).
      if (session.renew && c.req.path === '/api/state') await auth.signIn(c);
      return next();
    });
  }

  api.get('/health', c => c.json({ ok: true, rev: store.rev, buildId }));

  api.get('/session', async c => {
    c.header('Cache-Control', 'no-store');
    if (!auth) return c.json({ pinSet: false, signedIn: true, wallComputer: false });
    const wallComputer = auth.isWallComputer(c);
    const session = await auth.session(c);
    if (session.renew) await auth.signIn(c);
    return c.json({ pinSet: true, signedIn: wallComputer || session.signedIn, wallComputer });
  });

  api.post('/login', async c => {
    if (!auth) return c.json({ ok: true });
    const { pin } = await readBody(c, loginSchema);
    const client = auth.clientKey(c);
    const now = store.now().getTime();
    const wait = auth.limiter.waitFor(client, now);
    if (wait > 0) {
      c.header('Retry-After', String(wait));
      return c.json({ error: 'Too many wrong PINs. Try again later.', retryAfter: wait }, 429);
    }
    auth.limiter.tried(client, now);
    if (!auth.checkPin(pin)) {
      await pause(300);
      return c.json({ error: 'That PIN isn’t right' }, 401);
    }
    auth.limiter.succeeded(client, now);
    await auth.signIn(c);
    return c.json({ ok: true });
  });

  api.post('/logout', c => {
    auth?.signOut(c);
    return c.json({ ok: true });
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
