import type { ChangeEvent, ChangeResponse, HelloEvent, StateResponse } from '../../../shared/api.ts';
import { applyOp, type Op } from '../../../shared/ops.ts';
import type { Board } from '../../../shared/types.ts';

// Keeps this screen's copy of the board in step with the server.
//
// Every change is applied here straight away (so taps feel instant) and queued for
// the server, which gets them one at a time, in order. What's on screen is always
// "the server's latest board + the changes it hasn't confirmed yet". When the server
// says something changed, we fetch the board again. If the connection drops, changes
// wait in the queue and go out when it's back. If the board has a PIN and this device
// isn't signed in, everything waits ("locked") until it is.

export type SyncStatus = 'loading' | 'connecting' | 'live' | 'offline' | 'locked';

export interface SyncState {
  status: SyncStatus;
  /** Changes not yet saved on the server. */
  waiting: number;
  connectUrl: string | null;
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Transport {
  load(): Promise<StateResponse>;
  send(op: Op, options?: { keepalive?: boolean }): Promise<ChangeResponse>;
}

interface Pending {
  op: Op;
  /** When to send it. Typing waits a moment so a word is one request, not one per letter. */
  dueAt: number;
  firstAt: number;
  state: 'queued' | 'sending' | 'saved';
  /** The server run and revision that include it, once saved. */
  epoch?: string;
  rev?: number;
}

export interface EngineOptions {
  transport: Transport;
  /** Time used when applying changes (frozen in screenshots). */
  clock?: () => Date;
  /** Starting board, for the preview page, which has no server to load from. */
  initial?: StateResponse;
  buildId?: string;
  onError?: (message: string) => void;
  onReload?: () => void;
}

/** Longest a run of typing waits before it's sent anyway. */
const MAX_WAIT_MS = 2000;
const MAX_RETRY_MS = 15_000;

function sameTarget(a: Op, b: Op): boolean {
  if (a.type === 'settings.patch' && b.type === 'settings.patch') return true;
  if (a.type !== b.type) return false;
  return (a.type === 'note.patch' || a.type === 'goal.patch' || a.type === 'lane.patch') && 'id' in b && a.id === b.id;
}

/** Folds a later edit of the same thing into the earlier one. */
function merge(a: Op, b: Op): Op {
  if (a.type === 'settings.patch' && b.type === 'settings.patch') {
    return {
      type: 'settings.patch',
      patch: {
        night: { ...a.patch.night, ...b.patch.night },
        wall: { ...a.patch.wall, ...b.patch.wall },
        ticker: { ...a.patch.ticker, ...b.patch.ticker },
      },
    };
  }
  if (a.type === 'note.patch' && b.type === 'note.patch') return { ...a, patch: { ...a.patch, ...b.patch } };
  if (a.type === 'goal.patch' && b.type === 'goal.patch') return { ...a, patch: { ...a.patch, ...b.patch } };
  if (a.type === 'lane.patch' && b.type === 'lane.patch') return { ...a, patch: { ...a.patch, ...b.patch } };
  return b;
}

const isAdd = (op: Op) => op.type === 'note.add' || op.type === 'lane.add' || op.type === 'goal.add' || op.type === 'alert.fire';

export class SyncEngine {
  private readonly transport: Transport;
  private readonly clock: () => Date;
  private readonly buildId: string;
  private readonly onError: (message: string) => void;
  private readonly onReload: () => void;

  private server: StateResponse | null;
  private pending: Pending[] = [];
  private view: Board | null = null;
  private state: SyncState;
  private readonly listeners = new Set<() => void>();

  private streamUp = false;
  /** The live connection worked at least once (so a drop now means "offline"). */
  private everUp = false;
  private reachable = true;
  /** The server wants the PIN (it answered 401). */
  private locked = false;
  private sending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 0;
  private retryAt = 0;
  private loading: Promise<void> | null = null;
  private loadAgain = false;
  private loadRetry: ReturnType<typeof setTimeout> | null = null;
  private reloadWanted = false;

  constructor(options: EngineOptions) {
    this.transport = options.transport;
    this.clock = options.clock ?? (() => new Date());
    this.buildId = options.buildId ?? 'dev';
    this.onError = options.onError ?? (() => {});
    this.onReload = options.onReload ?? (() => {});
    this.server = options.initial ?? null;
    this.state = { status: 'loading', waiting: 0, connectUrl: this.server?.connectUrl ?? null };
    this.recompute();
  }

  getBoard = (): Board | null => this.view;
  getState = (): SyncState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Applies a change here now and queues it for the server. `delayMs` batches typing. */
  dispatch(op: Op, delayMs = 0): void {
    const now = Date.now();
    const last = this.pending[this.pending.length - 1];
    if (last && last.state === 'queued' && sameTarget(last.op, op)) {
      last.op = merge(last.op, op);
      last.dueAt = delayMs > 0 ? Math.min(now + delayMs, last.firstAt + MAX_WAIT_MS) : now;
    } else {
      this.pending.push({ op, dueAt: now + delayMs, firstAt: now, state: 'queued' });
    }
    // Keep the order: an instant change sends the waiting edits before it right away.
    if (delayMs === 0) for (const item of this.pending) if (item.state === 'queued') item.dueAt = Math.min(item.dueAt, now);
    this.recompute();
    this.pump();
  }

  /** Sends every waiting change now (closing a note, leaving the page). */
  flush(): void {
    const now = Date.now();
    for (const item of this.pending) if (item.state === 'queued') item.dueAt = now;
    this.pump();
  }

  /**
   * The page is going away: send what's left all at once with `keepalive`, which the
   * browser finishes even after the page is gone.
   */
  flushOnExit(): void {
    if (this.locked) return;
    for (const item of this.pending) {
      if (item.state !== 'queued') continue;
      item.state = 'sending';
      this.transport.send(item.op, { keepalive: true }).then(
        response => this.saved(item, response),
        () => {
          item.state = 'queued';
        },
      );
    }
  }

  /** Fetch the board again (coalesced: at most one request at a time). */
  refresh(): Promise<void> {
    if (this.loading) {
      this.loadAgain = true;
      return this.loading;
    }
    if (this.loadRetry) clearTimeout(this.loadRetry);
    this.loadRetry = null;
    this.loading = (async () => {
      try {
        do {
          this.loadAgain = false;
          const next = await this.transport.load();
          this.reachable = true;
          const wasLocked = this.locked;
          this.locked = false;
          this.adopt(next);
          if (wasLocked) this.retryNow();
        } while (this.loadAgain);
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) {
          // Signed out: nothing to retry until the PIN is entered (see unlock()).
          this.locked = true;
          this.reachable = true;
          this.updateState();
          return;
        }
        this.reachable = false;
        this.updateState();
        this.loadRetry = setTimeout(() => void this.refresh(), 3000);
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /** The live connection (re)opened: the server says where it's at. */
  handleHello(hello: HelloEvent): void {
    this.streamUp = true;
    this.everUp = true;
    this.reachable = true;
    if (hello.buildId !== this.buildId && hello.buildId !== 'dev' && this.buildId !== 'dev') {
      // The server was updated: reload once everything here is saved.
      this.reloadWanted = true;
    }
    if (!this.server || hello.epoch !== this.server.epoch || hello.rev !== this.server.rev) void this.refresh();
    this.retryNow();
    this.updateState();
    this.maybeReload();
  }

  handleChange(change: ChangeEvent): void {
    if (!this.server || change.epoch !== this.server.epoch || change.rev > this.server.rev) void this.refresh();
  }

  /** The server's address for phones changed (the network came up after the server did). */
  setConnectUrl(connectUrl: string | null): void {
    if (!this.server || this.server.connectUrl === connectUrl) return;
    this.server = { ...this.server, connectUrl };
    this.updateState();
  }

  setStreamUp(up: boolean): void {
    if (up) this.everUp = true;
    if (this.streamUp === up) return;
    this.streamUp = up;
    this.updateState();
  }

  /** Signed in: load the board and send what was waiting. */
  unlock(): void {
    this.locked = false;
    this.updateState();
    void this.refresh();
    this.retryNow();
  }

  /** Try waiting changes again now instead of after the back-off. */
  retryNow(): void {
    this.retryAt = 0;
    this.pump();
  }

  private adopt(next: StateResponse): void {
    const current = this.server;
    if (current && current.epoch === next.epoch && next.rev <= current.rev) {
      // Nothing new on the board, but the phone address can still have changed.
      if (next.connectUrl !== current.connectUrl) this.server = { ...current, connectUrl: next.connectUrl };
      this.updateState();
      return;
    }
    this.server = next;
    // Drop saved changes this board already includes. Ones saved by an earlier run of
    // the server (it restarted since) are in the file it loaded.
    this.pending = this.pending.filter(
      item => item.state !== 'saved' || (item.epoch === next.epoch && (item.rev ?? 0) > next.rev),
    );
    this.recompute();
    this.maybeReload();
  }

  private pump(): void {
    if (this.sending || this.locked) return;
    const next = this.pending.find(item => item.state === 'queued');
    if (!next) return;
    const now = Date.now();
    const wait = Math.max(next.dueAt, this.retryAt) - now;
    if (wait > 0) {
      this.schedule(wait);
      return;
    }
    this.sending = true;
    next.state = 'sending';
    this.transport
      .send(next.op)
      .then(
        response => this.saved(next, response),
        error => this.failed(next, error),
      )
      .finally(() => {
        this.sending = false;
        this.pump();
      });
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, ms);
  }

  private saved(item: Pending, response: ChangeResponse): void {
    item.state = 'saved';
    item.epoch = response.epoch;
    item.rev = response.rev;
    this.retryMs = 0;
    this.reachable = true;
    const server = this.server;
    if (server && server.epoch === response.epoch && server.rev >= response.rev) {
      this.pending = this.pending.filter(p => p !== item);
      this.recompute();
    } else {
      this.updateState();
      void this.refresh();
    }
    this.maybeReload();
  }

  private failed(item: Pending, error: unknown): void {
    const status = error instanceof HttpError ? error.status : 0;
    if (status === 401) {
      // Keep the change; it goes out once this device is signed in.
      item.state = 'queued';
      this.locked = true;
      this.updateState();
      return;
    }
    if (status === 0 || status >= 500 || status === 408 || status === 429) {
      // Can't reach the server (or it's having a moment): keep it and try again later.
      item.state = 'queued';
      this.reachable = false;
      this.retryMs = Math.min(MAX_RETRY_MS, Math.max(1000, this.retryMs * 2));
      this.retryAt = Date.now() + this.retryMs;
      this.updateState();
      return;
    }
    // The server said no. An add that "already exists" is one that got through before.
    this.pending = this.pending.filter(p => p !== item);
    this.recompute();
    void this.refresh();
    const gone = status === 404 && (item.op.type === 'note.patch' || item.op.type === 'note.delete' || item.op.type === 'note.completions');
    if (status === 409 && isAdd(item.op)) return;
    if (gone) {
      this.onError('That note was deleted on another device.');
      return;
    }
    this.onError(`Couldn't save that change: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  private maybeReload(): void {
    if (this.reloadWanted && this.pending.length === 0) this.onReload();
  }

  private recompute(): void {
    const base = this.server?.board ?? null;
    if (base) {
      const now = this.clock();
      this.view = this.pending.reduce((board, item) => applyOp(board, item.op, now), base);
    } else {
      this.view = null;
    }
    this.updateState(true);
  }

  private updateState(boardChanged = false): void {
    const status: SyncStatus = this.locked
      ? 'locked'
      : !this.view
        ? 'loading'
        : !this.reachable
          ? 'offline'
          : this.streamUp
            ? 'live'
            : this.everUp
              ? 'offline'
              : 'connecting';
    const waiting = this.pending.filter(item => item.state !== 'saved').length;
    const connectUrl = this.server?.connectUrl ?? null;
    const prev = this.state;
    const stateChanged = prev.status !== status || prev.waiting !== waiting || prev.connectUrl !== connectUrl;
    if (stateChanged) this.state = { status, waiting, connectUrl };
    if (stateChanged || boardChanged) for (const listener of this.listeners) listener();
  }
}
