// Stand-ins for the ticker's price and news sites, so tests and screenshots don't need
// the internet and always show the same values.

const COINS: Record<string, [number, number]> = {
  bitcoin: [63_120.4, 1.24],
  ethereum: [2451.3, -0.41],
  solana: [148.2, 3.1],
};

const STOCKS: Record<string, [price: number, previousClose: number]> = {
  AAPL: [227.5, 225.7],
  NVDA: [131.2, 128.5],
  MSFT: [431.6, 432.9],
  GOOGL: [167.4, 166.6],
  TSLA: [248.3, 254.4],
};

const HEADLINES: Record<string, string[]> = {
  'hnrss.org': ['Show HN: A tiny job queue built on SQLite', 'Ask HN: How do you keep a paper notebook and a to-do app in sync?'],
  'www.theverge.com': ['The best budget monitors for a home office', 'E-ink tablets are finally getting color screens worth using'],
};

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

export async function fakeTickerFetch(input: string): Promise<Response> {
  const url = new URL(input);
  if (url.hostname === 'api.coingecko.com') {
    const ids = (url.searchParams.get('ids') ?? '').split(',');
    return json(Object.fromEntries(ids.filter(id => COINS[id]).map(id => [id, { usd: COINS[id]![0], usd_24h_change: COINS[id]![1] }])));
  }
  if (url.hostname === 'query1.finance.yahoo.com') {
    const symbol = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    const [price, previous] = STOCKS[symbol] ?? [100, 100];
    return json({ chart: { result: [{ meta: { symbol, regularMarketPrice: price, chartPreviousClose: previous } }], error: null } });
  }
  const titles = HEADLINES[url.hostname] ?? [`Latest from ${url.hostname}`];
  const items = titles.map(title => `<item><title><![CDATA[${title}]]></title></item>`).join('');
  return new Response(`<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${items}</channel></rss>`, {
    headers: { 'Content-Type': 'application/rss+xml' },
  });
}
