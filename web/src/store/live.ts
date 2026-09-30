import type { ChangeEvent, ConnectEvent, HelloEvent } from '../../../shared/api.ts';
import type { SyncEngine } from './sync.ts';

/** No message (not even the 20-second ping) for this long means the connection died quietly. */
const SILENT_MS = 45_000;

/**
 * Opens the live-update connection and keeps it healthy. iPhones drop background
 * connections without telling the page, so coming back to the page, getting back
 * online, or a long silence all reconnect and fetch the board again.
 */
export interface LiveHandlers {
  onReloadRequest: () => void;
  /** The server has new ticker prices or headlines. */
  onTicker?: () => void;
}

export function startLiveUpdates(engine: SyncEngine, { onReloadRequest, onTicker }: LiveHandlers, url = 'api/events'): () => void {
  let source: EventSource | null = null;
  let lastHeard = Date.now();
  let reopenTimer: ReturnType<typeof setTimeout> | null = null;

  const heard = () => {
    lastHeard = Date.now();
  };

  const locked = () => engine.getState().status === 'locked';

  const open = () => {
    if (reopenTimer) clearTimeout(reopenTimer);
    reopenTimer = null;
    source?.close();
    source = null;
    heard();
    if (locked()) return; // reopened once this device is signed in
    const es = new EventSource(new URL(url, document.baseURI));
    source = es;
    es.addEventListener('hello', event => {
      heard();
      engine.handleHello(JSON.parse((event as MessageEvent<string>).data) as HelloEvent);
    });
    es.addEventListener('change', event => {
      heard();
      engine.handleChange(JSON.parse((event as MessageEvent<string>).data) as ChangeEvent);
    });
    es.addEventListener('ping', heard);
    es.addEventListener('reload', () => {
      heard();
      onReloadRequest();
    });
    es.addEventListener('ticker', () => {
      heard();
      onTicker?.();
    });
    es.addEventListener('connect', event => {
      heard();
      engine.setConnectUrl((JSON.parse((event as MessageEvent<string>).data) as ConnectEvent).connectUrl);
    });
    es.onerror = () => {
      engine.setStreamUp(false);
      // The browser retries by itself, unless the server answered with an error (a
      // restart, or "enter the PIN"). Ask the server which, then try again.
      if (es.readyState === EventSource.CLOSED && source === es) {
        void engine.refresh().then(() => {
          if (source === es && !locked()) reopenTimer = setTimeout(open, 3000);
        });
      }
    };
  };

  const reconnect = () => {
    open();
    void engine.refresh();
    engine.retryNow();
  };

  const watchdog = setInterval(() => {
    if (!locked() && Date.now() - lastHeard > SILENT_MS) reconnect();
  }, 10_000);

  // Signed in (here or in another tab of this browser): open the live connection again.
  let wasLocked = locked();
  const unsubscribe = engine.subscribe(() => {
    const now = locked();
    if (wasLocked && !now) open();
    wasLocked = now;
  });

  const onVisibility = () => {
    if (document.visibilityState === 'visible') reconnect();
    else engine.flush();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) reconnect();
  };
  const onPageHide = () => engine.flushOnExit();

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('online', reconnect);

  void engine.refresh();
  open();

  return () => {
    unsubscribe();
    clearInterval(watchdog);
    if (reopenTimer) clearTimeout(reopenTimer);
    source?.close();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('online', reconnect);
  };
}
