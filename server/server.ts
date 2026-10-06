import { serve, type ServerType } from '@hono/node-server';
import { execFile } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Board } from '../shared/types.ts';
import { createApp } from './app.ts';
import { Auth, loadSecret } from './auth.ts';
import { EventHub } from './events.ts';
import { startReminders } from './reminders.ts';
import { KioskRemote } from './remote.ts';
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
  /** A PIN (6–12 digits) to lock the board with; null or missing leaves it open. */
  pin?: string | null;
  /** Let the wall computer's own browser in without the PIN, and tell it apart from phones (default true). */
  trustLocalhost?: boolean;
  allowedHosts?: string[];
  /** How the ticker fetches prices and headlines (tests pass a fake); false turns it off. */
  tickerFetch?: Fetcher | false;
  /** The wall browser's debugging port on 127.0.0.1, for the phone remote; none turns the remote off. */
  remoteDebugPort?: number | null;
  /** The script that runs the wall screen (scripts/linux/kiosk.sh), for "Exit to desktop"; none turns that off. */
  kioskScript?: string | null;
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
  store: BoardStore;
  hub: EventHub;
  /** Saves and stops. */
  stop(): Promise<void>;
  /** Saves synchronously and stops (for signal handlers). */
  stopNow(): void;
}

/** Opens the board and starts serving the app, the API and live updates. */
export async function startServer(options: StartOptions): Promise<RunningServer> {
  const store = await BoardStore.open({ dir: options.dataDir, seed: options.seed, reset: options.reset, now: options.now, log: options.log });
  const hub = new EventHub();
  store.subscribe(rev => hub.broadcast('change', { epoch: store.epoch, rev }));
  const auth = options.pin
    ? new Auth({ pin: options.pin, secret: await loadSecret(options.dataDir), trustLocalhost: options.trustLocalhost ?? true, now: options.now })
    : null;
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
    allowedHosts: options.allowedHosts,
    ticker,
    remote,
    closeWall: options.kioskScript ? kioskCloser(options.kioskScript) : null,
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const created: ServerType = serve({ fetch: app.fetch, port: options.port, hostname: options.host ?? '0.0.0.0' }, () => resolve(created as Server));
    created.once('error', reject);
  });
  port = (server.address() as AddressInfo).port;
  const stopReminders = startReminders(store, { tickMs: options.reminderTickMs, log: options.log });
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
    ticker?.stop();
    remote?.close();
    if (addressWatch) clearInterval(addressWatch);
    hub.closeAll();
    server.close();
    server.closeAllConnections();
  };

  return {
    port,
    store,
    hub,
    async stop() {
      closeServer();
      await store.close();
    },
    stopNow() {
      store.flushSync();
      closeServer();
    },
  };
}
