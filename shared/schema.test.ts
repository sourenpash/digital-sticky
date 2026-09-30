import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { makeEmptyBoard } from './defaults.ts';
import { makeSampleBoard } from './sample.ts';
import { boardSchema, describeIssues, goalSchema, laneSchema, newNoteSchema, notePatchSchema, noteSchema, settingsSchema } from './schema.ts';
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

  it('does not let required fields be cleared', () => {
    expect(notePatchSchema.safeParse({ title: null }).success).toBe(false);
    expect(notePatchSchema.safeParse({ checklist: null }).success).toBe(false);
  });
});
