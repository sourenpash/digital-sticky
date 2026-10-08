import { createECDH, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Locator } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { IMessageInfo } from '../shared/api.ts';
import { makeEmptyBoard } from '../shared/defaults.ts';
import type { Note } from '../shared/types.ts';
import { Harness } from './harness.ts';

// Reminders away from the wall: texts through iMessage and notifications on phones.
// Stand-ins play BlueBubbles and the push services, so no text or notification is
// sent anywhere; the test plays BlueBubbles' side when someone texts back.

const ece = createRequire(import.meta.url)('http_ece') as { decrypt: (body: Buffer, params: object) => Buffer };

function seed() {
  const board = makeEmptyBoard();
  const stamp = new Date().toISOString();
  const note: Note = { id: 'call', laneId: 'remind', title: 'Call the financial office', body: '', checklist: [], links: [], pinned: false, done: false, createdAt: stamp, updatedAt: stamp };
  board.notes = [note];
  board.settings.night.mode = 'off'; // reminders go to phones whatever the hour
  return board;
}

const h = new Harness(seed);
const text = (locator: Locator) => () => locator.first().textContent().catch(() => '');

beforeAll(() => h.launch());
afterAll(() => h.close());
beforeEach(() => h.setUp());
afterEach(async () => {
  await h.tearDown();
  expect(h.pageErrors).toEqual([]);
});

/** The reminder goes off now. */
function remindNow(): void {
  const at = new Date(h.server!.store.now().getTime() - 30_000).toISOString();
  h.server!.store.apply({ type: 'note.patch', id: 'call', patch: { remindAt: at } });
}

const call = () => h.server!.store.board.notes.find(n => n.id === 'call')!;

describe('texts through iMessage', () => {
  it('texts a reminder when it goes off, and texting done finishes the sticky', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'display');

    // Set up in the Wall tab.
    await phone.getByLabel('BlueBubbles Server’s address').fill('http://mac-mini.local:1234');
    await phone.getByLabel('Its password').fill('hunter2');
    await phone.getByLabel('Phone number or Apple ID').fill('+1 555 010 4477');
    await phone.getByRole('button', { name: 'Add this number' }).click();
    await phone.getByRole('form', { name: 'Texts settings' }).getByRole('button', { name: 'Save' }).click();
    await phone.getByText('Saved. Send a test text to check it works.').waitFor();
    expect(await phone.content()).not.toContain('hunter2');

    // The reminder goes off: on the wall, and by text.
    remindNow();
    await wall.locator('.wall-banner', { hasText: 'Call the financial office' }).waitFor({ timeout: 5000 });
    await expect.poll(() => h.texts.length, { timeout: 5000 }).toBe(1);
    const [reminder] = h.texts;
    expect(reminder!.url).toBe('http://mac-mini.local:1234/api/v1/message/text?password=hunter2');
    expect(JSON.parse(reminder!.body.toString())).toMatchObject({
      chatGuid: 'iMessage;-;+15550104477',
      message: expect.stringMatching(/^Reminder · \d{1,2}(:\d{2})? (AM|PM): Call the financial office\nText done, or snooze 1h\.$/),
      method: 'apple-script',
    });

    // "done", texted back: BlueBubbles posts it to the board's link.
    const info = (await (await fetch(`http://127.0.0.1:${h.port}/api/imessage`)).json()) as IMessageInfo;
    const hook = await fetch(`http://127.0.0.1:${h.port}${info.webhook.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'new-message', data: { guid: 'm1', text: 'Done', isFromMe: false, handle: { address: '+15550104477' }, chats: [{ guid: 'iMessage;-;+15550104477' }] } }),
    });
    expect(await hook.json()).toEqual({ ok: true, replied: true });
    expect(call().done).toBe(true);
    await expect.poll(() => wall.locator('.wall-banner').count()).toBe(0);
    expect(JSON.parse(h.texts[1]!.body.toString()).message).toBe('Done: “Call the financial office”. (To undo it, untick it in the app.)');
    // The Wall tab says what came in.
    await expect.poll(text(phone.locator('#texts .set-note').last())).toMatch(/Last text in .+: “Done”\./);

    // A wrong link, or someone not on the list, gets nowhere.
    const wrong = await fetch(`http://127.0.0.1:${h.port}/hooks/imessage/wrong`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(wrong.status).toBe(404);
  });
});

describe('notifications', () => {
  it('sends a reminder to a phone’s push service, which its service worker shows', async () => {
    // A phone's subscription (made up here: a real one comes from the phone's push service).
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const auth = randomBytes(16);
    const subscription = { endpoint: 'https://web.push.apple.com/QGuQyavXutnMH-e2e', keys: { p256dh: ecdh.getPublicKey('base64url'), auth: auth.toString('base64url') } };
    const added = await fetch(`http://127.0.0.1:${h.port}/api/push/devices`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription, name: 'iPhone' }) });
    expect(added.status).toBe(201);

    // The phone's app has the service worker, and may show notifications.
    const phone = await h.open('phone', 'display');
    await phone.context().grantPermissions(['notifications'], { origin: `http://127.0.0.1:${h.port}` });
    const cdp = await phone.context().newCDPSession(phone);
    const registrations = new Map<string, string>();
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations: list }: { registrations: Array<{ registrationId: string; scopeURL: string }> }) => {
      for (const registration of list) registrations.set(registration.scopeURL, registration.registrationId);
    });
    await cdp.send('ServiceWorker.enable');
    await phone.evaluate(async () => {
      await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
    });
    await phone.getByRole('list', { name: 'Devices that get notifications' }).getByText('iPhone').waitFor();

    // The reminder goes off: the board encrypts it for the phone and hands it to the push service.
    remindNow();
    await expect.poll(() => h.pushes.length, { timeout: 5000 }).toBe(1);
    const [push] = h.pushes;
    expect(push!.url).toBe(subscription.endpoint);
    const notice = JSON.parse(ece.decrypt(push!.body, { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString()) as { title: string; body: string; url: string };
    expect(notice).toMatchObject({ title: expect.stringMatching(/^Reminder · /), body: 'Call the financial office', url: '#note-call' });

    // The push service delivers it to the phone: the service worker shows it.
    const scope = `http://127.0.0.1:${h.port}/`;
    await expect.poll(() => registrations.get(scope)).toBeTruthy();
    await cdp.send('ServiceWorker.deliverPushMessage', { origin: `http://127.0.0.1:${h.port}`, registrationId: registrations.get(scope)!, data: JSON.stringify(notice) });
    await expect
      .poll(() => phone.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ title: n.title, body: n.body }))), { timeout: 5000 })
      .toEqual([{ title: notice.title, body: 'Call the financial office' }]);

    // Night mode (with "Quiet during night mode", as it starts): nothing more is sent.
    h.server!.store.apply({ type: 'settings.patch', patch: { night: { mode: 'on' } } });
    h.server!.store.apply({ type: 'alert.dismiss', id: h.server!.store.board.alerts[0]!.id });
    const later = new Date(h.server!.store.now().getTime() - 10_000).toISOString();
    h.server!.store.apply({ type: 'note.patch', id: 'call', patch: { remindAt: later } });
    await expect.poll(() => h.server!.store.board.alerts.length, { timeout: 5000 }).toBe(1);
    expect(h.pushes).toHaveLength(1);
  });
});
