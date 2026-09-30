import { Cdp } from '../server/cdp.ts';

// Looks into the kiosk browser (the wall computer's own browser) from a test, through
// its debugging port, the same way the board server does.

export interface KioskTab {
  id: string;
  url: string;
  title: string;
}

export class KioskProbe {
  readonly port: number;

  constructor(port: number) {
    this.port = port;
  }

  /** The browser's tabs, newest first. */
  async tabs(): Promise<KioskTab[]> {
    const response = await fetch(`http://127.0.0.1:${this.port}/json/list`);
    const targets = (await response.json()) as Array<{ id: string; type: string; url: string; title: string }>;
    return targets.filter(target => target.type === 'page').map(({ id, url, title }) => ({ id, url, title }));
  }

  /** The tab whose address matches, or the newest one. */
  async tab(match?: (url: string) => boolean): Promise<KioskTab> {
    const tabs = await this.tabs();
    const tab = match ? tabs.find(t => match(t.url)) : tabs[0];
    if (!tab) throw new Error('No such tab in the kiosk browser');
    return tab;
  }

  /** Sends a DevTools command to a tab (the newest, unless `match` picks one). */
  async send<T = Record<string, unknown>>(method: string, params: object = {}, match?: (url: string) => boolean, wait = true): Promise<T | null> {
    const tab = await this.tab(match);
    const cdp = await Cdp.connect(this.port);
    try {
      const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: tab.id, flatten: true });
      const reply = cdp.send<T>(method, params, sessionId);
      if (!wait) {
        reply.catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 200));
        return null;
      }
      return await reply;
    } finally {
      cdp.close();
    }
  }

  /** Evaluates `expression` in a tab's page. */
  async evaluate<T>(expression: string, match?: (url: string) => boolean): Promise<T> {
    const reply = await this.send<{ result?: { value?: unknown }; exceptionDetails?: { text?: string } }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, match);
    if (reply?.exceptionDetails) throw new Error(`In the kiosk page: ${reply.exceptionDetails.text ?? 'error'}`);
    return reply?.result?.value as T;
  }
}
