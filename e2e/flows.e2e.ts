import type { Locator } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeSampleBoard } from '../shared/sample.ts';
import { Harness } from './harness.ts';

// Everyday flows on the sample board, with the phone and the wall as separate screens,
// so every change goes through the server before the wall shows it.

const NOW = '2026-09-30T19:42:00'; // a Wednesday evening, matching the sample's dates
const h = new Harness(() => makeSampleBoard(new Date(NOW)), `?now=${NOW}`);

const text = (locator: Locator) => () => locator.first().innerText().catch(() => '');
const count = (locator: Locator) => () => locator.count();

beforeAll(() => h.launch());
afterAll(() => h.close());
beforeEach(() => h.setUp());
afterEach(async () => {
  await h.tearDown();
  expect(h.pageErrors).toEqual([]);
});

describe('everyday flows', () => {
  it('logs a recurring task, from the button and the week strip, and undoes it', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'board');
    const onWall = wall.locator('.note', { hasText: 'Write for an hour' });
    const bar = onWall.locator('.note-bar-label');

    await phone.getByRole('button', { name: /Write for an hour/ }).click();
    await phone.getByRole('button', { name: 'Did it' }).click();
    expect(await phone.locator('.toast').first().innerText()).toMatch(/Nice\. 4 of 5 this week/);
    await expect.poll(text(bar)).toBe('4/5');

    await phone.getByRole('button', { name: /^Monday: done/ }).click();
    await expect.poll(text(bar)).toBe('3/5');
    await phone.getByRole('button', { name: /^Monday: not done/ }).click();
    await expect.poll(text(bar)).toBe('4/5');

    await phone.getByRole('button', { name: 'Did it' }).click();
    expect(await phone.locator('.ne-foot .btn').first().innerText()).toMatch(/Done for this week/);
    await expect.poll(() => onWall.evaluate(el => el.classList.contains('is-rested'))).toBe(true);

    await phone.locator('.toast', { hasText: 'Done for this week' }).getByRole('button', { name: 'Undo' }).click();
    await expect.poll(text(bar)).toBe('4/5');
  });

  it('moves goals from the phone and from submitted applications', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'board');

    await phone.getByRole('button', { name: /Talk to 10 program officers/ }).click();
    await phone.getByRole('button', { name: 'Add one' }).click();
    await expect.poll(text(wall.locator('.wall-goal', { hasText: 'Talk to 10' }).locator('.wall-goal-value'))).toBe('5 of 10');
    await phone.getByRole('button', { name: 'Close' }).first().click();

    await phone.getByRole('button', { name: /NIH R01 resubmission/ }).click();
    await phone.getByRole('radio', { name: 'Submitted' }).click();
    await expect.poll(text(wall.locator('.wall-goal', { hasText: 'Submit 5' }).locator('.wall-goal-value'))).toBe('3 of 5');
    // Typing goes out after a short pause, as one change.
    await phone.getByLabel('Title').fill('NIH R01 (resubmitted)');
    await expect.poll(count(wall.locator('.note', { hasText: 'NIH R01 (resubmitted)' }))).toBe(1);
    await phone.getByRole('button', { name: 'Close' }).first().click();

    await phone.getByRole('button', { name: 'Add a note' }).click();
    await phone.getByRole('button', { name: /^Goal/ }).click();
    await phone.getByLabel('Title').fill('Win $50k this year');
    await phone.getByRole('radio', { name: /Money won/ }).click();
    await phone.getByLabel('Target').fill('50000');
    await phone.getByRole('dialog').getByRole('button', { name: 'Add goal' }).click();
    await expect.poll(count(phone.locator('.goal-card'))).toBe(4);
    await expect.poll(count(wall.locator('.wall-goal'))).toBe(3); // the wall shows three at most

    await phone.getByRole('button', { name: /Win \$50k this year/ }).click();
    await phone.getByRole('button', { name: 'Delete goal' }).click();
    await phone.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(count(phone.locator('.goal-card'))).toBe(3);
    await phone.locator('.toast', { hasText: 'Deleted' }).getByRole('button', { name: 'Undo' }).click();
    await expect.poll(count(phone.locator('.goal-card'))).toBe(4);
  });

  it('adds a recurring task, and turns a to-do into one by moving it to Recurring', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'board');
    const column = (title: string) => wall.locator('.wall-col', { hasText: title });

    await phone.getByRole('button', { name: 'Add a note' }).click();
    await phone.getByRole('button', { name: /Recurring task/ }).click();
    await phone.getByLabel('Title').fill('Stretch');
    await phone.getByRole('radio', { name: 'Every day' }).click();
    await phone.getByRole('dialog').getByRole('button', { name: 'Add to board' }).click();
    const stretch = column('Recurring').locator('.note', { hasText: 'Stretch' });
    await expect.poll(text(stretch.locator('.chip'))).toMatch(/Today/);

    await phone.getByRole('button', { name: /Update CV \+ biosketch/ }).click();
    await phone.getByLabel('Column', { exact: true }).selectOption({ label: 'Recurring' });
    await phone.getByText('Moved to Recurring').waitFor();
    expect(await phone.getByRole('radio', { name: 'Every week' }).getAttribute('aria-checked')).toBe('true');
    await expect.poll(count(column('Recurring').locator('.note', { hasText: 'Update CV' }))).toBe(1);
    await phone.locator('.toast', { hasText: 'Moved to Recurring' }).getByRole('button', { name: 'Undo' }).click();
    await expect.poll(count(column('To-do').locator('.note', { hasText: 'Update CV' }))).toBe(1);
  });

  it('deletes a note and brings it back with Undo', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'board');
    const dentist = wall.locator('.note', { hasText: 'Dentist' });
    await dentist.waitFor();

    await phone.getByRole('button', { name: /Dentist/ }).click();
    await phone.getByRole('button', { name: /Delete/ }).first().click();
    await phone.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(count(dentist)).toBe(0);
    await phone.locator('.toast', { hasText: 'Deleted' }).getByRole('button', { name: 'Undo' }).click();
    await expect.poll(count(dentist)).toBe(1);
  });

  it('changes wall settings and columns from the phone', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'display');
    const titles = () => wall.locator('.wall-col-title').allInnerTexts();

    await phone.getByRole('radio', { name: 'Always' }).click();
    await expect.poll(count(wall.locator('.wall.wall-mode-dim'))).toBe(1);
    await phone.getByRole('radio', { name: 'Never' }).click();
    await expect.poll(count(wall.locator('.wall.wall-mode-day'))).toBe(1);

    await phone.getByLabel('New column name').fill('Health');
    await phone.getByLabel('What goes in it').selectOption('routine');
    await phone.getByRole('button', { name: 'Add', exact: true }).click();
    await expect.poll(async () => (await titles()).at(-1)?.trim()).toMatch(/health/i);
    await phone.getByRole('button', { name: 'Move Health left on the wall' }).click();
    await expect.poll(async () => (await titles()).at(-2)?.trim()).toMatch(/health/i);

    await phone.getByRole('button', { name: 'Delete Health' }).click();
    await phone.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(async () => (await titles()).some(t => /health/i.test(t))).toBe(false);
    await phone.locator('.toast', { hasText: 'Deleted' }).getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await titles()).some(t => /health/i.test(t))).toBe(true);

    await phone.getByRole('button', { name: /Try it: pop up/ }).click();
    await expect.poll(count(wall.locator('.wall-banner'))).toBe(1);
    await phone.getByRole('button', { name: 'Dismiss' }).first().click();
    await expect.poll(count(wall.locator('.wall-banner'))).toBe(0);

    const saved = await h.saved();
    expect(saved.board.lanes).toHaveLength(6);
    expect(saved.board.settings.night.mode).toBe('off');
  });
});
