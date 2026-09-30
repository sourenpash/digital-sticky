// Renders the prototype in headless Chromium and saves PNGs to docs/screenshots.
// Usage: npm run build && npm run screenshots [-- name-filter]
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright-core';
import { preview } from 'vite';

const OUT = 'docs/screenshots'; // curated shots referenced by the README
const REVIEW = '.screenshots'; // everything else (git-ignored)
const NOW = '2026-09-30T19:42:00'; // a Wednesday evening, so the sample dates are stable

interface Shot {
  name: string;
  query: string;
  hash: string;
  viewport: { width: number; height: number };
  scale?: number;
  mobile?: boolean;
  colorScheme?: 'light' | 'dark';
  act?: (page: Page) => Promise<void>;
  /** Commit this one to docs/screenshots. */
  keep?: boolean;
}

const phone = { width: 390, height: 844 };
const hd = { width: 1920, height: 1080 };

const desktop = { width: 1440, height: 900 };
const openNsf = async (page: Page) => {
  await page.getByRole('button', { name: /NSF CAREER proposal/ }).first().click();
  await page.waitForTimeout(400);
};
const openAdd = async (page: Page) => {
  await page.getByRole('button', { name: /Add a note|New note/ }).first().click();
  await page.waitForTimeout(300);
};

const shots: Shot[] = [
  { keep: true, name: 'wall-day', query: 'preset=day', hash: 'wall', viewport: hd },
  { name: 'wall-banner-qr', query: 'preset=day,banner,qr', hash: 'wall', viewport: hd },
  { keep: true, name: 'wall-night-dim', query: 'preset=dim', hash: 'wall', viewport: hd },
  { name: 'wall-night-clock', query: 'preset=clock', hash: 'wall', viewport: hd },
  { keep: true, name: 'demo-side-by-side', query: 'preset=day', hash: 'demo', viewport: { width: 1600, height: 1000 } },
  { keep: true, name: 'phone-board', query: 'preset=day', hash: 'board', viewport: phone, scale: 2, mobile: true },
  { name: 'phone-board-dark', query: 'preset=day', hash: 'board', viewport: phone, scale: 2, mobile: true, colorScheme: 'dark' },
  { keep: true, name: 'phone-note', query: 'preset=day', hash: 'board', viewport: phone, scale: 2, mobile: true, act: openNsf },
  { name: 'phone-add-menu', query: 'preset=day', hash: 'board', viewport: phone, scale: 2, mobile: true, act: openAdd },
  {
    name: 'phone-new-application',
    query: 'preset=day',
    hash: 'board',
    viewport: phone,
    scale: 2,
    mobile: true,
    act: async page => {
      await openAdd(page);
      await page.getByRole('button', { name: /Funding application/ }).click();
      await page.waitForTimeout(400);
    },
  },
  { name: 'phone-calendar', query: 'preset=day', hash: 'calendar', viewport: phone, scale: 2, mobile: true },
  { name: 'phone-to-check', query: 'preset=day', hash: 'check', viewport: phone, scale: 2, mobile: true },
  { name: 'phone-wall-settings', query: 'preset=day', hash: 'display', viewport: phone, scale: 2, mobile: true },
  { name: 'phone-pin', query: 'preset=day', hash: 'login', viewport: phone, scale: 2, mobile: true },
  { keep: true, name: 'desktop-board', query: 'preset=day', hash: 'board', viewport: desktop, act: openNsf },
  { name: 'desktop-calendar', query: 'preset=day', hash: 'calendar', viewport: desktop },
  { name: 'desktop-wall-settings', query: 'preset=day,qr', hash: 'display', viewport: desktop },
];

const filter = process.argv[2];
await mkdir(OUT, { recursive: true });
await mkdir(REVIEW, { recursive: true });
const server = await preview({ preview: { port: 4173, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });

try {
  for (const shot of shots) {
    if (filter && !shot.name.includes(filter)) continue;
    const context = await browser.newContext({
      viewport: shot.viewport,
      deviceScaleFactor: shot.scale ?? 1,
      isMobile: shot.mobile ?? false,
      hasTouch: shot.mobile ?? false,
      colorScheme: shot.colorScheme ?? 'light',
    });
    const page = await context.newPage();
    page.on('pageerror', err => console.error(`[${shot.name}] page error:`, err.message));
    await page.goto(`http://localhost:4173/?now=${NOW}&proto=0&${shot.query}#${shot.hash}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
    if (shot.act) await shot.act(page);
    const path = `${shot.keep ? OUT : REVIEW}/${shot.name}.png`;
    await page.screenshot({ path });
    console.log(`saved ${path}`);
    await context.close();
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
