import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { Harness } from './harness.ts';

// A board with a PIN: the wall computer gets in by itself, other devices sign in once.

const PIN = '482915';
const h = new Harness(makeEmptyBoard, { pin: PIN });
/** Looks like a phone on the Wi-Fi rather than the wall computer. */
const AWAY = { headers: { 'X-Forwarded-For': '203.0.113.7' } };

beforeAll(() => h.launch());
afterAll(() => h.close());
beforeEach(() => h.setUp());
afterEach(async () => {
  await h.tearDown();
  expect(h.pageErrors).toEqual([]);
});

describe('PIN', () => {
  it('lets the wall computer in without it, and asks a phone for it once', async () => {
    const wall = await h.open('wall', 'wall');
    await wall.locator('.wall').waitFor();
    expect(await wall.getByLabel('PIN').count()).toBe(0);

    const phone = await h.open('phone', 'board', AWAY);
    await phone.getByLabel('PIN').fill('111111');
    await phone.getByRole('button', { name: 'Unlock' }).click();
    await phone.getByText('That PIN isn’t right').waitFor();

    await phone.getByLabel('PIN').fill(PIN);
    await phone.getByRole('button', { name: 'Unlock' }).click();
    await phone.getByText('Live').waitFor();

    // Signed in, its changes reach the wall...
    await phone.getByRole('button', { name: 'Add a note' }).click();
    await phone.getByRole('button', { name: /^To-do/ }).click();
    await phone.getByLabel('Title').fill('Renew passport');
    await phone.getByRole('dialog').getByRole('button', { name: 'Add to board' }).click();
    await wall.locator('.note', { hasText: 'Renew passport' }).waitFor({ timeout: 3000 });

    // ...and it stays signed in.
    await phone.reload();
    await phone.getByText('Live').waitFor();
    expect(await phone.getByLabel('PIN').count()).toBe(0);
  });

  it('signs a phone out from the Wall tab', async () => {
    const phone = await h.open('phone', 'board', AWAY);
    await phone.getByLabel('PIN').fill(PIN);
    await phone.getByRole('button', { name: 'Unlock' }).click();
    await phone.getByText('Live').waitFor();

    await phone.getByRole('button', { name: 'Wall', exact: true }).click();
    await phone.getByText('this device is signed in').waitFor();
    await phone.getByRole('button', { name: 'Sign out this device' }).click();
    await phone.getByLabel('PIN').waitFor();
  });

  it('points out on the PIN screen that the wall computer doesn’t need it', async () => {
    const elsewhere = await h.open('wall', 'wall', AWAY);
    await elsewhere.getByText(/On the wall computer itself/).waitFor();
  });
});
