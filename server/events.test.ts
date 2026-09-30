import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { createApp } from './app.ts';
import { EventHub } from './events.ts';
import { BoardStore } from './store.ts';

interface ServerEvent {
  event: string;
  data: unknown;
}

/** Reads server-sent events off a response body, one at a time. */
function eventReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async next(): Promise<ServerEvent> {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const field = (name: string) =>
            block
              .split('\n')
              .filter(line => line.startsWith(`${name}: `))
              .map(line => line.slice(name.length + 2))
              .join('\n');
          return { event: field('event'), data: JSON.parse(field('data') || 'null') };
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        buffer += decoder.decode(value, { stream: true });
      }
    },
    cancel: () => reader.cancel(),
  };
}

let dir: string;
let store: BoardStore;
let hub: EventHub;
let app: Hono;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sticky-events-'));
  store = await BoardStore.open({ dir, seed: makeEmptyBoard, saveDelayMs: 5 });
  hub = new EventHub({ heartbeatMs: 40 });
  store.subscribe(rev => hub.broadcast('change', { epoch: store.epoch, rev }));
  app = createApp({ store, hub, buildId: 'build-1', staticDir: null, connectUrl: null });
});

afterEach(async () => {
  hub.closeAll();
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('live updates', () => {
  it('says hello, rings on every change, pings, and forgets closed connections', async () => {
    const response = await app.request('/api/events');
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    const events = eventReader(response.body!);

    expect(await events.next()).toEqual({ event: 'hello', data: { epoch: store.epoch, rev: 0, buildId: 'build-1' } });
    expect(hub.size).toBe(1);

    await app.request('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ laneId: 'todo', title: 'Buy stamps' }),
    });
    let next = await events.next();
    while (next.event === 'ping') next = await events.next();
    expect(next).toEqual({ event: 'change', data: { epoch: store.epoch, rev: 1 } });

    expect((await events.next()).event).toBe('ping');

    await events.cancel();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(hub.size).toBe(0);
  });

  it('asks screens showing the wall to reload', async () => {
    const response = await app.request('/api/events');
    const events = eventReader(response.body!);
    await events.next();
    await app.request('/api/wall/reload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    let next = await events.next();
    while (next.event === 'ping') next = await events.next();
    expect(next.event).toBe('reload');
    await events.cancel();
  });
});
