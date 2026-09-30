// A small client for Chrome's DevTools protocol, which the phone remote uses to drive
// the wall computer's browser. It only ever talks to this computer (127.0.0.1).

/** A DevTools call that got no answer in time (a busy page, or one showing a dialog). */
export class CdpTimeout extends Error {}

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

interface Waiting {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** How long one call may take by default. */
const CALL_MS = 3000;

/** One WebSocket to the browser. Calls are matched to replies by id; events go to `onEvent`. */
export class Cdp {
  closed = false;
  onEvent: (event: CdpEvent) => void = () => {};
  onClose: () => void = () => {};
  private readonly socket: WebSocket;
  private nextId = 0;
  private readonly waiting = new Map<number, Waiting>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', event => this.receive(String(event.data)));
    socket.addEventListener('close', () => this.shut());
    socket.addEventListener('error', () => this.shut());
  }

  /** Connects to the browser listening on 127.0.0.1:`port`. Its own address for the socket only lends the path. */
  static async connect(port: number, timeoutMs = 2000): Promise<Cdp> {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
    const { webSocketDebuggerUrl } = (await response.json()) as { webSocketDebuggerUrl?: string };
    const path = new URL(webSocketDebuggerUrl ?? '').pathname;
    if (!path.startsWith('/devtools/browser/')) throw new Error('Not a browser');
    return Cdp.open(`ws://127.0.0.1:${port}${path}`, timeoutMs);
  }

  private static open(url: string, timeoutMs: number): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('Timed out'));
      }, timeoutMs);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new Cdp(socket));
      });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Could not connect'));
      });
    });
  }

  send<T = Record<string, unknown>>(method: string, params: object = {}, sessionId?: string, timeoutMs = CALL_MS): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Connection closed'));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new CdpTimeout(`${method} timed out`));
      }, timeoutMs);
      this.waiting.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
    this.shut();
  }

  private receive(data: string): void {
    let message: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof message.id === 'number') {
      const waiting = this.waiting.get(message.id);
      if (!waiting) return;
      this.waiting.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.error) waiting.reject(new Error(message.error.message ?? 'DevTools error'));
      else waiting.resolve(message.result ?? {});
    } else if (typeof message.method === 'string') {
      this.onEvent({ method: message.method, params: message.params ?? {}, sessionId: message.sessionId });
    }
  }

  private shut(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiting of this.waiting.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error('Connection closed'));
    }
    this.waiting.clear();
    this.onClose();
  }
}
