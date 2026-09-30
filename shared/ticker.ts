// The ticker along the bottom of the wall: crypto and stock prices, and tech headlines.

export const NEWS_SOURCES = [
  { id: 'hn', label: 'Hacker News', tag: 'HN', feed: 'https://hnrss.org/frontpage' },
  { id: 'verge', label: 'The Verge', tag: 'Verge', feed: 'https://www.theverge.com/rss/index.xml' },
  { id: 'ars', label: 'Ars Technica', tag: 'Ars', feed: 'https://feeds.arstechnica.com/arstechnica/index' },
  { id: 'techcrunch', label: 'TechCrunch', tag: 'TechCrunch', feed: 'https://techcrunch.com/feed/' },
] as const;

export type NewsSourceId = (typeof NEWS_SOURCES)[number]['id'];
export const NEWS_SOURCE_IDS = NEWS_SOURCES.map(source => source.id) as NewsSourceId[];

export const CRYPTO_SYMBOL = /^[A-Z0-9-]{1,24}$/;
export const STOCK_SYMBOL = /^[A-Z0-9.^=-]{1,12}$/;
export const MAX_CRYPTO = 12;
export const MAX_STOCKS = 20;
export const MAX_NEWS = 8;

export type TickerItem =
  | { kind: 'price'; group: 'crypto' | 'stock'; symbol: string; price: number; /** Percent over the last day. */ change: number }
  | { kind: 'headline'; source: string; title: string };

/** "$63,120", "$227.50", "$0.1242". */
export function formatPrice(price: number): string {
  if (price >= 1000) return `$${Math.round(price).toLocaleString('en-US')}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toPrecision(3)}`;
}

/** "▲1.2%", "▼0.4%". */
export function formatChange(change: number): string {
  const size = `${Math.abs(change).toFixed(1)}%`;
  return change > 0.05 ? `▲${size}` : change < -0.05 ? `▼${size}` : size;
}

/** A news entry as a short tag: "HN", or the site of a custom feed. */
export function newsTag(entry: string): string {
  const preset = NEWS_SOURCES.find(source => source.id === entry);
  if (preset) return preset.tag;
  try {
    return new URL(entry).hostname.replace(/^(www|feeds?|rss)\./, '');
  } catch {
    return entry;
  }
}
