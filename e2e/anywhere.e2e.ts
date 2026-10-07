import type { Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { Harness } from './harness.ts';

// Using the board from anywhere, and wall screens. The board's door for the internet is
// open (as Tailscale Funnel would reach it): everything coming in there signs in, by
// scanning the wall's code (here: opening the link in it) or typing the code.

const h = new Harness(makeEmptyBoard, { outside: true });
/** A device on the home Wi-Fi (not the wall computer). */
const HOME = { headers: { 'X-Forwarded-For': '192.168.1.60' } };

beforeAll(() => h.launch());
afterAll(() => h.close());
beforeEach(async () => {
  await h.setUp();
  // Day mode whatever the time, so the wall looks the same.
  h.server!.store.apply({ type: 'settings.patch', patch: { night: { mode: 'off' }, wall: { showConnect: true } } });
});
afterEach(async () => {
  await h.tearDown();
  expect(h.pageErrors).toEqual([]);
});

/** The code the wall shows under its QR code, as it's read off: "K7QM-2XPA". */
async function shownCode(wall: Page): Promise<string> {
  await wall.locator('.wall-connect-code strong').waitFor();
  return (await wall.locator('.wall-connect-code strong').textContent()) ?? '';
}

/** A phone opens the link in the wall's QR code (as the iPhone camera does). */
function scan(code: string): Promise<Page> {
  return h.open('phone', `pair-${code.replace('-', '')}`, { outside: true });
}

describe('from anywhere', () => {
  it('signs a phone in with the code on the wall, once', async () => {
    const wall = await h.open('wall', 'wall');
    const code = await shownCode(wall);
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(await wall.locator('.wall-connect-url').textContent()).toBe(h.outsideUrl.replace('http://', ''));

    // From the internet the board asks to sign in, even without a PIN.
    const stranger = await h.open('phone', 'board', { outside: true });
    await stranger.getByText('Scan the code on your wall').waitFor();
    expect(await stranger.getByLabel('PIN').count()).toBe(0);
    expect(await stranger.locator('.note').count()).toBe(0);

    // Scanning the code opens the board, signed in, without the code in the address.
    const phone = await scan(code);
    await phone.getByText('Signed in. This device stays signed in.').waitFor();
    await phone.getByText('Live').waitFor();
    expect(phone.url()).toMatch(/#board$/);

    // Its changes reach the wall.
    await phone.getByRole('button', { name: 'Add a note' }).click();
    await phone.getByRole('button', { name: /^To-do/ }).click();
    await phone.getByLabel('Title').fill('Renew passport');
    await phone.getByRole('dialog').getByRole('button', { name: 'Add to board' }).click();
    await wall.locator('.note', { hasText: 'Renew passport' }).waitFor({ timeout: 3000 });

    // The wall shows a new code at once, and the used one doesn't work again.
    await expect.poll(() => shownCode(wall)).not.toBe(code);
    const again = await scan(code);
    await again.getByText('That code has expired or was already used').waitFor();

    // Typing the wall's code works too (a Home Screen app can't scan).
    await again.getByLabel('Code from the wall').fill((await shownCode(wall)).toLowerCase());
    await again.getByRole('button', { name: 'Sign in' }).click();
    await again.getByText('Live').waitFor();
    await again.reload();
    await again.getByText('Live').waitFor();
  });

  it('connects another device from one that’s signed in', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await scan(await shownCode(wall));
    await phone.getByText('Live').waitFor();
    await phone.getByRole('button', { name: 'Wall', exact: true }).click();
    await phone.getByText('From anywhere: on.').waitFor();
    await phone.getByRole('button', { name: 'Connect another device' }).click();
    const code = (await phone.locator('.invite-code').textContent()) ?? '';
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    const laptop = await h.open('computer', 'board', { outside: true });
    await laptop.getByLabel('Code from the wall').fill(code);
    await laptop.getByRole('button', { name: 'Sign in' }).click();
    await laptop.getByText('Live').waitFor();
  });

  it('never lets the internet in as the wall computer', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await scan(await shownCode(wall));
    await phone.getByText('Live').waitFor();
    const answers = await phone.evaluate(async () => {
      const session = await (await fetch('api/session')).json();
      const code = (await fetch('api/pair-code')).status;
      const close = (await fetch('api/wall/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status;
      return { session, code, close };
    });
    expect(answers).toEqual({ session: { pinSet: false, signedIn: true, wallComputer: false, wallScreen: false, outside: true }, code: 403, close: 403 });
  });
});

describe('wall screens', () => {
  it('turns any device into a wall screen, and back', async () => {
    const wall = await h.open('wall', 'wall');
    await wall.locator('.wall-standalone').waitFor();

    // A laptop on the Wi-Fi becomes a wall screen.
    const laptop = await h.open('computer', 'display', HOME);
    await laptop.getByRole('button', { name: 'Use this device as a wall screen' }).click();
    await laptop.getByLabel('Name for this wall screen').fill('Kitchen laptop');
    await laptop.getByRole('button', { name: 'Show the wall here' }).click();
    await laptop.locator('.wall-standalone').waitFor();
    expect(laptop.url()).toMatch(/#wall$/);

    // Another device sees it, and the wall computer, showing the wall.
    const phone = await h.open('phone', 'display', HOME);
    const row = (name: string) => phone.locator('.screen-row', { hasText: name });
    await expect.poll(() => row('Kitchen laptop').textContent()).toContain('Showing the wall now');
    await expect.poll(() => row('Wall computer').textContent()).toContain('Showing the wall now');

    // Opened again, it goes straight to the wall; Edit the board opens the board.
    await laptop.goto(laptop.url().replace(/#.*$/, '#board'));
    await laptop.reload();
    await laptop.locator('.wall-standalone').waitFor();
    expect(laptop.url()).toMatch(/#wall$/);
    await laptop.mouse.move(600, 400);
    await laptop.getByRole('button', { name: 'Edit the board' }).click();
    await laptop.getByRole('button', { name: /Add a note|New note/ }).first().waitFor();
    expect(laptop.url()).toMatch(/#board$/);

    // Removed on the phone: it opens the board as usual again.
    await row('Kitchen laptop').getByRole('button', { name: 'Remove Kitchen laptop' }).click();
    await row('Kitchen laptop').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect.poll(() => row('Kitchen laptop').count()).toBe(0);
    await laptop.reload();
    await expect.poll(() => laptop.url()).toMatch(/#board$/);
    await laptop.getByRole('button', { name: /Add a note|New note/ }).first().waitFor();
    expect(await laptop.locator('.wall-standalone').count()).toBe(0);
  });

  it('lets a wall screen show the sign-in code, but not other devices', async () => {
    const laptop = await h.open('computer', 'display', HOME);
    await laptop.getByRole('button', { name: 'Use this device as a wall screen' }).click();
    await laptop.getByRole('button', { name: 'Show the wall here' }).click();
    await laptop.locator('.wall-standalone').waitFor();
    expect(await shownCode(laptop)).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const phone = await h.open('phone', 'wall', HOME);
    await phone.locator('.wall-connect').waitFor();
    await phone.waitForTimeout(500);
    expect(await phone.locator('.wall-connect-code').count()).toBe(0);
  });
});
