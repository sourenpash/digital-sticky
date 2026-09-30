import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { makeEmptyBoard } from './defaults.ts';
import { makeSampleBoard } from './sample.ts';
import { boardSchema, describeIssues, goalSchema, laneSchema, newNoteSchema, notePatchSchema, noteSchema, remoteRequestSchema, savedFileSchema, settingsPatchSchema, settingsSchema } from './schema.ts';
import type { Goal, Lane, Note, Settings } from './types.ts';

describe('schema', () => {
  it('matches the shared types', () => {
    expectTypeOf<z.output<typeof noteSchema>>().toEqualTypeOf<Note>();
    expectTypeOf<z.output<typeof laneSchema>>().toEqualTypeOf<Lane>();
    expectTypeOf<z.output<typeof goalSchema>>().toEqualTypeOf<Goal>();
    expectTypeOf<z.output<typeof settingsSchema>>().toEqualTypeOf<Settings>();
  });

  it('accepts the sample board and a fresh board', () => {
    expect(boardSchema.safeParse(makeSampleBoard(new Date('2026-09-30T19:42:00'))).success).toBe(true);
    expect(boardSchema.safeParse(makeEmptyBoard()).success).toBe(true);
  });

  it('fills in defaults for a minimal new note', () => {
    const parsed = newNoteSchema.parse({ laneId: 'todo', title: 'Buy stamps' });
    expect(parsed).toMatchObject({ body: '', checklist: [], links: [], pinned: false, done: false });
  });

  it('rejects links that are not web addresses', () => {
    const result = newNoteSchema.safeParse({
      laneId: 'todo',
      title: 'x',
      links: [{ id: 'l1', url: 'javascript:alert(1)', verified: false }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(describeIssues(result.error)).toBe('links.0.url: Links must be http:// or https:// web addresses');
  });

  it('takes all-day and timed deadlines but not loose dates', () => {
    expect(notePatchSchema.safeParse({ due: '2026-10-03' }).success).toBe(true);
    expect(notePatchSchema.safeParse({ due: '2026-10-03T21:00:00.000Z' }).success).toBe(true);
    expect(notePatchSchema.safeParse({ due: 'next friday' }).success).toBe(false);
    expect(notePatchSchema.safeParse({ due: null }).success).toBe(true);
  });

  it('gives boards saved before the ticker existed the default ticker', () => {
    const { ticker: _ticker, ...oldSettings } = makeEmptyBoard().settings;
    const old = { version: 1, rev: 3, savedAt: '2026-09-30T12:00:00.000Z', board: { ...makeEmptyBoard(), settings: oldSettings } };
    const parsed = savedFileSchema.parse(old);
    expect(parsed.board.settings.ticker).toEqual({ show: true, crypto: ['BTC', 'ETH'], stocks: ['AAPL', 'NVDA', 'MSFT', 'GOOGL'], news: ['hn', 'verge'] });
  });

  it('checks ticker symbols and news sources', () => {
    expect(settingsPatchSchema.safeParse({ ticker: { stocks: ['BRK.B', '^GSPC'], news: ['ars', 'https://example.com/feed.xml'] } }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ ticker: { crypto: ['btc'] } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ ticker: { news: ['javascript:alert(1)'] } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ ticker: { stocks: Array.from({ length: 21 }, (_, i) => `S${i}`) } }).success).toBe(false);
  });

  it('checks remote commands and cuts huge moves down', () => {
    const parsed = remoteRequestSchema.parse({ commands: [{ type: 'move', dx: 1e9, dy: -3 }, { type: 'key', key: 'Enter' }, { type: 'open', url: 'https://example.com' }] });
    expect(parsed.commands[0]).toEqual({ type: 'move', dx: 5000, dy: -3 });
    expect(remoteRequestSchema.safeParse({ commands: [] }).success).toBe(false);
    expect(remoteRequestSchema.safeParse({ commands: [{ type: 'key', key: 'F12' }] }).success).toBe(false);
    expect(remoteRequestSchema.safeParse({ commands: [{ type: 'open', url: 'javascript:alert(1)' }] }).success).toBe(false);
    expect(remoteRequestSchema.safeParse({ commands: [{ type: 'open', url: 'chrome://settings' }] }).success).toBe(false);
    expect(remoteRequestSchema.safeParse({ commands: [{ type: 'text', text: '' }] }).success).toBe(false);
    expect(remoteRequestSchema.safeParse({ commands: [{ type: 'eval', code: '1' }] }).success).toBe(false);
    expect(remoteRequestSchema.safeParse({ commands: Array.from({ length: 101 }, () => ({ type: 'click' })) }).success).toBe(false);
  });

  it('does not let required fields be cleared', () => {
    expect(notePatchSchema.safeParse({ title: null }).success).toBe(false);
    expect(notePatchSchema.safeParse({ checklist: null }).success).toBe(false);
  });
});
