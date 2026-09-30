import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeTickerFetch } from '../e2e/tickerFixtures.ts';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { BoardStore } from './store.ts';
import { coinId, parseCoinGecko, parseFeedTitles, parseYahooChart, TickerFeed, type Fetcher } from './ticker.ts';

describe('parsers', () => {
  it('reads CoinGecko prices by symbol', () => {
    const quotes = parseCoinGecko({ bitcoin: { usd: 63120.4, usd_24h_change: 1.24 }, dogecoin: { usd: 0.12 } }, ['BTC', 'DOGE', 'ETH']);
    expect(quotes.get('BTC')).toEqual({ price: 63120.4, change: 1.24 });
    expect(quotes.get('DOGE')).toEqual({ price: 0.12, change: 0 });
    expect(quotes.has('ETH')).toBe(false);
    expect(coinId('SOL')).toBe('solana');
    expect(coinId('PEPE')).toBe('pepe');
  });

  it('reads a Yahoo chart: the price and the change since yesterday’s close', () => {
    expect(parseYahooChart({ chart: { result: [{ meta: { regularMarketPrice: 110, chartPreviousClose: 100 } }] } })).toEqual({ price: 110, change: 10 });
    expect(parseYahooChart({ chart: { result: [{ meta: { regularMarketPrice: 50, previousClose: 40 } }] } })?.change).toBe(25);
    expect(parseYahooChart({ chart: { result: null, error: { code: 'Not Found' } } })).toBeNull();
    expect(parseYahooChart('nonsense')).toBeNull();
  });

  it('reads headlines from RSS and Atom feeds as plain text', () => {
    const rss = `<?xml version="1.0"?><rss><channel><title>Site name</title>
      <item><title><![CDATA[Show HN: A tiny job queue & more]]></title><link>x</link></item>
      <item><title>Apple&#8217;s new Mac &amp; the M5 &#x2014; reviewed</title></item>
      <item><title>   </title></item>
      <item><title>Third</title></item></channel></rss>`;
    expect(parseFeedTitles(rss)).toEqual(['Show HN: A tiny job queue & more', 'Apple’s new Mac & the M5 — reviewed', 'Third']);
    expect(parseFeedTitles(rss, 1)).toEqual(['Show HN: A tiny job queue & more']);
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>The Verge</title>
      <entry><title type="html">The &lt;em&gt;best&lt;/em&gt; monitors for AT&amp;amp;T fans</title></entry>
      <entry><title>Plain one</title></entry></feed>`;
    expect(parseFeedTitles(atom)).toEqual(['The best monitors for AT&T fans', 'Plain one']);
    expect(parseFeedTitles('<html>not a feed</html>')).toEqual([]);
  });
});

describe('TickerFeed', () => {
  let dir: string;
  let store: BoardStore;
  let clock: number;
  let calls: string[];
  let failing: (url: string) => boolean;
  let feed: TickerFeed;
  const logs: string[] = [];

  const fetcher: Fetcher = async (url: string) => {
    calls.push(new URL(url).hostname);
    if (failing(url)) throw new TypeError('fetch failed');
    return fakeTickerFetch(url);
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    dir = await mkdtemp(join(tmpdir(), 'sticky-ticker-'));
    store = await BoardStore.open({ dir, seed: makeEmptyBoard, saveDelayMs: 5 });
    clock = Date.parse('2026-09-30T19:42:00Z');
    calls = [];
    failing = () => false;
    logs.length = 0;
    feed = new TickerFeed(store, { fetcher, log: message => logs.push(message), now: () => clock });
  });

  afterEach(async () => {
    feed.stop();
    vi.useRealTimers();
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  const symbols = () => feed.snapshot().items.map(item => (item.kind === 'price' ? item.symbol : item.source));

  it('fetches the chosen prices and headlines and lists them in order', async () => {
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(symbols()).toEqual(['BTC', 'ETH', 'AAPL', 'NVDA', 'MSFT', 'GOOGL', 'HN', 'HN', 'Verge', 'Verge']);
    const snapshot = feed.snapshot();
    expect(snapshot.items[2]).toMatchObject({ kind: 'price', group: 'stock', symbol: 'AAPL', price: 227.5 });
    expect(snapshot).toMatchObject({ updatedAt: new Date(clock).toISOString(), stale: false });
  });

  it('fetches nothing while the ticker is off', async () => {
    store.apply({ type: 'settings.patch', patch: { ticker: { show: false } } });
    feed.start();
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(calls).toEqual([]);
    expect(feed.snapshot().items).toEqual([]);
  });

  it('updates soon after the choices change, and says so', async () => {
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    const told = vi.fn();
    feed.subscribe(told);
    store.apply({ type: 'settings.patch', patch: { ticker: { crypto: ['ETH', 'SOL'], stocks: ['TSLA'], news: [] } } });
    expect(told).toHaveBeenCalled(); // BTC and the old stocks go at once
    expect(symbols()).toEqual(['ETH']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(symbols()).toEqual(['ETH', 'SOL', 'TSLA']);
  });

  it('keeps the last values when a source fails, marks them stale after half an hour, and logs once', async () => {
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    failing = url => url.includes('coingecko');
    for (let i = 0; i < 7; i++) {
      clock += 5 * 60_000;
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    }
    const snapshot = feed.snapshot();
    expect(snapshot.items.find(item => item.kind === 'price' && item.symbol === 'BTC')).toBeTruthy();
    expect(snapshot.stale).toBe(true);
    expect(logs.filter(line => line.includes('crypto prices'))).toHaveLength(1);
    failing = () => false;
    clock += 5 * 60_000;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(logs.at(-1)).toMatch(/crypto prices is back/);
  });

  it('reads a custom feed and tags it with its site', async () => {
    store.apply({ type: 'settings.patch', patch: { ticker: { crypto: [], stocks: [], news: ['https://blog.example.com/feed.xml'] } } });
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.snapshot().items).toEqual([{ kind: 'headline', source: 'blog.example.com', title: 'Latest from blog.example.com' }]);
  });
});
