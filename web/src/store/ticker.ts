import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { sampleTicker } from '../../../shared/sampleTicker.ts';
import type { TickerItem } from '../../../shared/ticker.ts';
import type { TickerSettings } from '../../../shared/types.ts';

export interface TickerFeed {
  items: TickerItem[];
  /** Made-up values (the preview page, which has no board server). */
  sample: boolean;
  /** The board server couldn't reach the sources for a while: when these values are from. */
  staleSince: string | null;
}

interface Snapshot {
  items: TickerItem[];
  updatedAt: string | null;
  stale: boolean;
}

let live: Snapshot = { items: [], updatedAt: null, stale: false };
const listeners = new Set<() => void>();

/** Fetch the latest prices and headlines from the board server. */
export async function refreshTicker(): Promise<void> {
  try {
    const response = await fetch(new URL('api/ticker', document.baseURI), { cache: 'no-store' });
    if (!response.ok) return;
    live = (await response.json()) as Snapshot;
    listeners.forEach(listener => listener());
  } catch {
    // Offline: keep showing what we have.
  }
}

function useLiveTicker(settings: TickerSettings): TickerFeed {
  const snapshot = useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => live,
  );
  // Fetch on first show and when the choices change (new ones follow when the server has them).
  const key = JSON.stringify(settings);
  useEffect(() => {
    void refreshTicker();
  }, [key]);
  return { items: snapshot.items, sample: false, staleSince: snapshot.stale ? snapshot.updatedAt : null };
}

function useSampleTicker(settings: TickerSettings): TickerFeed {
  // Keyed on the settings' contents: every board refresh brings a new (but equal) object.
  const key = JSON.stringify(settings);
  return useMemo(() => ({ items: sampleTicker(JSON.parse(key) as TickerSettings), sample: true, staleSince: null }), [key]);
}

/** What the wall's ticker shows for these settings. */
export const useTicker: (settings: TickerSettings) => TickerFeed = __DEMO_BUILD__ ? useSampleTicker : useLiveTicker;
