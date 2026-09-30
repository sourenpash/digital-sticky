import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RemoteCommand, RemoteStatus } from '../shared/remote.ts';
import { makeSampleBoard } from '../shared/sample.ts';
import { Harness } from './harness.ts';

// The phone remote driving the wall computer's browser. The kiosk script starts that
// browser (Chromium, headless) the way it does on the wall computer, and a small web
// server stands in for other websites.

const NOW = '2026-09-30T19:42:00';
const h = new Harness(() => makeSampleBoard(new Date(NOW)), { query: `?now=${NOW}`, now: NOW, kiosk: true });

const TEST_PAGE = `<!doctype html><html><head><title>Test page</title><style>
  body { margin: 0; font: 20px sans-serif; }
  #name { position: absolute; left: 600px; top: 400px; width: 320px; height: 44px; font: 20px monospace; }
  #more { position: absolute; left: 100px; top: 100px; }
  #ask { position: absolute; left: 100px; top: 700px; font-size: 20px; }
  #tell { position: absolute; left: 400px; top: 700px; font-size: 20px; }
</style></head><body>
<form id="form"><input id="name" autocomplete="off"></form>
<a id="more" href="/second" target="_blank">Open another tab</a>
<button id="ask">Ask</button><button id="tell">Tell</button>
<script>
  document.getElementById('form').addEventListener('submit', event => {
    event.preventDefault();
    document.title = 'Sent: ' + document.getElementById('name').value;
  });
  document.getElementById('ask').addEventListener('click', () => { document.title = 'Answer: ' + confirm('Delete it?'); });
  document.getElementById('tell').addEventListener('click', () => { alert('Hello'); document.title = 'Told'; });
  window.keys = [];
  document.addEventListener('keydown', event => { if (document.activeElement === document.body) window.keys.push(event.key); });
</script></body></html>`;

let site: Server;
let siteUrl = '';

beforeAll(async () => {
  await h.launch();
  site = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(request.url === '/second' ? '<!doctype html><title>Second tab</title><p>Second</p>' : TEST_PAGE);
  });
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
});
afterAll(async () => {
  await h.close();
  site.close();
});
beforeEach(() => h.setUp());
afterEach(async () => {
  await h.tearDown();
  expect(h.pageErrors).toEqual([]);
});

const onWall = (url: string) => /^http:\/\/localhost:\d+\/#wall$/.test(url);
const onSite = (url: string) => url.startsWith(siteUrl);

/** Sends commands like the phone does (from this computer, so no PIN is needed). */
async function send(...commands: RemoteCommand[]): Promise<Response> {
  return fetch(`http://127.0.0.1:${h.port}/api/remote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commands }) });
}

async function remote(...commands: RemoteCommand[]): Promise<RemoteStatus & { available: true }> {
  const response = await send(...commands);
  expect(response.status).toBe(200);
  const status = (await response.json()) as RemoteStatus;
  if (!status.available) throw new Error('The remote says the wall is unavailable');
  return status;
}

/** Puts the cursor on an element of the page on the wall: into the corner, then across (moves are in 1920-wide wall pixels). */
async function pointAt(selector: string, match = onSite): Promise<void> {
  const { x, y, width } = await h.kiosk!.evaluate<{ x: number; y: number; width: number }>(
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + Math.min(12, r.width / 2), y: r.y + r.height / 2, width: document.documentElement.clientWidth }; })()`,
    match,
  );
  const scale = 1920 / width;
  await remote({ type: 'move', dx: -5000, dy: -5000 }, { type: 'move', dx: x * scale, dy: y * scale });
}

const tabCount = async () => (await h.kiosk!.tabs()).length;
const inSite = <T,>(expression: string) => () => h.kiosk!.evaluate<T>(expression, onSite).catch(() => null);
const showing = (phone: Page) => () => phone.locator('.remote-showing').innerText().catch(() => '');

async function tapPad(phone: Page): Promise<void> {
  const pad = (await phone.locator('.pad').boundingBox())!;
  await phone.mouse.click(pad.x + pad.width / 2, pad.y + pad.height / 2);
}

describe('phone remote', () => {
  it('moves, taps and types on the wall, answers a website and comes back to the board', async () => {
    const kiosk = h.kiosk!;
    const phone = await h.open('phone', 'remote');
    await expect.poll(() => phone.locator('.remote-status').innerText()).toBe('Connected');

    // Dragging on the touchpad moves the cursor the remote draws on the wall.
    const pad = (await phone.locator('.pad').boundingBox())!;
    await phone.mouse.move(pad.x + 100, pad.y + 100);
    await phone.mouse.down();
    await phone.mouse.move(pad.x + 160, pad.y + 140, { steps: 6 });
    await phone.mouse.up();
    const cursor = () => kiosk.evaluate<string | null>(`document.getElementById('__sticky_wall_cursor__')?.style.transform ?? null`, onWall);
    await expect.poll(cursor).toMatch(/^translate\(\d+px, \d+px\)$/);
    expect(await cursor()).not.toBe('translate(960px, 540px)');

    // A website opens in a tab over the wall.
    await phone.getByRole('button', { name: 'Website' }).click();
    await phone.getByLabel('Website to open on the wall').fill(siteUrl);
    await phone.getByRole('button', { name: 'Open' }).click();
    await expect.poll(tabCount).toBe(2);
    await expect.poll(showing(phone)).toContain('Test page');

    // A tap on a text box selects it; the phone offers to type, and letters show up as typed.
    await pointAt('#name');
    await tapPad(phone);
    await expect.poll(inSite('document.activeElement.id')).toBe('name');
    await phone.getByRole('button', { name: /Tap to type/ }).click();
    await phone.keyboard.type('hello');
    await expect.poll(inSite('document.getElementById("name").value')).toBe('hello');
    await phone.keyboard.press('Backspace');
    await phone.keyboard.press('Backspace');
    await expect.poll(inSite('document.getElementById("name").value')).toBe('hel');
    await phone.keyboard.press('Enter');
    await expect.poll(inSite('document.title')).toBe('Sent: hel');

    // The website's OK / Cancel question is answered on the phone.
    await pointAt('#ask');
    await tapPad(phone);
    await expect.poll(() => phone.locator('.remote-dialog').innerText().catch(() => '')).toContain('Delete it?');
    await phone.locator('.remote-dialog').getByRole('button', { name: 'OK' }).click();
    await expect.poll(inSite('document.title')).toBe('Answer: true');
    await expect.poll(() => phone.locator('.remote-dialog').count()).toBe(0);

    // A link that opens another tab: the remote follows it, and Back closes it again.
    await pointAt('#more');
    await tapPad(phone);
    await expect.poll(tabCount).toBe(3);
    await expect.poll(showing(phone)).toContain('Second tab');
    await phone.getByRole('button', { name: 'Back', exact: true }).click();
    await expect.poll(tabCount).toBe(2);
    await expect.poll(showing(phone)).toContain('Answer: true');

    // Board closes the website; the wall was running underneath all along.
    await phone.getByRole('button', { name: 'Board', exact: true }).click();
    await expect.poll(tabCount).toBe(1);
    await expect.poll(() => phone.locator('.remote-showing').count()).toBe(0);
    expect(await kiosk.evaluate<boolean>('!!document.querySelector(".wall")', onWall)).toBe(true);
  });

  it('double-clicks, presses keys, handles messages and keeps away from the debugging port', async () => {
    await remote({ type: 'open', url: siteUrl });
    await expect.poll(inSite('document.title')).toBe('Test page');
    expect(await (await fetch(`http://127.0.0.1:${h.port}/api/remote`)).json()).toMatchObject({ available: true, onBoard: false, field: null, dialog: null, title: 'Test page' });

    // Typing into a text box, then a double click on the first word selects it.
    await pointAt('#name');
    expect(await remote({ type: 'click' }, { type: 'text', text: 'two words' })).toMatchObject({ field: 'text' });
    expect(await inSite('document.getElementById("name").value')()).toBe('two words');
    await remote({ type: 'click' }, { type: 'click' });
    expect(await inSite('(el => el.value.slice(el.selectionStart, el.selectionEnd))(document.getElementById("name"))')()).toBe('two');

    // Keys work like a keyboard's: Backspace deletes, Tab moves on.
    await remote({ type: 'key', key: 'ArrowRight' }, { type: 'key', key: 'Backspace' });
    expect(await inSite('document.getElementById("name").value')()).toBe('tw words');
    await remote({ type: 'key', key: 'Tab' });
    expect(await inSite('document.activeElement.id')()).toBe('more');

    // With no text box selected, typed letters arrive as key presses (for website shortcuts).
    await pointAt('body');
    await remote({ type: 'click' }, { type: 'text', text: 'k ' });
    expect(await inSite('window.keys')()).toEqual(['k', ' ']);

    // A message just goes away by itself; a question waits for an answer.
    await pointAt('#tell');
    await remote({ type: 'click' });
    await expect.poll(inSite('document.title')).toBe('Told');
    await pointAt('#ask');
    expect((await remote({ type: 'click' })).dialog).toEqual({ message: 'Delete it?' });
    expect((await remote({ type: 'dialog', accept: false })).dialog).toBeNull();
    await expect.poll(inSite('document.title')).toBe('Answer: false');

    // The browser's own debugging port can't be opened.
    const refused = await send({ type: 'open', url: `http://127.0.0.1:${h.kioskPort}/json/list` });
    expect(refused.status).toBe(400);
    expect(await tabCount()).toBe(2);

    // Back on the website's first page closes its tab.
    expect(await remote({ type: 'back' })).toMatchObject({ onBoard: true });
    expect(await tabCount()).toBe(1);
  });

  it('loads the wall again after its page crashes, or fails to load while the board is down', async () => {
    const kiosk = h.kiosk!;
    const wallUp = () => kiosk.evaluate<boolean>('location.protocol === "http:" && !window.before && !!document.querySelector(".wall")', onWall).catch(() => false);

    // "Aw, Snap!": the page crashed (while a phone had the remote open).
    expect(await (await fetch(`http://127.0.0.1:${h.port}/api/remote`)).json()).toMatchObject({ available: true, onBoard: true });
    await kiosk.evaluate('window.before = true', onWall);
    await kiosk.send('Page.crash', {}, onWall, false);
    await expect.poll(wallUp, { timeout: 20_000 }).toBe(true);

    // The wall reloaded while the board server was down, and got an error page.
    await h.stop();
    await kiosk.evaluate('window.before = true; setTimeout(() => location.reload(), 50)', onWall);
    await expect.poll(() => kiosk.evaluate<string>('location.href', onWall).catch(() => ''), { timeout: 10_000 }).toMatch(/^chrome-error:/);
    await h.start();
    await expect.poll(wallUp, { timeout: 20_000 }).toBe(true);
  });
});
