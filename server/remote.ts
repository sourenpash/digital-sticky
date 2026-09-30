import { REMOTE_FIELDS, REMOTE_WALL_WIDTH, type RemoteCommand, type RemoteField, type RemoteKey, type RemoteStatus, type RemoteUnavailableReason } from '../shared/remote.ts';
import { Cdp, CdpTimeout, type CdpEvent } from './cdp.ts';

// The phone remote: carries out touchpad moves, taps, typing and a few buttons in the
// wall computer's browser, through Chrome's DevTools protocol. The kiosk script
// (scripts/linux/kiosk.sh) starts the browser with a debugging port that Chrome only
// opens on this computer (127.0.0.1). That needs no special permissions and works the
// same under X11 and Wayland. Synthetic input doesn't move the real pointer, so the
// remote draws its own cursor on the page.
//
// It also looks after the wall: when the board's tab crashes or shows an error page
// (say the browser started before the server), it loads the board again.

/** A batch of commands stops after this long (a page that stopped answering holds everything up). */
const BATCH_MS = 4000;
/** How often the wall's page is checked (and the browser looked for, while it can't be reached). */
const WATCH_MS = 10_000;
/** A wall page that doesn't answer for this long is stuck (or crashed before the remote was watching). */
const STUCK_MS = 5000;
/** Taps closer together than this (in time and distance) make a double click. */
const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_PX = 12;
/** The cursor fades out this long after the last touch. */
const CURSOR_MS = 6000;
/** The remote's scripts run in their own world, where the page's scripts can't interfere. */
const WORLD = 'sticky-wall-remote';

/** A command couldn't be carried out: 400 for a bad request, 503 when the wall's browser can't be reached. */
export class RemoteError extends Error {
  readonly status: 400 | 503;
  readonly reason: RemoteUnavailableReason | null;
  constructor(status: 400 | 503, message: string, reason: RemoteUnavailableReason | null = null) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

const unreachable = () => new RemoteError(503, 'Can’t reach the wall’s browser', 'no-browser');

interface TargetInfo {
  targetId: string;
  type: string;
  subtype?: string;
  url: string;
  title: string;
}

interface Tab {
  id: string;
  url: string;
  title: string;
}

/** Real tabs only: not prerendered pages, DevTools windows, workers or extensions. */
function isTab(info: TargetInfo): boolean {
  return info.type === 'page' && !info.subtype && !info.url.startsWith('devtools://');
}

/**
 * Runs in the page (in the remote's own world): draws the cursor, and says which kind of
 * text box has the focus (if any) and what the page is. mode 0 only reports, 1 shows the cursor at (x, y),
 * 2 also shows a click. The cursor hangs off <html> (outside anything that moves), in a
 * closed shadow root, styled through the style object (which pages' security policies
 * allow), and in the top layer so it stays above full-screen video and pop-up dialogs.
 */
const PAGE_SCRIPT = `function (x, y, mode) {
  var doc = document, host = doc.getElementById('__sticky_wall_cursor__');
  if (mode > 0 && doc.documentElement) {
    if (host && !host.__sticky) { host.remove(); host = null; }
    if (!host) {
      host = doc.createElement('div');
      host.id = '__sticky_wall_cursor__';
      host.style.cssText = 'all:initial !important;display:block !important;position:fixed !important;inset:auto !important;left:0 !important;top:0 !important;width:0 !important;height:0 !important;margin:0 !important;padding:0 !important;border:0 !important;background:none !important;overflow:visible !important;z-index:2147483647 !important;pointer-events:none !important;visibility:visible !important;transition:opacity .4s !important;opacity:0';
      if (host.showPopover) host.setAttribute('popover', 'manual');
      var root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
      var ring = doc.createElement('div');
      ring.style.cssText = 'position:absolute;left:-24px;top:-24px;width:48px;height:48px;box-sizing:border-box;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.4);opacity:0';
      var ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg'), path = doc.createElementNS(ns, 'path');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '40');
      svg.setAttribute('height', '40');
      svg.style.cssText = 'position:absolute;left:-6.7px;top:-4.2px;overflow:visible;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))';
      path.setAttribute('d', 'M4 2.5 19.5 13l-7.2 1.3L8.6 21z');
      path.setAttribute('fill', '#111');
      path.setAttribute('stroke', '#fff');
      path.setAttribute('stroke-width', '1.6');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      root.appendChild(ring);
      root.appendChild(svg);
      host.__sticky = { ring: ring, timer: 0 };
      doc.documentElement.appendChild(host);
    }
    var state = host.__sticky;
    host.style.setProperty('transform', 'translate(' + x + 'px,' + y + 'px)', 'important');
    host.style.setProperty('opacity', '1', 'important');
    if (host.showPopover) {
      try {
        var open = host.matches(':popover-open');
        if (open && (doc.fullscreenElement || doc.querySelector(':modal'))) { host.hidePopover(); open = false; }
        if (!open) host.showPopover();
      } catch (e) {}
    }
    if (mode === 2 && state.ring.animate) {
      state.ring.animate([{ opacity: 1, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(1.4)' }], { duration: 500, easing: 'ease-out' });
    }
    clearTimeout(state.timer);
    state.timer = setTimeout(function () { host.style.setProperty('opacity', '0', 'important'); }, ${CURSOR_MS});
  }
  var el = doc.activeElement;
  for (var depth = 0; el && depth < 10; depth++) {
    if (el.shadowRoot && el.shadowRoot.activeElement) { el = el.shadowRoot.activeElement; continue; }
    var inner = null;
    if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
      try { inner = el.contentDocument && el.contentDocument.activeElement; } catch (e) {}
    }
    if (!inner) break;
    el = inner;
  }
  var field = null;
  if (el && !el.disabled && !el.readOnly) {
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) field = 'text';
    else if (el.tagName === 'INPUT') {
      var type = String(el.type || 'text').toLowerCase();
      if (/^(text|search|email|url|tel|password|number)$/.test(type)) field = type;
    }
  }
  return { field: field, title: String(doc.title), url: String(location.href) };
}`;

/** Keys the remote can press, with what Chrome needs to act on them like a real keyboard. */
const KEYS: Record<RemoteKey, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
};

/** A typed character as a key press, so website shortcuts (space to pause, say) work too. */
export function charKey(char: string): { key: string; code: string; keyCode: number; text: string } {
  if (char === ' ') return { key: ' ', code: 'Space', keyCode: 32, text: ' ' };
  if (/^[a-z]$/i.test(char)) return { key: char, code: `Key${char.toUpperCase()}`, keyCode: char.toUpperCase().charCodeAt(0), text: char };
  if (/^\d$/.test(char)) return { key: char, code: `Digit${char}`, keyCode: char.charCodeAt(0), text: char };
  return { key: char, code: '', keyCode: 0, text: char };
}

/** Whether an address may be opened on the wall: never the browser's own debugging port. */
export function openRefused(url: string, debugPort: number): boolean {
  try {
    const parsed = new URL(url);
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
    return port === debugPort;
  } catch {
    return true;
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** What the page script says about the page. */
interface PageInfo {
  field: RemoteField | null;
  title: string;
  url: string;
}

function readPageInfo(value: unknown): PageInfo | null {
  if (!value || typeof value !== 'object') return null;
  const { field, title, url } = value as Record<string, unknown>;
  return {
    field: (REMOTE_FIELDS as readonly unknown[]).includes(field) ? (field as RemoteField) : null,
    title: typeof title === 'string' ? title.slice(0, 200) : '',
    url: typeof url === 'string' ? url.slice(0, 2048) : '',
  };
}

export interface KioskRemoteOptions {
  /** The wall browser's debugging port on 127.0.0.1. */
  port: number;
  /** The wall screen's address, e.g. http://localhost:3000/#wall. */
  wallUrl: () => string;
  log?: (message: string) => void;
}

/** Drives the wall computer's browser for the phone remote, and keeps the wall's page working. */
export class KioskRemote {
  private readonly port: number;
  private readonly wallUrl: () => string;
  private readonly log: (message: string) => void;
  private cdp: Cdp | null = null;
  private connecting: Promise<Cdp> | null = null;
  /** Open tabs, oldest first; the last is the one showing (kiosk windows have no tab strip). */
  private tabs: Tab[] = [];
  private attached: { targetId: string; sessionId: string } | null = null;
  /** The remote's script world in the attached tab's current page. */
  private world: { sessionId: string; contextId: number } | null = null;
  /** An OK / Cancel question from the page, waiting for the phone. */
  private dialog: { sessionId: string; message: string; defaultText: string } | null = null;
  /** Calls waiting on input that a question just interrupted. */
  private readonly dialogWaiters = new Set<() => void>();
  /** Tabs whose page crashed ("Aw, Snap!"). */
  private readonly crashed = new Set<string>();
  private viewport = { width: REMOTE_WALL_WIDTH, height: 1080 };
  private cursor: { x: number; y: number } | null = null;
  private lastClick = { at: 0, x: 0, y: 0, count: 0 };
  private lastTouch = 0;
  private reachable: boolean | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** Everything runs one at a time, so two phones can't interleave their input. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor({ port, wallUrl, log = () => {} }: KioskRemoteOptions) {
    this.port = port;
    this.wallUrl = wallUrl;
    this.log = log;
  }

  /** Connects now and keeps checking (quietly) that the wall's page is working. */
  start(): void {
    const check = () => void this.serial(() => this.heal()).catch(() => {});
    check();
    this.watchTimer = setInterval(check, WATCH_MS);
    this.watchTimer.unref();
  }

  close(): void {
    this.stopped = true;
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.cdp?.close();
  }

  /** What the wall shows, and which text box there has the focus. */
  status(): Promise<RemoteStatus> {
    return this.serial(async () => {
      try {
        return await this.report(await this.session(), 0);
      } catch (error) {
        if (error instanceof RemoteError && error.reason) return { available: false, reason: error.reason };
        if (error instanceof CdpTimeout) return this.describe(null);
        throw error;
      }
    });
  }

  /** Carries out the phone's commands in order, then reports like `status()`. */
  run(commands: RemoteCommand[]): Promise<RemoteStatus> {
    return this.serial(async () => {
      const deadline = Date.now() + BATCH_MS;
      let pointer = 0;
      for (const command of commands) {
        if (Date.now() > deadline) break;
        try {
          pointer = Math.max(pointer, await this.carryOut(command));
        } catch (error) {
          if (error instanceof RemoteError) throw error;
          if (error instanceof CdpTimeout) {
            // The page stopped answering: drop the rest rather than wait on every command.
            // It may be showing a question that opened before the remote was watching,
            // which nothing else could answer: Cancel it (it errors harmlessly if there's none).
            if (!this.dialog && this.attached) await this.cdp?.send('Page.handleJavaScriptDialog', { accept: false }, this.attached.sessionId, 1000).catch(() => {});
            break;
          }
          // The tab went away in the middle: the next command attaches to the one showing.
          if (/session|target/i.test(String(error))) this.attached = null;
        }
      }
      return this.report(await this.session(), pointer);
    });
  }

  /** The status after a check or some commands (the page can't answer while it shows a question). */
  private async report(sessionId: string, mode: number): Promise<RemoteStatus> {
    if (this.dialog) return this.describe(null);
    try {
      return this.describe(await this.page(sessionId, mode));
    } catch {
      return this.describe(null);
    }
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => {});
    return result;
  }

  /** Returns 1 when the pointer moved, 2 for a click, so the cursor shows afterwards. */
  private async carryOut(command: RemoteCommand): Promise<number> {
    if (command.type === 'open' && openRefused(command.url, this.port)) throw new RemoteError(400, 'That address can’t be opened on the wall');
    const sessionId = await this.session();
    const cdp = this.cdp!;
    if (command.type === 'dialog') {
      await this.answer(command.accept);
      return 0;
    }
    // A page showing an OK / Cancel question takes no input until it's answered.
    if (this.dialog) {
      if (command.type !== 'board') return 0;
      await this.answer(false);
    }
    // Typing or a button between two taps means they aren't a double click.
    if (command.type !== 'click' && command.type !== 'move') this.lastClick.at = 0;
    switch (command.type) {
      case 'move': {
        const { x, y } = this.moveBy(command.dx, command.dy);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
        return 1;
      }
      case 'click':
        await this.click(sessionId);
        return 2;
      case 'scroll': {
        const { x, y } = this.moveBy(0, 0);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: command.dx, deltaY: command.dy }, sessionId);
        return 1;
      }
      case 'text':
        await this.type(sessionId, command.text);
        return 0;
      case 'key':
        await this.press(sessionId, KEYS[command.key], command.key);
        // A website's full screen only closes for an Escape the browser saw itself.
        if (command.key === 'Escape') await this.inPage(sessionId, 'document.fullscreenElement && document.exitFullscreen()').catch(() => null);
        return 0;
      case 'back':
        await this.back(sessionId);
        return 0;
      case 'reload':
        this.crashed.delete(this.tabs.at(-1)?.id ?? '');
        await cdp.send('Page.reload', {}, sessionId);
        return 0;
      case 'board':
        await this.board();
        return 0;
      case 'open':
        await this.open(command.url);
        return 0;
    }
  }

  /** Moves the cursor (in wall pixels, scaled to this screen), keeping it on the screen. */
  private moveBy(dx: number, dy: number): { x: number; y: number } {
    this.lastTouch = Date.now();
    return this.place(dx, dy);
  }

  private place(dx = 0, dy = 0): { x: number; y: number } {
    const scale = this.viewport.width / REMOTE_WALL_WIDTH;
    const { width, height } = this.viewport;
    const from = this.cursor ?? { x: width / 2, y: height / 2 };
    const x = Math.round(Math.min(width - 1, Math.max(0, from.x + dx * scale)));
    const y = Math.round(Math.min(height - 1, Math.max(0, from.y + dy * scale)));
    this.cursor = { x, y };
    return this.cursor;
  }

  private async click(sessionId: string): Promise<void> {
    const { x, y } = this.moveBy(0, 0);
    const now = Date.now();
    const last = this.lastClick;
    const count = now - last.at < DOUBLE_CLICK_MS && Math.hypot(x - last.x, y - last.y) < DOUBLE_CLICK_PX ? Math.min(3, last.count + 1) : 1;
    this.lastClick = { at: now, x, y, count };
    const cdp = this.cdp!;
    await this.input(cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: count }, sessionId));
    if (!this.dialog) await this.input(cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: count }, sessionId));
  }

  /**
   * Waits for the page to take some input, or for the question it opened in answer (the
   * input is only done once the question is answered, and that's up to the phone).
   */
  private input(call: Promise<unknown>): Promise<unknown> {
    let stop = () => {};
    const asked = new Promise(resolve => {
      stop = () => resolve(undefined);
      this.dialogWaiters.add(stop);
    });
    call.catch(() => {}); // it may only finish, or time out, after the question
    return Promise.race([call, asked]).finally(() => this.dialogWaiters.delete(stop));
  }

  /** Into a text box: inserted as is (any language, emoji). Elsewhere: key by key, for shortcuts. */
  private async type(sessionId: string, text: string): Promise<void> {
    const cdp = this.cdp!;
    const intoField = Boolean((await this.page(sessionId, 0))?.field);
    for (const [index, line] of text.split('\n').entries()) {
      if (index > 0) await this.press(sessionId, KEYS.Enter, 'Enter');
      if (!line) continue;
      if (intoField) {
        await cdp.send('Input.insertText', { text: line }, sessionId);
        continue;
      }
      for (const char of line) {
        const { key, ...rest } = charKey(char);
        await this.press(sessionId, rest, key);
      }
    }
  }

  private async press(sessionId: string, { code, keyCode, text }: { code: string; keyCode: number; text?: string }, key: string): Promise<void> {
    const cdp = this.cdp!;
    const common = { key, code, windowsVirtualKeyCode: keyCode };
    await this.input(cdp.send('Input.dispatchKeyEvent', text ? { type: 'keyDown', ...common, text, unmodifiedText: text } : { type: 'rawKeyDown', ...common }, sessionId));
    if (!this.dialog) await this.input(cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common }, sessionId));
  }

  private async answer(accept: boolean): Promise<void> {
    const dialog = this.dialog;
    if (!dialog) return;
    this.dialog = null;
    await this.cdp!.send('Page.handleJavaScriptDialog', accept ? { accept, promptText: dialog.defaultText } : { accept }, dialog.sessionId).catch(() => {});
  }

  /** Back a page; on a tab's first page (a website opened over the wall), close the tab. */
  private async back(sessionId: string): Promise<void> {
    const cdp = this.cdp!;
    const history = await cdp.send<{ currentIndex: number; entries: Array<{ id: number }> }>('Page.getNavigationHistory', {}, sessionId);
    const previous = history.entries[history.currentIndex - 1];
    if (previous) {
      await cdp.send('Page.navigateToHistoryEntry', { entryId: previous.id }, sessionId);
      return;
    }
    const current = this.tabs.at(-1);
    if (current && this.tabs.length > 1) {
      await cdp.send('Target.closeTarget', { targetId: current.id });
      this.forget(current.id);
      await this.showTop();
    }
  }

  /** Back to the wall screen: other tabs closed, and the board's tab showing #wall. */
  private async board(): Promise<void> {
    const cdp = this.cdp!;
    const keep = this.tabs.find(tab => this.isBoard(tab.url)) ?? this.tabs[0];
    if (!keep) throw unreachable();
    for (const tab of [...this.tabs]) {
      if (tab.id === keep.id) continue;
      await cdp.send('Target.closeTarget', { targetId: tab.id }).catch(() => {});
      this.forget(tab.id);
    }
    await this.showTop();
    await this.loadWall(false);
  }

  /** A website in a new tab over the wall, so the board keeps running (and Back or Board comes back to it at once). */
  private async open(url: string): Promise<void> {
    const cdp = this.cdp!;
    const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url });
    const existing = this.tabs.find(tab => tab.id === targetId);
    this.tabs = [...this.tabs.filter(tab => tab.id !== targetId), existing ?? { id: targetId, url, title: '' }];
    await this.showTop();
  }

  /** Brings the tab the remote now drives to the front. */
  private async showTop(): Promise<void> {
    const top = this.tabs.at(-1);
    if (top) await this.cdp!.send('Target.activateTarget', { targetId: top.id }).catch(() => {});
  }

  /**
   * Makes the tab showing the wall screen, loading it again if it's elsewhere in the board,
   * crashed, or stuck on an error page. `onlyIfBroken` leaves a working page alone.
   */
  private async loadWall(onlyIfBroken: boolean): Promise<void> {
    const top = this.tabs.at(-1);
    if (!top) return;
    const sessionId = await this.session();
    const cdp = this.cdp!;
    const wall = this.wallUrl();
    // A crashed page answers nothing; an error page keeps the address it couldn't load.
    let broken = this.crashed.has(top.id);
    if (!broken) {
      try {
        const { frameTree } = await cdp.send<{ frameTree: { frame: { unreachableUrl?: string } } }>('Page.getFrameTree', {}, sessionId, STUCK_MS);
        broken = Boolean(frameTree.frame.unreachableUrl);
      } catch (error) {
        if (!(error instanceof CdpTimeout)) throw error;
        broken = true;
      }
    }
    const atWall = this.isBoard(top.url) && new URL(top.url).hash === new URL(wall).hash;
    if (broken || (!onlyIfBroken && !atWall)) {
      this.crashed.delete(top.id);
      this.world = null;
      if (broken) this.log('Remote control: the wall’s page wasn’t working, so it was loaded again.');
      await cdp.send('Page.navigate', { url: wall }, sessionId);
    }
  }

  /** The watchdog: when the tab showing is the board and it crashed or failed to load, load it again. */
  private async heal(): Promise<void> {
    if (this.stopped) return;
    await this.connection();
    const top = this.tabs.at(-1);
    if (top && (this.isBoard(top.url) || this.crashed.has(top.id))) await this.loadWall(true);
  }

  /** Runs the page script (see PAGE_SCRIPT); null when the page can't answer. */
  private async page(sessionId: string, mode: number): Promise<PageInfo | null> {
    const { x, y } = this.cursor ?? { x: Math.round(this.viewport.width / 2), y: Math.round(this.viewport.height / 2) };
    const [info] = await Promise.all([this.inPage(sessionId, `(${PAGE_SCRIPT})(${x}, ${y}, ${mode})`), this.measure(sessionId)]);
    return readPageInfo(info);
  }

  /** Evaluates in the remote's own world in the page, making it again when the page has moved on. */
  private async inPage(sessionId: string, expression: string): Promise<unknown> {
    const cdp = this.cdp!;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (this.world?.sessionId !== sessionId) {
          const { frameTree } = await cdp.send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree', {}, sessionId);
          const { executionContextId } = await cdp.send<{ executionContextId: number }>('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: WORLD }, sessionId);
          this.world = { sessionId, contextId: executionContextId };
        }
        const reply = await cdp.send<{ result?: { value?: unknown } }>('Runtime.evaluate', { expression, contextId: this.world.contextId, returnByValue: true, silent: true }, sessionId, 1500);
        return reply.result?.value ?? null;
      } catch (error) {
        if (error instanceof CdpTimeout) throw error;
        this.world = null;
      }
    }
    return null;
  }

  /** The page's size, from the browser (a page could lie about it). */
  private async measure(sessionId: string): Promise<void> {
    try {
      const metrics = await this.cdp!.send<{ cssLayoutViewport?: { clientWidth: number; clientHeight: number } }>('Page.getLayoutMetrics', {}, sessionId, 1500);
      const size = metrics.cssLayoutViewport;
      if (size && size.clientWidth > 0 && size.clientHeight > 0) this.viewport = { width: size.clientWidth, height: size.clientHeight };
    } catch {
      // Keep the last size.
    }
  }

  /**
   * The status for the phone. The page's own word (from the remote's world, where the
   * page's scripts can't reach) is preferred: the browser's tab list updates titles late,
   * and an error page keeps the address it couldn't load.
   */
  private describe(info: PageInfo | null): RemoteStatus {
    const tab = this.tabs.at(-1);
    return {
      available: true,
      field: info?.field ?? null,
      dialog: this.dialog ? { message: this.dialog.message } : null,
      onBoard: this.isBoard(info?.url || tab?.url || ''),
      title: info?.title || tab?.title || '',
      url: (tab?.url || info?.url || '').slice(0, 500),
    };
  }

  /** Whether an address is this board (at localhost or 127.0.0.1, on its port). */
  private isBoard(url: string): boolean {
    try {
      const page = new URL(url);
      const wall = new URL(this.wallUrl());
      return page.protocol === 'http:' && LOOPBACK.has(page.hostname) && page.port === wall.port;
    } catch {
      return false;
    }
  }

  /** The DevTools session for the tab that's showing, attaching (and connecting) when needed. */
  private async session(): Promise<string> {
    const cdp = await this.connection();
    const active = this.tabs.at(-1);
    if (!active) throw unreachable();
    if (this.attached?.targetId === active.id) return this.attached.sessionId;
    const previous = this.attached;
    this.attached = null;
    this.world = null;
    if (previous) void cdp.send('Target.detachFromTarget', { sessionId: previous.sessionId }).catch(() => {});
    let sessionId: string;
    try {
      ({ sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: active.id, flatten: true }));
    } catch {
      this.forget(active.id);
      throw unreachable();
    }
    this.attached = { targetId: active.id, sessionId };
    // Page events: new pages loading (to draw the cursor again) and dialogs. (A crashed
    // page doesn't answer, so these don't wait long.)
    await cdp.send('Page.enable', {}, sessionId, 1500).catch(() => {});
    if (!this.crashed.has(active.id)) await this.measure(sessionId);
    if (this.cursor) this.place(); // keep it on this screen
    return sessionId;
  }

  private connection(): Promise<Cdp> {
    if (this.cdp && !this.cdp.closed) return Promise.resolve(this.cdp);
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<Cdp> {
    let cdp: Cdp | null = null;
    try {
      const opened = await Cdp.connect(this.port);
      cdp = opened;
      opened.onClose = () => {
        if (this.cdp !== opened) return;
        this.cdp = null;
        this.attached = null;
        this.world = null;
        this.dialog = null;
        this.tabs = [];
      };
      const { targetInfos } = await opened.send<{ targetInfos: TargetInfo[] }>('Target.getTargets');
      // The list tends to put the newest tab first (a tab opened over the others is the one showing).
      this.tabs = [];
      for (const info of [...targetInfos].reverse()) this.track(info);
      await this.findShowing(opened);
      opened.onEvent = event => this.onEvent(opened, event);
      await opened.send('Target.setDiscoverTargets', { discover: true });
    } catch {
      cdp?.close();
      if (this.reachable !== false) this.log(`Remote control: can’t reach the wall’s browser on port ${this.port} (the wall screen starts it: scripts/linux/kiosk.sh).`);
      this.reachable = false;
      throw unreachable();
    }
    if (this.reachable !== true) this.log('Remote control: connected to the wall’s browser.');
    this.reachable = true;
    this.cdp = cdp;
    this.attached = null;
    this.world = null;
    return cdp;
  }

  /** With several tabs open, put the one on screen last. The browser's list doesn't say, so ask each page. */
  private async findShowing(cdp: Cdp): Promise<void> {
    if (this.tabs.length < 2) return;
    for (const tab of this.tabs) {
      try {
        const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: tab.id, flatten: true });
        const reply = await cdp.send<{ result?: { value?: unknown } }>('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true }, sessionId, 1000);
        await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
        if (reply.result?.value === 'visible') {
          this.tabs = [...this.tabs.filter(other => other.id !== tab.id), tab];
          return;
        }
      } catch {
        // Can't tell for this one; try the next.
      }
    }
  }

  private onEvent(cdp: Cdp, { method, params, sessionId }: CdpEvent): void {
    if (this.cdp !== cdp) return;
    switch (method) {
      case 'Target.targetCreated':
      case 'Target.targetInfoChanged':
        this.track(params.targetInfo as TargetInfo);
        break;
      case 'Target.targetDestroyed':
        this.forget(params.targetId as string);
        break;
      case 'Target.targetCrashed':
        this.crashed.add(params.targetId as string);
        void this.serial(() => this.heal()).catch(() => {});
        break;
      case 'Target.detachedFromTarget':
        if (this.attached?.sessionId === params.sessionId) {
          this.attached = null;
          this.world = null;
        }
        break;
      case 'Page.javascriptDialogOpening':
        if (!sessionId) break;
        // A message or "leave this page?" just goes on; a question waits for the phone.
        if (params.type === 'confirm' || params.type === 'prompt') {
          this.dialog = { sessionId, message: String(params.message ?? '').slice(0, 300), defaultText: String(params.defaultPrompt ?? '') };
          for (const stop of this.dialogWaiters) stop();
        } else {
          void cdp.send('Page.handleJavaScriptDialog', { accept: true }, sessionId).catch(() => {});
        }
        break;
      case 'Page.javascriptDialogClosed':
        if (this.dialog?.sessionId === sessionId) this.dialog = null;
        break;
      case 'Page.frameNavigated': {
        const frame = params.frame as { parentId?: string } | undefined;
        if (!sessionId || sessionId !== this.attached?.sessionId || frame?.parentId) break;
        // A new page: the remote's world went with the old one. Pages restored from the
        // back/forward cache don't fire a load event, so draw the cursor here for those.
        this.world = null;
        if (params.type === 'BackForwardCacheRestore') this.redraw(sessionId);
        break;
      }
      case 'Page.loadEventFired':
        if (sessionId && sessionId === this.attached?.sessionId) this.redraw(sessionId);
        break;
    }
  }

  /** A new page came up under the cursor: draw it again if the remote is in use. */
  private redraw(sessionId: string): void {
    if (Date.now() - this.lastTouch < CURSOR_MS) void this.serial(() => this.page(sessionId, 1)).catch(() => {});
  }

  private track(info: TargetInfo): void {
    const index = this.tabs.findIndex(tab => tab.id === info.targetId);
    if (!isTab(info)) {
      if (index >= 0) this.forget(info.targetId);
    } else if (index >= 0) {
      this.tabs[index] = { id: info.targetId, url: info.url, title: info.title };
    } else {
      this.tabs.push({ id: info.targetId, url: info.url, title: info.title });
    }
  }

  private forget(targetId: string): void {
    this.tabs = this.tabs.filter(tab => tab.id !== targetId);
    this.crashed.delete(targetId);
    if (this.attached?.targetId === targetId) {
      this.attached = null;
      this.world = null;
      this.dialog = null;
    }
  }
}
