import { useMemo } from 'react';
import { sampleTicker } from '../../../shared/sampleTicker.ts';
import type { TickerItem } from '../../../shared/ticker.ts';
import type { TickerSettings } from '../../../shared/types.ts';

export interface TickerFeed {
  items: TickerItem[];
  /** Made-up values (live prices and headlines come from the board server in the next step). */
  sample: boolean;
}

/** What the wall's ticker shows for these settings. */
export function useTicker(settings: TickerSettings): TickerFeed {
  // Keyed on the settings' contents: every board refresh brings a new (but equal) object.
  const key = JSON.stringify(settings);
  return useMemo(() => ({ items: sampleTicker(JSON.parse(key) as TickerSettings), sample: true }), [key]);
}
