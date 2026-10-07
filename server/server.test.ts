import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { startServer, type RunningServer } from './server.ts';

let dir: string;
let running: RunningServer | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sticky-server-'));
});

afterEach(async () => {
  await running?.stop();
  running = null;
  await rm(dir, { recursive: true, force: true });
});

const start = (publicPort: number | null) =>
  startServer({ port: 0, host: '127.0.0.1', dataDir: dir, seed: makeEmptyBoard, staticDir: null, connectUrl: null, buildId: 'b', tickerFetch: false, publicPort });

describe('the internet door', () => {
  it('counts everything arriving there as from outside, even from this computer', async () => {
    running = await start(0);
    expect(running.publicPort).toEqual(expect.any(Number));
    expect(running.publicPort).not.toBe(running.port);
    // The board's own port, from this computer: the wall computer.
    const home = await fetch(`http://127.0.0.1:${running.port}/api/session`);
    expect(await home.json()).toMatchObject({ wallComputer: true, outside: false, signedIn: true });
    // The internet door, from this computer too (that's how Tailscale delivers): outside.
    const door = `http://127.0.0.1:${running.publicPort}`;
    expect(await (await fetch(`${door}/api/session`)).json()).toMatchObject({ wallComputer: false, outside: true, signedIn: false });
    expect((await fetch(`${door}/api/state`)).status).toBe(401);
    expect((await fetch(`http://localhost:${running.publicPort}/api/state`)).status).toBe(401);
    expect((await fetch(`${door}/api/health`)).status).toBe(200);
  });

  it('can be turned off', async () => {
    running = await start(null);
    expect(running.publicPort).toBeNull();
  });

  it('won’t start half-open when its port is taken', async () => {
    const blocker = createServer();
    await new Promise<void>(done => blocker.listen(0, '127.0.0.1', done));
    const { port } = blocker.address() as { port: number };
    try {
      await expect(start(port)).rejects.toMatchObject({ code: 'EADDRINUSE', port });
    } finally {
      await new Promise(done => blocker.close(done));
    }
  });
});
