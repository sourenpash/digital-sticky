import { describe, expect, it } from 'vitest';
import { sampleTicker } from './sampleTicker.ts';
import { formatChange, formatPrice, newsTag } from './ticker.ts';

describe('ticker', () => {
  it('formats prices and daily changes for the ribbon', () => {
    expect(formatPrice(63_120.4)).toBe('$63,120');
    expect(formatPrice(227.5)).toBe('$227.50');
    expect(formatPrice(0.12423)).toBe('$0.124');
    expect(formatChange(1.24)).toBe('▲1.2%');
    expect(formatChange(-0.4)).toBe('▼0.4%');
    expect(formatChange(0.01)).toBe('0.0%');
  });

  it('tags news by source, including custom feeds', () => {
    expect(newsTag('hn')).toBe('HN');
    expect(newsTag('https://feeds.example.org/tech.xml')).toBe('example.org');
  });

  it('makes sample items for whatever is picked, in order: crypto, stocks, news', () => {
    const items = sampleTicker({ show: true, crypto: ['BTC'], stocks: ['ZZZZ'], news: ['hn', 'https://blog.example.com/rss'] });
    expect(items.map(item => (item.kind === 'price' ? item.symbol : item.source))).toEqual(['BTC', 'ZZZZ', 'HN', 'HN', 'blog.example.com']);
    expect(sampleTicker({ show: true, crypto: ['ZZZZ'], stocks: [], news: [] })).toEqual(sampleTicker({ show: true, crypto: ['ZZZZ'], stocks: [], news: [] }));
  });
});
