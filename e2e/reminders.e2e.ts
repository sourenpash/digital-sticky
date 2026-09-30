import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeEmptyBoard } from '../shared/defaults.ts';
import type { Note } from '../shared/types.ts';
import { Harness } from './harness.ts';

// Reminders go off by themselves: on the wall, on phones, and away again with Dismiss.

const h = new Harness(makeEmptyBoard);

beforeAll(() => h.launch());
afterAll(() => h.close());
beforeEach(() => h.setUp());
afterEach(async () => {
  await h.tearDown();
  expect(h.pageErrors).toEqual([]);
});

function reminder(title: string, inMs: number, fields: Partial<Note> = {}): Note {
  const now = h.server!.store.now();
  return {
    id: `r${Math.random().toString(36).slice(2, 8)}`,
    laneId: 'remind',
    title,
    body: '',
    checklist: [],
    links: [],
    pinned: false,
    done: false,
    remindAt: new Date(now.getTime() + inMs).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...fields,
  };
}

describe('reminders', () => {
  it('pop up on the wall and the phone at their time, and Dismiss on the phone takes them down', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'board');
    await phone.getByText('Live').waitFor();

    h.server!.store.apply({ type: 'note.add', note: reminder('Call the financial office', 2000) });
    const banner = wall.locator('.wall-banner', { hasText: 'Call the financial office' });
    await banner.waitFor({ timeout: 10_000 });
    await phone.locator('.reminder', { hasText: 'Call the financial office' }).waitFor();
    await phone.locator('.toast', { hasText: 'Reminder: Call the financial office' }).waitFor();

    await phone.getByRole('button', { name: 'Dismiss “Call the financial office”' }).click();
    await expect.poll(() => banner.count()).toBe(0);
    expect((await h.saved()).board.alerts).toEqual([]);
  });

  it('logs a recurring task with Done instead of ending it', async () => {
    const phone = await h.open('phone', 'board');
    await phone.getByText('Live').waitFor();
    h.server!.store.apply({
      type: 'note.add',
      note: reminder('Stretch', 500, { laneId: 'routine', repeat: { every: 'day', times: 1 }, completions: [] }),
    });
    await phone.locator('.reminder', { hasText: 'Stretch' }).getByRole('button', { name: 'Done' }).click();
    // Two changes go out in order: the "Did it", then taking the reminder down.
    await expect
      .poll(async () => {
        const { board } = await h.saved();
        return [board.notes[0]?.completions?.length, board.alerts.length];
      })
      .toEqual([1, 0]);
    expect((await h.saved()).board.notes[0]).toMatchObject({ done: false, repeat: { every: 'day' } });
  });
});
