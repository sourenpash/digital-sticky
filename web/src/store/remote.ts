import { useEffect, useSyncExternalStore } from 'react';
import { MAX_REMOTE_COMMANDS, MAX_REMOTE_TEXT, type RemoteCommand, type RemoteField, type RemoteKey, type RemoteStatus, type RemoteUnavailableReason } from '../../../shared/remote.ts';
import { queueCommand } from '../lib/remoteInput.ts';
import { engine } from './board.ts';
import { showToast } from './toasts.ts';

// The phone remote for the wall screen. The real one sends touchpad moves, taps and
// typing to the board server, which carries them out in the wall computer's browser.
// The preview (the side-by-side page, and the single-file preview with no server)
// moves a cursor drawn over the wall picture instead.

export type { RemoteKey };
export type RemotePlace = 'board' | 'back' | 'reload' | { url: string };

/** What the touchpad and buttons drive. */
export interface RemoteController {
  /** Finger movement, already sped up for fast swipes (wall pixels of a 1920-wide screen). */
  move(dx: number, dy: number): void;
  click(): void;
  /** Two-finger movement (the page follows the fingers). */
  scroll(dx: number, dy: number): void;
  type(text: string): void;
  key(key: RemoteKey): void;
  go(place: RemotePlace): void;
  /** Answers a website's OK / Cancel question on the wall. */
  answer(accept: boolean): void;
}

// ---- The preview cursor ----

export interface RemoteCursor {
  /** Position as a share of the wall's width and height (0–1). */
  x: number;
  y: number;
  visible: boolean;
  /** Goes up with every tap, so the wall can show a click. */
  clicks: number;
}

/** Touchpad moves are in wall pixels of a 1920×1080 screen. */
const WALL_W = 1920;
const WALL_H = 1080;
const HIDE_AFTER_MS = 4000;

let cursor: RemoteCursor = { x: 0.5, y: 0.45, visible: false, clicks: 0 };
const cursorListeners = new Set<() => void>();
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function updateCursor(next: Partial<RemoteCursor>): void {
  cursor = { ...cursor, ...next, visible: true };
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    cursor = { ...cursor, visible: false };
    cursorListeners.forEach(listener => listener());
  }, HIDE_AFTER_MS);
  cursorListeners.forEach(listener => listener());
}

export const previewRemote: RemoteController = {
  move(dx, dy) {
    updateCursor({ x: clamp(cursor.x + dx / WALL_W), y: clamp(cursor.y + dy / WALL_H) });
  },
  click() {
    updateCursor({ clicks: cursor.clicks + 1 });
  },
  scroll() {},
  type() {},
  key() {},
  go() {},
  answer() {},
};

export function useRemoteCursor(): RemoteCursor {
  return useSyncExternalStore(
    listener => {
      cursorListeners.add(listener);
      return () => cursorListeners.delete(listener);
    },
    () => cursor,
  );
}

// ---- The real remote ----

export interface RemoteLink {
  /** checking: no answer yet; unavailable: the server can't reach the wall's browser. */
  state: 'checking' | 'ready' | 'unavailable' | 'offline';
  reason: RemoteUnavailableReason | null;
  /** The kind of text box selected on the wall, or null. */
  field: RemoteField | null;
  /** A website's question on the wall, waiting for OK or Cancel. */
  dialog: { message: string } | null;
  /** The wall shows the board, not another website. */
  onBoard: boolean;
  title: string;
  url: string;
}

/** Two-finger scrolling: page pixels per finger pixel. */
const SCROLL_GAIN = 2.5;
/** While the remote is open, what the wall shows is checked this often. */
const CHECK_MS = 3000;
/** A request may take this long (the wall's browser can be busy loading a page). */
const REQUEST_MS = 8000;

let link: RemoteLink = { state: 'checking', reason: null, field: null, dialog: null, onBoard: true, title: '', url: '' };
const linkListeners = new Set<() => void>();
let queue: RemoteCommand[] = [];
let sending = false;
let checking = false;
let lastAnswer = 0;
let followUps: Array<ReturnType<typeof setTimeout>> = [];

function setLink(next: Partial<RemoteLink>): void {
  link = { ...link, ...next };
  linkListeners.forEach(listener => listener());
}

function heard(status: RemoteStatus): void {
  lastAnswer = Date.now();
  if (status.available) setLink({ state: 'ready', reason: null, field: status.field, dialog: status.dialog, onBoard: status.onBoard, title: status.title, url: status.url });
  else setLink({ state: 'unavailable', reason: status.reason, field: null, dialog: null });
}

/** fetch with a time limit (an iPhone can leave a request hanging after the network changes). */
async function request(init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_MS);
  try {
    return await fetch(new URL('api/remote', document.baseURI), { cache: 'no-store', ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Takes in the server's answer: the wall's status, or why a command wasn't carried out. */
async function readAnswer(response: Response): Promise<void> {
  // The PIN is needed again: the board's own check brings up the PIN screen.
  if (response.status === 401) {
    void engine.refresh();
    return;
  }
  // Not JSON (a proxy's error page, say): nothing to take in.
  const body = (await response.json().catch(() => null)) as { available?: boolean; error?: string } | null;
  if (body && typeof body.available === 'boolean') heard(body as RemoteStatus);
  else if (response.status === 400 && body?.error) showToast({ text: body.error }, 5000);
}

/** Ask what the wall shows (and whether a text box there is selected). */
export async function checkRemote(): Promise<void> {
  if (checking || sending) return;
  checking = true;
  try {
    await readAnswer(await request());
  } catch {
    setLink({ state: 'offline', field: null, dialog: null });
  } finally {
    checking = false;
  }
}

function push(command: RemoteCommand): void {
  queueCommand(queue, command);
  void pump();
}

/** Sends what's queued, one request at a time. Input that can't be delivered is dropped, not replayed later. */
async function pump(): Promise<void> {
  if (sending || queue.length === 0) return;
  sending = true;
  const commands = queue.splice(0, MAX_REMOTE_COMMANDS);
  try {
    const response = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commands }) });
    await readAnswer(response);
    if (!response.ok) queue = [];
  } catch {
    queue = [];
    setLink({ state: 'offline', field: null, dialog: null });
  } finally {
    sending = false;
  }
  void pump();
}

/** A tap can select a text box a moment later (when the page opens a form), so look again shortly. */
function checkSoon(): void {
  followUps.forEach(clearTimeout);
  followUps = [400, 1200].map(ms => setTimeout(() => void checkRemote(), ms));
}

/** A long paste, in pieces a command can take (never splitting a character like an emoji). */
function pieces(text: string): string[] {
  const out: string[] = [];
  let piece = '';
  for (const char of text) {
    if (piece.length + char.length > MAX_REMOTE_TEXT) {
      out.push(piece);
      piece = '';
    }
    piece += char;
  }
  if (piece) out.push(piece);
  return out;
}

export const liveRemote: RemoteController = {
  move(dx, dy) {
    push({ type: 'move', dx, dy });
  },
  click() {
    push({ type: 'click' });
    checkSoon();
  },
  scroll(dx, dy) {
    push({ type: 'scroll', dx: -dx * SCROLL_GAIN, dy: -dy * SCROLL_GAIN });
  },
  type(text) {
    for (const piece of pieces(text)) push({ type: 'text', text: piece });
  },
  key(key) {
    push({ type: 'key', key });
    if (key === 'Tab' || key === 'Enter' || key === 'Escape') checkSoon();
  },
  go(place) {
    push(typeof place === 'string' ? { type: place } : { type: 'open', url: place.url });
    checkSoon();
  },
  answer(accept) {
    push({ type: 'dialog', accept });
    checkSoon();
  },
};

/** The real remote's connection, checked on open and every few seconds while it's showing. */
export function useRemoteLink(enabled: boolean): RemoteLink {
  useEffect(() => {
    if (!enabled) return;
    void checkRemote();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastAnswer > CHECK_MS - 500) void checkRemote();
    }, CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkRemote();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
  return useSyncExternalStore(
    listener => {
      linkListeners.add(listener);
      return () => linkListeners.delete(listener);
    },
    () => link,
  );
}
