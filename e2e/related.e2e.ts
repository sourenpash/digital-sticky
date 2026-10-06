import type { Locator } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeSampleBoard } from '../shared/sample.ts';
import { Harness } from './harness.ts';

// Related tasks spun off a sticky (each its own sticky on the wall), and handing a
// sticky to the AI helper.

const NOW = '2026-09-30T19:42:00'; // a Wednesday evening, matching the sample's dates
const h = new Harness(() => makeSampleBoard(new Date(NOW)), { query: `?now=${NOW}`, now: NOW });

const text = (locator: Locator) => () => locator.first().innerText().catch(() => '');

beforeAll(() => h.launch());
afterAll(() => h.close());
beforeEach(() => h.setUp());
afterEach(async () => {
  await h.tearDown();
  expect(h.pageErrors).toEqual([]);
});

describe('related tasks', () => {
  it('spins off related tasks that show on the wall, linked to their sticky', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'board');
    const career = wall.locator('.note', { hasText: 'NSF CAREER' });
    await expect.poll(text(career.locator('.flag-tasks'))).toBe('0/2');

    // A new related task: its own sticky, in To-do, marked as part of the proposal.
    await phone.getByRole('button', { name: /NSF CAREER proposal/ }).first().click();
    await phone.getByLabel('New related task').fill('Book a read-through with Dr. Kim');
    await phone.getByLabel('New related task').press('Enter');
    const added = wall.locator('.note', { hasText: 'Book a read-through' });
    await added.waitFor({ timeout: 5000 });
    expect(await added.locator('.note-parent').getAttribute('title')).toBe('Part of “NSF CAREER proposal”');
    expect(await wall.locator('.wall-col', { has: added }).locator('.wall-col-title').innerText()).toMatch(/to-do/i);
    await expect.poll(text(career.locator('.flag-tasks'))).toBe('0/3');

    // A checklist line becomes its own sticky, and leaves the checklist.
    await phone.getByRole('button', { name: 'Make “Budget + justification” its own sticky' }).click();
    await wall.locator('.note', { hasText: 'Budget + justification' }).waitFor({ timeout: 5000 });
    await expect.poll(text(career.locator('.flag-tasks'))).toBe('0/4');
    expect(await phone.getByRole('checkbox', { name: 'Budget + justification', exact: true }).count()).toBe(0);
    expect(await phone.locator('.rel-child').count()).toBe(4);

    // Ticked off from the parent; the related task opens and shows what it's part of.
    await phone.getByRole('checkbox', { name: 'Book a read-through with Dr. Kim: not done' }).click();
    await expect.poll(text(career.locator('.flag-tasks'))).toBe('1/4');
    await phone.locator('.rel-child', { hasText: 'Budget + justification' }).locator('.rel-open').click();
    await phone.locator('.rel-parent', { hasText: 'NSF CAREER proposal' }).waitFor();
    await phone.locator('.rel-parent .rel-open').click();
    await phone.getByLabel('New related task').waitFor();

    // Done with the proposal: offered to finish its open related tasks too.
    await phone.getByRole('button', { name: 'Mark done' }).click();
    await phone.locator('.toast', { hasText: 'Mark its 3 related tasks done too?' }).getByRole('button', { name: 'Mark done' }).click();
    await expect
      .poll(async () => {
        const { board } = await h.saved();
        const parent = board.notes.find(n => n.title === 'NSF CAREER proposal')!;
        return board.notes.filter(n => n.parentId === parent.id).map(n => n.done);
      })
      .toEqual([true, true, true, true]);
  });
});

describe('AI helper', () => {
  it('hands a new sticky to the AI helper with a schedule, and lists it on the Wall tab', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'board');

    await phone.getByRole('button', { name: 'Add a note' }).click();
    await phone.getByRole('button', { name: /^To-do/ }).click();
    await phone.getByLabel('Title').fill('Check government websites for funding updates');
    await phone.getByRole('button', { name: 'Give this to AI' }).click();
    expect(await phone.getByLabel('What should it do?').inputValue()).toBe('Check government websites for funding updates');
    await phone.getByRole('radio', { name: 'Every week' }).click();
    await phone.getByRole('radio', { name: 'Monday' }).click();
    await phone.getByLabel('Time of day').fill('07:30');
    await phone.getByRole('checkbox', { name: /Add stickies for new things/ }).uncheck();
    await phone.getByRole('dialog').getByRole('button', { name: 'Add to board' }).click();

    const onWall = wall.locator('.note', { hasText: 'Check government websites' });
    await onWall.locator('.note-ai').waitFor({ timeout: 5000 });
    await expect
      .poll(async () => (await h.saved()).board.notes.find(n => n.title.startsWith('Check government'))?.ai)
      .toEqual({ instructions: 'Check government websites for funding updates', schedule: 'weekly', weekday: 1, time: '07:30', mayAdd: false, mayEdit: false });

    // The sample's AI sticky shows what it found, and links to the sticky it added.
    await phone.getByRole('button', { name: 'Wall', exact: true }).click();
    await phone.getByRole('button', { name: /Check government websites.*Every Monday at 7:30 AM/ }).waitFor();
    await phone.getByRole('button', { name: /Check grants\.gov and NSF.*Every day at 8 AM · checked 8 AM/ }).click();
    await phone.locator('.ai-run', { hasText: 'K99/R00' }).getByRole('button', { name: /NIH BRAIN Initiative/ }).click();
    await phone.locator('.rel-parent', { hasText: 'Check grants.gov and NSF' }).waitFor();
  });
});
