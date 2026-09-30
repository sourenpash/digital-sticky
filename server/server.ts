import { serve, type ServerType } from '@hono/node-server';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Board } from '../shared/types.ts';
import { createApp } from './app.ts';
import { EventHub } from './events.ts';
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
  const store = await BoardStore.open({ dir: options.dataDir, seed: options.seed, reset: options.reset, log: options.log });
  const hub = new EventHub();
  store.subscribe(rev => hub.broadcast('change', { epoch: store.epoch, rev }));
  const app = createApp({ store, hub, buildId: options.buildId, staticDir: options.staticDir, connectUrl: options.connectUrl });

  const server = await new Promise<Server>((resolve, reject) => {
    const created: ServerType = serve({ fetch: app.fetch, port: options.port, hostname: options.host ?? '0.0.0.0' }, () => resolve(created as Server));
    created.once('error', reject);
  });
  const { port } = server.address() as AddressInfo;

  const closeServer = () => {
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
