import type { ChangeEvent, HelloEvent } from '../../../shared/api.ts';
import type { SyncEngine } from './sync.ts';

/** No message (not even the 20-second ping) for this long means the connection died quietly. */
const SILENT_MS = 45_000;

/**
 * Opens the live-update connection and keeps it healthy. iPhones drop background
 * connections without telling the page, so coming back to the page, getting back
 * online, or a long silence all reconnect and fetch the board again.
 */
export function startLiveUpdates(engine: SyncEngine, { onReloadRequest }: { onReloadRequest: () => void }, url = 'api/events'): () => void {
  let source: EventSource | null = null;
  let lastHeard = Date.now();
  let reopenTimer: ReturnType<typeof setTimeout> | null = null;

  const heard = () => {
    lastHeard = Date.now();
  };

  const open = () => {
    if (reopenTimer) clearTimeout(reopenTimer);
    reopenTimer = null;
    source?.close();
    heard();
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
    es.onerror = () => {
      engine.setStreamUp(false);
      // The browser retries by itself, unless the server answered with an error page.
      if (es.readyState === EventSource.CLOSED && source === es) reopenTimer = setTimeout(open, 3000);
    };
  };

  const reconnect = () => {
    open();
    void engine.refresh();
    engine.retryNow();
  };

  const watchdog = setInterval(() => {
    if (Date.now() - lastHeard > SILENT_MS) reconnect();
  }, 10_000);

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
    clearInterval(watchdog);
    if (reopenTimer) clearTimeout(reopenTimer);
    source?.close();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('online', reconnect);
  };
}
