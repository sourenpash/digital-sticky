import { newsTag, type TickerItem } from './ticker.ts';
import type { TickerSettings } from './types.ts';

// Made-up prices and headlines, so the ticker can be seen before it's connected to
// live sources (and on the preview page, which has no server).

const PRICES: Record<string, [price: number, change: number]> = {
  BTC: [63_120, 1.2],
  ETH: [2451, -0.4],
  SOL: [148.2, 3.1],
  DOGE: [0.1242, -1.8],
  AAPL: [227.5, 0.8],
  NVDA: [131.2, 2.1],
  MSFT: [431.6, -0.3],
  GOOGL: [167.4, 0.5],
  AMZN: [186.9, 1.1],
  TSLA: [248.3, -2.4],
  META: [572.1, 0.9],
};

const HEADLINES: Record<string, string[]> = {
  hn: ['Show HN: A tiny job queue built on SQLite', 'Ask HN: How do you keep a paper notebook and a to-do app in sync?'],
  verge: ['The best budget monitors for a home office', 'E-ink tablets are finally getting color screens worth using'],
  ars: ['Researchers shrink a solar cell to the size of a grain of rice', 'Why your router needs a firmware update this month'],
  techcrunch: ['Startups that help researchers find grants raise new rounds', 'A new open-source font designed for low-vision readers'],
};

/** A stable made-up price for a symbol the table doesn't know. */
function madeUp(symbol: string): [number, number] {
  let hash = 0;
  for (const ch of symbol) hash = (hash * 31 + ch.charCodeAt(0)) % 100_000;
  return [20 + (hash % 480) + (hash % 100) / 100, ((hash % 61) - 30) / 10];
}

export function sampleTicker(settings: TickerSettings): TickerItem[] {
  const price = (group: 'crypto' | 'stock') => (symbol: string): TickerItem => {
    const [value, change] = PRICES[symbol] ?? madeUp(symbol);
    return { kind: 'price', group, symbol, price: value, change };
  };
  const news = settings.news.flatMap(entry =>
    (HEADLINES[entry] ?? [`Latest headlines from ${newsTag(entry)}`]).map((title): TickerItem => ({ kind: 'headline', source: newsTag(entry), title })),
  );
  return [...settings.crypto.map(price('crypto')), ...settings.stocks.map(price('stock')), ...news];
}
