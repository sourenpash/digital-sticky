import type { SSEStreamingApi } from 'hono/streaming';
import type { HelloEvent } from '../shared/api.ts';

// Live updates over server-sent events. The server only rings a bell ("change",
// with the new revision); each screen then fetches the board. On every connect it
// says hello with the current revision, and a ping every 20 seconds lets screens
// notice a connection that died quietly (iPhones do this in the background).

export class EventHub {
  private readonly clients = new Set<SSEStreamingApi>();
  private readonly heartbeatMs: number;

  constructor({ heartbeatMs = 20_000 }: { heartbeatMs?: number } = {}) {
    this.heartbeatMs = heartbeatMs;
  }

  get size(): number {
    return this.clients.size;
  }

  /** Holds one screen's connection open until it goes away. */
  async serve(stream: SSEStreamingApi, hello: HelloEvent): Promise<void> {
    const gone = new Promise<void>(resolve => stream.onAbort(resolve));
    this.clients.add(stream);
    const beat = setInterval(() => void this.send(stream, 'ping', {}), this.heartbeatMs);
    try {
      // `retry`: how long the browser waits before reconnecting after a drop.
      await stream.writeSSE({ event: 'hello', data: JSON.stringify(hello), retry: 2000 });
      await gone;
    } finally {
      clearInterval(beat);
      this.clients.delete(stream);
    }
  }

  broadcast(event: string, data: unknown): void {
    for (const stream of this.clients) void this.send(stream, event, data);
  }

  private async send(stream: SSEStreamingApi, event: string, data: unknown): Promise<void> {
    try {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    } catch {
      this.clients.delete(stream);
      stream.abort();
    }
  }

  /** On shutdown: end every connection so the server can close. */
  closeAll(): void {
    for (const stream of this.clients) stream.abort();
    this.clients.clear();
  }
}
