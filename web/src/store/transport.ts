import { requestFor, type ChangeResponse, type StateResponse } from '../../../shared/api.ts';
import { applyOp, type Op } from '../../../shared/ops.ts';
import type { Board } from '../../../shared/types.ts';
import { HttpError, type Transport } from './sync.ts';

/** fetch with a time limit: on iPhones a request can hang for ages after the network changes. */
async function request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(new URL(path, document.baseURI), { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function failure(response: Response): Promise<HttpError> {
  let message = `${response.status} ${response.statusText}`.trim();
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // Not JSON (a proxy error page, say): keep the status text.
  }
  return new HttpError(response.status, message);
}

/** Talks to the board server over its HTTP API. */
export class HttpTransport implements Transport {
  async load(): Promise<StateResponse> {
    const response = await request('api/state', { cache: 'no-store' }, 10_000);
    if (!response.ok) throw await failure(response);
    return (await response.json()) as StateResponse;
  }

  async send(op: Op, options: { keepalive?: boolean } = {}): Promise<ChangeResponse> {
    const { method, path, body } = requestFor(op);
    const response = await request(
      path,
      {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        keepalive: options.keepalive,
      },
      15_000,
    );
    if (!response.ok) throw await failure(response);
    return (await response.json()) as ChangeResponse;
  }
}

/** The preview page has no server: the board lives in this browser tab and resets on reload. */
export class LocalTransport implements Transport {
  private board: Board;
  private rev = 0;
  private readonly clock: () => Date;
  private readonly connectUrl: string;
  onChange: ((rev: number) => void) | null = null;

  constructor(board: Board, clock: () => Date, connectUrl: string) {
    this.board = board;
    this.clock = clock;
    this.connectUrl = connectUrl;
  }

  snapshot(): StateResponse {
    return { epoch: 'local', rev: this.rev, board: this.board, connectUrl: this.connectUrl };
  }

  async load(): Promise<StateResponse> {
    return this.snapshot();
  }

  async send(op: Op): Promise<ChangeResponse> {
    this.board = applyOp(this.board, op, this.clock());
    this.rev += 1;
    const rev = this.rev;
    queueMicrotask(() => this.onChange?.(rev));
    return { epoch: 'local', rev };
  }
}
