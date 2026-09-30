import { serve, type ServerType } from '@hono/node-server';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Board } from '../shared/types.ts';
import { createApp } from './app.ts';
import { Auth, loadSecret } from './auth.ts';
import { EventHub } from './events.ts';
import { startReminders } from './reminders.ts';
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
  connectUrl: string | null;
  buildId: string;
  log?: (message: string) => void;
  /** The server's clock (tests start it at a fixed time). */
  now?: () => Date;
  /** How often reminders are checked. */
  reminderTickMs?: number;
  /** A PIN (6–12 digits) to lock the board with; null or missing leaves it open. */
  pin?: string | null;
  /** With a PIN: let the wall computer's own browser in without it (default true). */
  trustLocalhost?: boolean;
  allowedHosts?: string[];
  /** How the ticker fetches prices and headlines (tests pass a fake); false turns it off. */
  tickerFetch?: Fetcher | false;
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
  const app = createApp({
    store,
    hub,
    buildId: options.buildId,
    staticDir: options.staticDir,
    connectUrl: options.connectUrl,
    auth,
    allowedHosts: options.allowedHosts,
    ticker,
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const created: ServerType = serve({ fetch: app.fetch, port: options.port, hostname: options.host ?? '0.0.0.0' }, () => resolve(created as Server));
    created.once('error', reject);
  });
  const { port } = server.address() as AddressInfo;
  const stopReminders = startReminders(store, { tickMs: options.reminderTickMs, log: options.log });
  ticker?.start();

  const closeServer = () => {
    stopReminders();
    ticker?.stop();
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
