import { addDays, format } from 'date-fns';
import type { Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { Harness } from './harness.ts';

// The core of checkpoint 2: changes on a phone or computer reach the wall, are saved,
// survive a restart, and wait out a lost connection.

const h = new Harness(makeEmptyBoard);

/** A square on the wall, found by its title. */
const wallNote = (wall: Page, title: string) => wall.locator('.wall .note', { hasText: title });

async function addApplication(phone: Page, title: string, dueInDays: number): Promise<void> {
  await phone.getByRole('button', { name: 'Add a note' }).click();
  await phone.getByRole('button', { name: /^Application/ }).click();
  expect(await phone.getByRole('radio', { name: 'Grant / funding' }).getAttribute('aria-checked')).toBe('true');
  await phone.getByLabel('Title').fill(title);
  await phone.getByLabel('Deadline date').fill(format(addDays(new Date(), dueInDays), 'yyyy-MM-dd'));
  await phone.getByLabel('New checklist item').fill('Ask for a nomination letter');
  await phone.getByLabel('New checklist item').press('Enter');
  await phone.getByLabel('Link', { exact: true }).fill('sloan.org/fellowships');
  await phone.getByLabel('Link', { exact: true }).press('Enter');
  await phone.getByRole('button', { name: 'Add to board' }).click();
}

beforeAll(() => h.launch());
afterAll(() => h.close());
beforeEach(() => h.setUp());
afterEach(async () => {
  await h.tearDown();
  expect(h.pageErrors).toEqual([]);
});

describe('phone to wall', () => {
  it('shows a funding application added on a phone on the wall within 3 seconds', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'board');
    await phone.getByText('Live').waitFor();

    await addApplication(phone, 'Sloan Research Fellowship', 5);
    const added = Date.now();
    const square = wallNote(wall, 'Sloan Research Fellowship');
    await square.waitFor({ timeout: 3000 });
    expect(Date.now() - added).toBeLessThan(3000);

    // Deadline countdown, checklist progress (5 template steps + 1) and the unchecked source.
    await expect.poll(() => square.textContent()).toContain('5 days');
    expect(await square.textContent()).toContain('0/6');
    expect(await square.locator('.note-flags').textContent()).toContain('1');

    // And it's saved on disk.
    const saved = await h.saved();
    expect(saved.board.notes[0]).toMatchObject({ title: 'Sloan Research Fellowship', stage: 'Researching' });
    expect(saved.board.notes[0]?.links[0]).toMatchObject({ url: 'https://sloan.org/fellowships', verified: false });
  });

  it('updates the wall when a checklist item is ticked on the phone', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'board');
    await addApplication(phone, 'Sloan Research Fellowship', 5);
    const square = wallNote(wall, 'Sloan Research Fellowship');
    await square.waitFor();

    await phone.getByRole('button', { name: /Sloan Research Fellowship/ }).click();
    await phone.getByRole('checkbox', { name: 'Confirm eligibility' }).click();
    await expect.poll(() => square.textContent(), { timeout: 3000 }).toContain('1/6');
  });

  it('keeps the board through a server restart, and screens reconnect by themselves', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'board');
    await addApplication(phone, 'Sloan Research Fellowship', 5);
    await wallNote(wall, 'Sloan Research Fellowship').waitFor();

    await h.stop();
    await h.start();

    await phone.getByRole('button', { name: /Sloan Research Fellowship/ }).click();
    await phone.getByLabel('Title').fill('Sloan Fellowship (resubmit)');
    await phone.getByRole('button', { name: 'Close' }).click();
    await wallNote(wall, 'Sloan Fellowship (resubmit)').waitFor({ timeout: 10_000 });
  });

  it('holds changes made while the server is down and sends them when it is back', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'board');
    await addApplication(phone, 'Sloan Research Fellowship', 5);
    const square = wallNote(wall, 'Sloan Research Fellowship');
    await square.waitFor();

    await h.stop();
    await phone.getByRole('button', { name: /Sloan Research Fellowship/ }).click();
    await phone.getByRole('checkbox', { name: 'Budget' }).click();
    await phone.getByText('Offline · 1 waiting').waitFor({ timeout: 10_000 });

    await h.start();
    await expect.poll(() => square.textContent(), { timeout: 15_000 }).toContain('1/6');
    await phone.getByText('Live').waitFor({ timeout: 10_000 });
  });
});

describe('computer', () => {
  it('moves a square to another column by dragging, and the wall follows', async () => {
    const wall = await h.open('wall', 'wall');
    const computer = await h.open('computer', 'board');
    await computer.getByRole('button', { name: 'New note' }).click();
    await computer.getByRole('button', { name: /^To-do/ }).click();
    await computer.getByLabel('Title').fill('Update CV + biosketch');
    await computer.getByRole('button', { name: 'Add to board' }).click();
    await wallNote(wall, 'Update CV + biosketch').waitFor();

    const square = computer.locator('.note-cell', { hasText: 'Update CV + biosketch' });
    await square.dragTo(computer.getByRole('region', { name: 'Reminders' }));
    await computer.getByText('Moved to Reminders').waitFor();

    const column = wall.locator('.wall-col', { hasText: 'Reminders' });
    await column.locator('.note', { hasText: 'Update CV + biosketch' }).waitFor({ timeout: 3000 });
  });
});
