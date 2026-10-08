import { serve, type ServerType } from '@hono/node-server';
import { execFile } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Board } from '../shared/types.ts';
import { AiRunner, type Fetch as AiFetch } from './ai.ts';
import { AiConnections } from './aiConnections.ts';
import { createApp } from './app.ts';
import { Auth, loadSecret } from './auth.ts';
import { EventHub } from './events.ts';
import { IMessage } from './imessage.ts';
import { Notifier } from './notify.ts';
import { PushService } from './push.ts';
import { startReminders } from './reminders.ts';
import { McpSecret } from './mcp.ts';
import { KioskRemote } from './remote.ts';
import { Screens } from './screens.ts';
import { TickerFeed, type Fetcher } from './ticker.ts';
import { BoardStore } from './store.ts';

export interface StartOptions {
  port: number;
  host?: string;
  dataDir: string;
  seed: (now: Date) => Board;
  /** Start from the seed even when a saved board exists (demo mode). */
  reset?: boolean;
  staticDir: string | null;
  /** The address phones can open (worked out again later: the network may not be up yet at boot). */
  connectUrl: string | null | (() => string | null);
  buildId: string;
  log?: (message: string) => void;
  /** The server's clock (tests start it at a fixed time). */
  now?: () => Date;
  /** How often reminders are checked. */
  reminderTickMs?: number;
  /** A PIN (6–12 digits) to lock the board with; null or missing leaves it open at home. */
  pin?: string | null;
  /**
   * The door for the internet: a port on 127.0.0.1 that Tailscale Funnel forwards to.
   * Everything arriving there needs signing in. 0 picks any free port (tests); none turns it off.
   */
  publicPort?: number | null;
  /** The board's internet address, when it can be used from anywhere (shown in the Wall tab). */
  anywhereUrl?: string | null;
  /** Requests from the internet arrive over https (default true), so their cookies can be Secure. */
  outsideHttps?: boolean;
  /** Let the wall computer's own browser in without the PIN, and tell it apart from phones (default true). */
  trustLocalhost?: boolean;
  allowedHosts?: string[];
  /** How the ticker fetches prices and headlines (tests pass a fake); false turns it off. */
  tickerFetch?: Fetcher | false;
  /** The wall browser's debugging port on 127.0.0.1, for the phone remote; none turns the remote off. */
  remoteDebugPort?: number | null;
  /** The script that runs the wall screen (scripts/linux/kiosk.sh), for "Exit to desktop"; none turns that off. */
  kioskScript?: string | null;
  /** The board's address on the home Wi-Fi (for the MCP link there); defaults to connectUrl. */
  homeUrl?: string | null | (() => string | null);
  /** How the AI helper wakes AIs up (tests pass a stand-in). */
  aiFetch?: AiFetch;
  /** How often the AI helper checks for due stickies. */
  aiTickMs?: number;
  /** How notifications reach phones' push services (tests pass a stand-in). */
  pushFetch?: AiFetch;
  /** How texts reach BlueBubbles (tests pass a stand-in). */
  textFetch?: AiFetch;
}

/** Closes the wall screen with its script (`kiosk.sh --stop`), so the desktop shows. */
function kioskCloser(script: string): () => Promise<void> {
  return () =>
    new Promise((resolve, reject) => {
      execFile('bash', [script, '--stop'], { timeout: 10_000 }, error => (error ? reject(error) : resolve()));
    });
}

export interface RunningServer {
  port: number;
  /** The internet door's port, or null when it's off. */
  publicPort: number | null;
  store: BoardStore;
  hub: EventHub;
  /** Saves and stops. */
  stop(): Promise<void>;
  /** Saves synchronously and stops (for signal handlers). */
  stopNow(): void;
}

type Fetch = (request: Request, env: { incoming: unknown; outgoing: unknown }) => Response | Promise<Response>;

/** Starts listening; rejects if the port can't be used. */
function listen(fetch: Fetch, port: number, hostname: string): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    const created: ServerType = serve({ fetch: fetch as Parameters<typeof serve>[0]['fetch'], port, hostname }, () => resolve(created as Server));
    created.once('error', reject);
  });
}

/** Opens the board and starts serving the app, the API and live updates. */
export async function startServer(options: StartOptions): Promise<RunningServer> {
  const store = await BoardStore.open({ dir: options.dataDir, seed: options.seed, reset: options.reset, now: options.now, log: options.log });
  const hub = new EventHub();
  store.subscribe(rev => hub.broadcast('change', { epoch: store.epoch, rev }));
  const auth = new Auth({
    pin: options.pin ?? null,
    secret: await loadSecret(options.dataDir),
    trustLocalhost: options.trustLocalhost ?? true,
    outsideHttps: options.outsideHttps,
    now: options.now,
  });
  const screens = new Screens(store, hub);
  // The AI helper: AIs connect over MCP (at /mcp/<secret>) and are woken when a sticky is due.
  const aiConnections = await AiConnections.open(options.dataDir, options.log);
  const mcpSecret = await McpSecret.open(options.dataDir);
  const valueOf = (url: string | null | (() => string | null) | undefined) => (typeof url === 'function' ? url() : (url ?? null));
  const homeUrl = options.homeUrl ?? options.connectUrl;
  const aiRunner = new AiRunner({
    store,
    connections: aiConnections,
    // Passed on to webhooks: the address that works from anywhere, if there is one.
    mcpUrl: () => {
      const base = options.anywhereUrl ?? valueOf(homeUrl);
      return base ? `${base.replace(/\/$/, '')}/mcp/${mcpSecret.current}` : null;
    },
    fetch: options.aiFetch,
    tickMs: options.aiTickMs,
    log: options.log,
  });
  // Reminders on phones: notifications, and texts through iMessage.
  const push = await PushService.open(options.dataDir, {
    fetch: options.pushFetch,
    // Who's sending, for the push services: the board's https address when it has one.
    subject: () => options.anywhereUrl ?? 'mailto:digital-sticky@example.com',
    log: options.log,
  });
  const imessage = await IMessage.open(options.dataDir, { fetch: options.textFetch, log: options.log });
  const notifier = new Notifier({ store, push, imessage, log: options.log });
  // Open Wall tabs show what was sent and received as it happens.
  push.subscribe(() => hub.broadcast('push', {}));
  imessage.subscribe(() => hub.broadcast('imessage', {}));
  const ticker = options.tickerFetch === false ? null : new TickerFeed(store, { fetcher: options.tickerFetch, log: options.log });
  ticker?.subscribe(() => hub.broadcast('ticker', {}));
  // The port is only known once listening (tests ask for any free one).
  let port = options.port;
  const remote = options.remoteDebugPort
    ? new KioskRemote({ port: options.remoteDebugPort, wallUrl: () => `http://localhost:${port}/#wall`, log: options.log })
    : null;
  const app = createApp({
    store,
    hub,
    buildId: options.buildId,
    staticDir: options.staticDir,
    connectUrl: options.connectUrl,
    auth,
    trustLocalhost: options.trustLocalhost ?? true,
    anywhereUrl: options.anywhereUrl ?? null,
    screens,
    allowedHosts: options.allowedHosts,
    ticker,
    remote,
    closeWall: options.kioskScript ? kioskCloser(options.kioskScript) : null,
    ai: { secret: mcpSecret, connections: aiConnections, runner: aiRunner },
    homeUrl,
    push,
    imessage,
  });

  const server = await listen(app.fetch, options.port, options.host ?? '0.0.0.0');
  port = (server.address() as AddressInfo).port;
  // The door for the internet. Only this computer can connect to it (Tailscale does, for
  // Funnel), and the app treats everything that arrives there as coming from outside.
  let outside: Server | null = null;
  if (options.publicPort != null) {
    try {
      outside = await listen((request, env) => app.fetch(request, { ...env, outside: true }), options.publicPort, '127.0.0.1');
    } catch (error) {
      server.close();
      throw error;
    }
  }
  const stopReminders = startReminders(store, { tickMs: options.reminderTickMs, log: options.log, onFire: fires => notifier.reminders(fires) });
  const stopNotifier = notifier.start();
  const stopScreens = screens.start();
  const stopAi = aiRunner.start();
  ticker?.start();
  remote?.start();
  // Tell open screens when the phone address changes (it's often unknown for a moment at boot).
  const connectUrl = options.connectUrl;
  let lastUrl = typeof connectUrl === 'function' ? connectUrl() : connectUrl;
  const addressWatch =
    typeof connectUrl === 'function'
      ? setInterval(() => {
          const url = connectUrl();
          if (url === lastUrl) return;
          lastUrl = url;
          hub.broadcast('connect', { connectUrl: url });
        }, 30_000)
      : null;
  addressWatch?.unref();

  const closeServer = () => {
    stopReminders();
    stopNotifier();
    stopScreens();
    stopAi();
    ticker?.stop();
    remote?.close();
    if (addressWatch) clearInterval(addressWatch);
    hub.closeAll();
    for (const open of [server, outside]) {
      open?.close();
      open?.closeAllConnections();
    }
  };

  return {
    port,
    publicPort: outside ? (outside.address() as AddressInfo).port : null,
    store,
    hub,
    async stop() {
      closeServer();
      await store.close();
      await Promise.all([aiConnections.flush(), push.flush(), imessage.flush()]);
    },
    stopNow() {
      store.flushSync();
      closeServer();
    },
  };
}
