import type { Locator } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeSampleBoard } from '../shared/sample.ts';
import type { Note } from '../shared/types.ts';
import { Harness } from './harness.ts';

// Following up after an application goes in or a message is sent: asked when, nudged
// on the wall and phones, and stopped once you hear back. Also the one-time question
// on a phone about hiding the wall's "Connect your phone" code.

const NOW = '2026-09-30T19:42:00'; // a Wednesday evening, matching the sample's dates
const h = new Harness(() => makeSampleBoard(new Date(NOW)), { query: `?now=${NOW}`, now: NOW, connectUrl: 'http://192.168.1.50:3000' });
/** Looks like a phone on the Wi-Fi rather than the wall computer. */
const AWAY = { headers: { 'X-Forwarded-For': '203.0.113.7' } };

const text = (locator: Locator) => () => locator.first().innerText().catch(() => '');

beforeAll(() => h.launch());
afterAll(() => h.close());
beforeEach(() => h.setUp());
afterEach(async () => {
  await h.tearDown();
  expect(h.pageErrors).toEqual([]);
});

async function saved(title: string): Promise<Note> {
  const { board } = await h.saved();
  return board.notes.find(note => note.title === title)!;
}

/** The follow-up comes due a minute ago, as if the wait had passed. */
function dueNow(note: Note): void {
  const at = new Date(h.server!.store.now().getTime() - 60_000).toISOString();
  h.server!.store.apply({ type: 'note.patch', id: note.id, patch: { followUp: { at, everyDays: note.followUp!.everyDays } } });
}

describe('follow-ups', () => {
  it('asks when to follow up on a submitted application, nudges when it is time, and stops when you hear back', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'board');
    const onWall = wall.locator('.note', { hasText: 'NIH R01' });

    await phone.getByRole('button', { name: /NIH R01 resubmission/ }).click();
    await phone.getByRole('radio', { name: 'Submitted' }).click();
    await phone.getByText('Remind you to follow up if you don’t hear back?').waitFor();
    await phone.getByRole('button', { name: '2 weeks' }).click();
    await phone.getByText(/Next nudge: Wed, Oct 14, 9 AM \(in 2 weeks\)/).waitFor();
    await expect.poll(text(onWall.locator('.chip'))).toBe('Oct 14');
    await expect.poll(async () => (await saved('NIH R01 resubmission')).followUp).toEqual({ at: new Date('2026-10-14T09:00:00').toISOString(), everyDays: 14 });
    await phone.getByRole('button', { name: 'Close' }).click();

    // Two weeks on: the wall and the phone nudge.
    dueNow(await saved('NIH R01 resubmission'));
    await wall.locator('.wall-banner', { hasText: 'NIH R01 resubmission' }).getByText('Follow up · submitted Sep 30').waitFor({ timeout: 10_000 });
    await expect.poll(text(onWall.locator('.chip'))).toBe('Follow up');
    const nudge = phone.locator('.reminder.is-follow', { hasText: 'NIH R01 resubmission' });
    await nudge.waitFor();

    // Heard back: shortlisted. The nudges stop and the pop-up goes, everywhere.
    await nudge.getByRole('button', { name: 'Heard back' }).click();
    await nudge.getByRole('button', { name: 'Shortlisted' }).click();
    await expect.poll(() => wall.locator('.wall-banner').count()).toBe(0);
    const note = await saved('NIH R01 resubmission');
    expect(note).toMatchObject({ stage: 'Interview' });
    expect(note.followUp).toBeUndefined();
    expect((await h.saved()).board.alerts).toEqual([]);
  });

  it('turns a to-do into an email, follows up once it is sent, and finishes it on a reply', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'board');

    await phone.getByRole('button', { name: 'Add a note' }).click();
    await phone.getByRole('button', { name: /^Email, text or call/ }).click();
    await phone.getByLabel('Title').fill('Ask the dean about matching funds');
    await phone.getByLabel('To', { exact: true }).fill('Dean Ortiz');
    await phone.getByRole('button', { name: 'Mark sent' }).click();
    await phone.getByRole('button', { name: '1 week' }).click();
    await phone.getByRole('dialog').getByRole('button', { name: 'Add to board' }).click();

    const onWall = wall.locator('.note', { hasText: 'Ask the dean' });
    await expect.poll(text(onWall.locator('.chip'))).toBe('Oct 7');
    const added = await saved('Ask the dean about matching funds');
    expect(added).toMatchObject({ channel: 'email', funder: 'Dean Ortiz', followUp: { everyDays: 7 } });
    expect(added.sentAt).toBeTruthy();

    // A week later, with no answer: nudged. Then the reply comes in.
    dueNow(added);
    const nudge = phone.locator('.reminder.is-follow', { hasText: 'Ask the dean' });
    await nudge.waitFor({ timeout: 10_000 });
    await nudge.getByRole('button', { name: 'Heard back' }).click();
    await expect.poll(async () => (await saved('Ask the dean about matching funds')).done).toBe(true);
    expect((await saved('Ask the dean about matching funds')).followUp).toBeUndefined();
    await expect.poll(() => onWall.evaluate(el => el.classList.contains('is-done'))).toBe(true);
  });

  it('moves the next nudge on after "Followed up", from the sticky itself', async () => {
    const phone = await h.open('phone', 'board');
    await phone.getByRole('button', { name: /Email program officer/ }).click();
    await phone.getByText('Time to follow up').waitFor();
    await phone.getByRole('button', { name: 'Followed up', exact: true }).click();
    await phone.getByText(/Next nudge: Wed, Oct 7, 9 AM \(in a week\)/).waitFor();
    expect((await saved('Email program officer about CAREER scope')).followUp).toEqual({ at: new Date('2026-10-07T09:00:00').toISOString(), everyDays: 7 });
    await phone.locator('.toast', { hasText: 'next nudge' }).getByRole('button', { name: 'Undo' }).click();
    await phone.getByText('Time to follow up').waitFor();
  });
});

describe('pairing', () => {
  it('asks a phone once whether to hide the wall’s Connect code, but not the wall computer', async () => {
    h.server!.store.apply({ type: 'settings.patch', patch: { wall: { showConnect: true } } });
    const wall = await h.open('wall', 'wall');
    await wall.locator('.wall-connect').waitFor();

    // The wall computer's own browser isn't asked.
    const local = await h.open('computer', 'board');
    await local.getByText('Live').waitFor();
    await local.waitForTimeout(500);
    expect(await local.locator('.pair-prompt').count()).toBe(0);

    const phone = await h.open('phone', 'board', AWAY);
    await phone.getByRole('heading', { name: 'This phone is connected' }).waitFor();
    await phone.getByRole('button', { name: 'Hide the code' }).click();
    await expect.poll(() => wall.locator('.wall-connect').count()).toBe(0);
    expect((await h.saved()).board.settings.wall.showConnect).toBe(false);

    // Asked once: showing the code again doesn't bring the question back on this phone.
    h.server!.store.apply({ type: 'settings.patch', patch: { wall: { showConnect: true } } });
    await wall.locator('.wall-connect').waitFor();
    await phone.reload();
    await phone.getByText('Live').waitFor();
    await phone.waitForTimeout(500);
    expect(await phone.locator('.pair-prompt').count()).toBe(0);
  });
});
