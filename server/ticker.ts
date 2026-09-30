import { NEWS_SOURCES, newsTag, type TickerItem } from '../shared/ticker.ts';
import type { TickerSettings } from '../shared/types.ts';
import type { BoardStore } from './store.ts';

// Live prices and headlines for the wall's ticker. The board server fetches them (so
// phones and the wall never talk to these sites) and keeps them in memory; the wall
// asks for them at GET /api/ticker when told there's something new.
//
// Free sources that need no account: CoinGecko for crypto, Yahoo Finance's public
// chart feed for stocks (prices can be ~15 minutes behind), and each site's RSS or
// Atom feed for headlines.

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface TickerSnapshot {
  items: TickerItem[];
  /** When the oldest value shown was fetched. */
  updatedAt: string | null;
  /** Some values are more than half an hour old (the sources can't be reached). */
  stale: boolean;
}

const PRICES_EVERY_MS = 5 * 60_000;
const NEWS_EVERY_MS = 15 * 60_000;
const AFTER_CHANGE_MS = 2000;
const STALE_AFTER_MS = 30 * 60_000;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1_000_000;
const HEADLINES_PER_FEED = 5;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** The coins people know by symbol; anything else is tried as a CoinGecko id ("bitcoin"). */
const COIN_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  XRP: 'ripple',
  LTC: 'litecoin',
  DOT: 'polkadot',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  BNB: 'binancecoin',
  TRX: 'tron',
  SHIB: 'shiba-inu',
  XLM: 'stellar',
  ATOM: 'cosmos',
  UNI: 'uniswap',
  USDC: 'usd-coin',
  USDT: 'tether',
};

export const coinId = (symbol: string): string => COIN_IDS[symbol] ?? symbol.toLowerCase();

interface Quote {
  price: number;
  /** Percent over the last day. */
  change: number;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** CoinGecko `simple/price?vs_currencies=usd&include_24hr_change=true`: `{ bitcoin: { usd, usd_24h_change } }`. */
export function parseCoinGecko(json: unknown, symbols: string[]): Map<string, Quote> {
  const quotes = new Map<string, Quote>();
  if (!json || typeof json !== 'object') return quotes;
  for (const symbol of symbols) {
    const entry = (json as Record<string, { usd?: unknown; usd_24h_change?: unknown }>)[coinId(symbol)];
    if (entry && isNumber(entry.usd)) quotes.set(symbol, { price: entry.usd, change: isNumber(entry.usd_24h_change) ? entry.usd_24h_change : 0 });
  }
  return quotes;
}

/** Yahoo `v8/finance/chart/SYM`: today's price against yesterday's close. */
export function parseYahooChart(json: unknown): Quote | null {
  const meta = (json as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> } } | null)?.chart?.result?.[0]?.meta;
  if (!meta || !isNumber(meta.regularMarketPrice)) return null;
  const price = meta.regularMarketPrice;
  const previous = isNumber(meta.chartPreviousClose) ? meta.chartPreviousClose : isNumber(meta.previousClose) ? meta.previousClose : null;
  return { price, change: previous ? ((price - previous) / previous) * 100 : 0 };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? match;
    const point = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    try {
      return String.fromCodePoint(point);
    } catch {
      return match;
    }
  });
}

/** The first headlines of an RSS or Atom feed, as plain text. */
export function parseFeedTitles(xml: string, max = HEADLINES_PER_FEED): string[] {
  const titles: string[] = [];
  for (const [block] of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const match = block.match(/<title\b([^>]*)>([\s\S]*?)<\/title>/i);
    if (!match) continue;
    let title = decodeEntities((match[2] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
    // Atom titles marked type="html" are escaped HTML: unescape once more, then drop the tags.
    if (/type\s*=\s*["']html["']/i.test(match[1] ?? '')) title = decodeEntities(title.replace(/<[^>]+>/g, ''));
    title = title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (title) titles.push(title);
    if (titles.length >= max) break;
  }
  return titles;
}

async function fetchText(fetcher: Fetcher, url: string, accept: string): Promise<string> {
  const response = await fetcher(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: accept },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('response too big');
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error('response too big');
  return text;
}

function feedUrl(entry: string): string {
  return NEWS_SOURCES.find(source => source.id === entry)?.feed ?? entry;
}

export interface TickerFeedOptions {
  fetcher?: Fetcher;
  log?: (message: string) => void;
  now?: () => number;
}

export class TickerFeed {
  private readonly store: BoardStore;
  private readonly fetcher: Fetcher;
  private readonly log: (message: string) => void;
  private readonly now: () => number;
  private readonly prices = new Map<string, { quote: Quote; at: number }>();
  private readonly headlines = new Map<string, { titles: string[]; at: number }>();
  private readonly failing = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private soon: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastSettings = '';

  constructor(store: BoardStore, { fetcher = fetch, log = () => {}, now = Date.now }: TickerFeedOptions = {}) {
    this.store = store;
    this.fetcher = fetcher;
    this.log = log;
    this.now = now;
  }

  private get settings(): TickerSettings {
    return this.store.board.settings.ticker;
  }

  start(): void {
    this.lastSettings = JSON.stringify(this.settings);
    this.unsubscribe = this.store.subscribe(() => {
      const next = JSON.stringify(this.settings);
      if (next === this.lastSettings) return;
      this.lastSettings = next;
      this.emit(); // what's shown changes at once (a removed symbol goes); new ones follow
      if (this.soon) clearTimeout(this.soon);
      this.soon = setTimeout(() => void this.refresh(), AFTER_CHANGE_MS);
      this.soon.unref?.();
    });
    const every = (ms: number, run: () => Promise<void>) => {
      const timer = setInterval(() => void run(), ms);
      timer.unref?.();
      this.timers.push(timer);
    };
    every(PRICES_EVERY_MS, () => this.refreshPrices());
    every(NEWS_EVERY_MS, () => this.refreshNews());
    void this.refresh();
  }

  stop(): void {
    this.unsubscribe?.();
    this.timers.forEach(clearInterval);
    this.timers = [];
    if (this.soon) clearTimeout(this.soon);
    this.listeners.clear();
  }

  /** Called when there's something new to show. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  async refresh(): Promise<void> {
    await Promise.all([this.refreshPrices(), this.refreshNews()]);
  }

  async refreshPrices(): Promise<void> {
    const { show, crypto, stocks } = this.settings;
    if (!show) return;
    const jobs: Array<Promise<boolean>> = [];
    if (crypto.length) jobs.push(this.attempt('crypto prices', () => this.fetchCrypto(crypto)));
    for (const symbol of stocks) jobs.push(this.attempt(`the price of ${symbol}`, () => this.fetchStock(symbol)));
    if ((await Promise.all(jobs)).some(Boolean)) this.emit();
  }

  async refreshNews(): Promise<void> {
    const { show, news } = this.settings;
    if (!show) return;
    const results = await Promise.all(news.map(entry => this.attempt(`headlines from ${newsTag(entry)}`, () => this.fetchFeed(entry))));
    if (results.some(Boolean)) this.emit();
  }

  /** Runs one fetch; logs when a source starts failing (not every five minutes after). */
  private async attempt(what: string, run: () => Promise<void>): Promise<boolean> {
    try {
      await run();
      if (this.failing.delete(what)) this.log(`Ticker: ${what} is back.`);
      return true;
    } catch (error) {
      if (!this.failing.has(what)) {
        this.failing.add(what);
        this.log(`Ticker: couldn't get ${what} (${error instanceof Error ? error.message : String(error)}). Showing the last ones.`);
      }
      return false;
    }
  }

  private async fetchCrypto(symbols: string[]): Promise<void> {
    const ids = [...new Set(symbols.map(coinId))].join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`;
    const quotes = parseCoinGecko(JSON.parse(await fetchText(this.fetcher, url, 'application/json')), symbols);
    if (quotes.size === 0) throw new Error('no prices in the answer');
    const at = this.now();
    for (const [symbol, quote] of quotes) this.prices.set(`crypto:${symbol}`, { quote, at });
  }

  private async fetchStock(symbol: string): Promise<void> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    const quote = parseYahooChart(JSON.parse(await fetchText(this.fetcher, url, 'application/json')));
    if (!quote) throw new Error('no price in the answer');
    this.prices.set(`stock:${symbol}`, { quote, at: this.now() });
  }

  private async fetchFeed(entry: string): Promise<void> {
    const titles = parseFeedTitles(await fetchText(this.fetcher, feedUrl(entry), 'application/rss+xml, application/atom+xml, application/xml, text/xml'));
    if (titles.length === 0) throw new Error('no headlines in the feed');
    this.headlines.set(entry, { titles, at: this.now() });
  }

  /** What the ticker shows now: the chosen coins, stocks and feeds, in that order. */
  snapshot(): TickerSnapshot {
    const { show, crypto, stocks, news } = this.settings;
    if (!show) return { items: [], updatedAt: null, stale: false };
    const items: TickerItem[] = [];
    const times: number[] = [];
    const price = (group: 'crypto' | 'stock') => (symbol: string) => {
      const found = this.prices.get(`${group}:${symbol}`);
      if (!found) return;
      items.push({ kind: 'price', group, symbol, price: found.quote.price, change: found.quote.change });
      times.push(found.at);
    };
    crypto.forEach(price('crypto'));
    stocks.forEach(price('stock'));
    for (const entry of news) {
      const found = this.headlines.get(entry);
      if (!found) continue;
      for (const title of found.titles) items.push({ kind: 'headline', source: newsTag(entry), title });
      times.push(found.at);
    }
    const oldest = times.length ? Math.min(...times) : null;
    return {
      items,
      updatedAt: oldest === null ? null : new Date(oldest).toISOString(),
      stale: oldest !== null && this.now() - oldest > STALE_AFTER_MS,
    };
  }
}
