// Renders the app in headless Chromium against a real board server and saves PNGs.
// Each shot gets a fresh server with the sample board (dated around NOW).
// Usage: npm run build && npm run screenshots [-- name-filter]
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import type { StateResponse } from '../shared/api.ts';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { makeSampleBoard, SAMPLE_CONNECT_URL } from '../shared/sample.ts';
import { startServer, type RunningServer } from '../server/server.ts';
import { fakeTickerFetch } from '../e2e/tickerFixtures.ts';

const OUT = 'docs/screenshots'; // curated shots referenced by the README
const REVIEW = '.screenshots'; // everything else (git-ignored)
const NOW = '2026-09-30T19:42:00'; // a Wednesday evening, so the sample dates are stable
const PORT = 4173;

interface Api {
  get(path: string): Promise<unknown>;
  send(method: string, path: string, body: unknown): Promise<unknown>;
}

interface Shot {
  name: string;
  hash: string;
  viewport: { width: number; height: number };
  scale?: number;
  mobile?: boolean;
  colorScheme?: 'light' | 'dark';
  /** Start from a brand-new board instead of the sample one. */
  empty?: boolean;
  /** Change the board through the API before the page opens. */
  setup?: (api: Api) => Promise<void>;
  act?: (page: Page, server: RunningServer, kiosk: Page | null) => Promise<void>;
  /** Commit this one to docs/screenshots. */
  keep?: boolean;
  /** Lock the board with a PIN, and open the page as a phone on the Wi-Fi (not the wall computer). */
  pin?: boolean;
  /** Run the wall computer's browser too (for the remote), showing what this opens. */
  kiosk?: (kiosk: Page, base: string) => Promise<void>;
  /** Save the wall computer's browser instead of the page. */
  shootKiosk?: boolean;
}

const phone = { width: 390, height: 844 };
const hd = { width: 1920, height: 1080 };
const desktop = { width: 1440, height: 900 };
const onPhone = { viewport: phone, scale: 2, mobile: true };

const nightMode = (style: 'dim' | 'clock') => (api: Api) => api.send('PATCH', '/api/settings', { night: { mode: 'on', style } }).then(() => {});
const popUpReminder = async (api: Api) => {
  const { board } = (await api.get('/api/state')) as StateResponse;
  const reminder = board.notes.find(note => note.laneId === 'remind' && note.remindAt);
  if (reminder) await api.send('POST', '/api/alerts', { noteId: reminder.id });
  await api.send('PATCH', '/api/settings', { wall: { showConnect: true } });
};

const openNsf = async (page: Page) => {
  await page.getByRole('button', { name: /NSF CAREER proposal/ }).first().click();
  await page.waitForTimeout(400);
};
const openAdd = async (page: Page) => {
  await page.getByRole('button', { name: /Add a note|New note/ }).first().click();
  await page.waitForTimeout(300);
};
const openGoal = async (page: Page) => {
  await page.getByRole('button', { name: /Submit 5 applications/ }).first().click();
  await page.waitForTimeout(400);
};
const openRoutine = async (page: Page) => {
  await page.getByRole('button', { name: /Write for an hour/ }).first().click();
  await page.waitForTimeout(400);
};
const showLane = (name: string) => async (page: Page) => {
  await page.getByRole('region', { name }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
};
const showSetting = (name: string) => async (page: Page) => {
  await page.getByRole('heading', { name }).evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
};

/** Made-up websites for the wall computer's browser. */
const site = (title: string, body: string) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><title>${title}</title><style>body{margin:0;height:100vh;display:grid;place-items:center;background:#f6f4ef;color:#2a2723;font:28px system-ui,sans-serif}input,button{font:inherit}input{width:640px;padding:16px 26px;border:2px solid #c9c4ba;border-radius:999px;background:#fff}</style>${body}`)}`;
const recipes = site('Recipes · Search', '<form><h1>What are we cooking?</h1><input id="q" placeholder="Search recipes" autofocus></form>');
const playlists = site('My playlists', '<main><h1>Evening focus</h1><p>42 songs</p></main>');
const waitConnected = (page: Page) => page.getByText('Connected', { exact: true }).waitFor({ timeout: 10_000 });

const shots: Shot[] = [
  { keep: true, name: 'wall-day', hash: 'wall', viewport: hd },
  { keep: true, name: 'wall-first-day', hash: 'wall', viewport: hd, empty: true },
  { name: 'wall-banner-qr', hash: 'wall', viewport: hd, setup: popUpReminder },
  { keep: true, name: 'wall-night-dim', hash: 'wall', viewport: hd, setup: nightMode('dim') },
  { name: 'wall-night-clock', hash: 'wall', viewport: hd, setup: nightMode('clock') },
  { keep: true, name: 'demo-side-by-side', hash: 'demo', viewport: { width: 1600, height: 1000 } },
  {
    keep: true,
    name: 'demo-remote',
    hash: 'demo',
    viewport: { width: 1600, height: 1000 },
    act: async page => {
      const phone = page.locator('.phone-screen');
      await phone.getByRole('button', { name: 'Wall', exact: true }).click();
      await phone.getByRole('button', { name: /Control the wall screen/ }).click();
      const pad = await phone.locator('.pad').boundingBox();
      if (!pad) throw new Error('no touchpad');
      await page.mouse.move(pad.x + pad.width * 0.3, pad.y + pad.height * 0.5);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(pad.x + pad.width * (0.3 + i * 0.02), pad.y + pad.height * (0.5 + i * 0.012));
      await page.mouse.up();
      await page.waitForTimeout(150);
    },
  },
  { keep: true, name: 'phone-board', hash: 'board', ...onPhone },
  { keep: true, name: 'phone-pin', hash: 'board', ...onPhone, pin: true },
  { keep: true, name: 'phone-reminder', hash: 'board', ...onPhone, setup: popUpReminder },
  { name: 'phone-board-dark', hash: 'board', ...onPhone, colorScheme: 'dark' },
  { name: 'phone-first-day', hash: 'board', ...onPhone, empty: true },
  { keep: true, name: 'phone-note', hash: 'board', ...onPhone, act: openNsf },
  { name: 'phone-add-menu', hash: 'board', ...onPhone, act: openAdd },
  { keep: true, name: 'phone-goal', hash: 'board', ...onPhone, act: openGoal },
  { keep: true, name: 'phone-recurring', hash: 'board', ...onPhone, act: openRoutine },
  { name: 'phone-recurring-lane', hash: 'board', ...onPhone, act: showLane('Recurring') },
  {
    name: 'phone-new-goal',
    hash: 'board',
    ...onPhone,
    act: async page => {
      await openAdd(page);
      await page.getByRole('button', { name: /^Goal/ }).click();
      await page.waitForTimeout(400);
    },
  },
  {
    keep: true,
    name: 'phone-new-application',
    hash: 'board',
    ...onPhone,
    act: async page => {
      await openAdd(page);
      await page.getByRole('button', { name: /^Application/ }).click();
      await page.getByRole('radio', { name: 'Job' }).click();
      await page.locator('.ne-scroll').evaluate(el => el.scrollTo(0, 0));
      await page.waitForTimeout(400);
    },
  },
  {
    keep: true,
    name: 'phone-job',
    hash: 'board',
    ...onPhone,
    act: async page => {
      await page.getByRole('button', { name: /Research Scientist/ }).first().click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'phone-offline',
    hash: 'board',
    ...onPhone,
    act: async (page, server) => {
      await server.stop();
      await openNsf(page);
      await page.getByRole('checkbox', { name: 'Budget + justification' }).click();
      await page.getByRole('button', { name: 'Close' }).click();
      await page.getByText(/Offline · 1 waiting/).waitFor({ timeout: 10_000 });
    },
  },
  { name: 'phone-calendar', hash: 'calendar', ...onPhone },
  { name: 'phone-to-check', hash: 'check', ...onPhone },
  { keep: true, name: 'phone-wall-settings', hash: 'display', ...onPhone, act: showSetting('Columns') },
  { keep: true, name: 'phone-ticker-settings', hash: 'display', ...onPhone, act: showSetting('Ticker') },
  {
    keep: true,
    name: 'phone-remote',
    hash: 'remote',
    ...onPhone,
    kiosk: kiosk => kiosk.goto(recipes).then(() => {}),
    act: async page => {
      await waitConnected(page);
      await page.getByText('Tap to type').waitFor({ timeout: 10_000 });
    },
  },
  {
    keep: true,
    name: 'phone-remote-typing',
    hash: 'remote',
    ...onPhone,
    kiosk: kiosk => kiosk.goto(recipes).then(() => {}),
    act: async page => {
      await waitConnected(page);
      await page.getByRole('button', { name: /Tap to type/ }).click();
      await page.keyboard.type('banana bread');
      await page.waitForTimeout(600);
    },
  },
  {
    keep: true,
    name: 'phone-remote-question',
    hash: 'remote',
    ...onPhone,
    kiosk: async kiosk => {
      kiosk.on('dialog', () => {}); // leave it open for the phone to answer
      await kiosk.goto(playlists);
    },
    act: async (page, _server, kiosk) => {
      await waitConnected(page);
      await kiosk?.evaluate(() => void setTimeout(() => confirm('Delete this playlist?'), 0));
      await page.locator('.remote-dialog').waitFor({ timeout: 10_000 });
    },
  },
  { name: 'phone-remote-offline', hash: 'remote', ...onPhone },
  {
    keep: true,
    name: 'wall-remote-cursor',
    hash: 'remote',
    ...onPhone,
    shootKiosk: true,
    kiosk: async (kiosk, base) => {
      await kiosk.goto(`${base}/?now=${NOW}#wall`);
      await kiosk.locator('.wall').waitFor();
      await kiosk.evaluate(() => document.fonts.ready);
    },
    act: async (page, _server, kiosk) => {
      await waitConnected(page);
      const pad = await page.locator('.pad').boundingBox();
      if (!pad) throw new Error('no touchpad');
      await page.mouse.move(pad.x + pad.width * 0.5, pad.y + pad.height * 0.5);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(pad.x + pad.width * (0.5 - i * 0.031), pad.y + pad.height * (0.5 - i * 0.0085));
      await page.mouse.up();
      await kiosk?.waitForTimeout(800);
    },
  },
  { keep: true, name: 'desktop-board', hash: 'board', viewport: desktop, act: openNsf },
  { name: 'desktop-goal', hash: 'board', viewport: desktop, act: openGoal },
  { name: 'desktop-board-closed', hash: 'board', viewport: desktop },
  { name: 'desktop-calendar', hash: 'calendar', viewport: desktop },
  { name: 'desktop-wall-settings', hash: 'display', viewport: desktop },
];

const filter = process.argv[2];
const staticDir = resolve('dist/web');
const { buildId } = JSON.parse(await readFile(join(staticDir, 'build.json'), 'utf8')) as { buildId: string };
await mkdir(OUT, { recursive: true });
await mkdir(REVIEW, { recursive: true });
const executablePath = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath });
const KIOSK_DEBUG_PORT = 9555;

try {
  for (const shot of shots) {
    if (filter && !shot.name.includes(filter)) continue;
    const dataDir = await mkdtemp(join(tmpdir(), 'sticky-shot-'));
    // The server's clock starts at NOW too, so reminders go off as they would that evening.
    const offset = Date.parse(NOW) - Date.now();
    const server = await startServer({
      port: PORT,
      host: '127.0.0.1',
      dataDir,
      seed: shot.empty ? makeEmptyBoard : () => makeSampleBoard(new Date(NOW)),
      staticDir,
      connectUrl: SAMPLE_CONNECT_URL,
      buildId,
      now: () => new Date(Date.now() + offset),
      tickerFetch: fakeTickerFetch,
      pin: shot.pin ? '482915' : null,
      remoteDebugPort: shot.kiosk ? KIOSK_DEBUG_PORT : null,
    });
    const base = `http://127.0.0.1:${PORT}`;
    // The wall computer's browser, with the debugging port the remote uses.
    const kioskBrowser = shot.kiosk ? await chromium.launch({ executablePath, args: [`--remote-debugging-port=${KIOSK_DEBUG_PORT}`] }) : null;
    const kiosk = kioskBrowser ? await (await kioskBrowser.newContext({ viewport: hd })).newPage() : null;
    if (kiosk) await shot.kiosk?.(kiosk, base);
    const api: Api = {
      get: async path => (await fetch(base + path)).json(),
      send: async (method, path, body) =>
        (await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(),
    };
    await shot.setup?.(api);

    const context = await browser.newContext({
      viewport: shot.viewport,
      deviceScaleFactor: shot.scale ?? 1,
      isMobile: shot.mobile ?? false,
      hasTouch: shot.mobile ?? false,
      colorScheme: shot.colorScheme ?? 'light',
      extraHTTPHeaders: shot.pin ? { 'X-Forwarded-For': '203.0.113.7' } : undefined,
    });
    const page = await context.newPage();
    page.on('pageerror', err => console.error(`[${shot.name}] page error:`, err.message));
    await page.goto(`${base}/?now=${NOW}#${shot.hash}`);
    await page.locator('.wall, .editor, .demo, .remote, .login').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
    if (shot.act) await shot.act(page, server, kiosk);
    const path = `${shot.keep ? OUT : REVIEW}/${shot.name}.png`;
    await (shot.shootKiosk && kiosk ? kiosk : page).screenshot({ path });
    console.log(`saved ${path}`);
    await context.close();
    await server.stop();
    await kioskBrowser?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
} finally {
  await browser.close();
}
