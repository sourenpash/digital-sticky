import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { Board } from '../shared/types.ts';
import { startServer, type RunningServer } from '../server/server.ts';
import { fakeTickerFetch } from './tickerFixtures.ts';

// A real board server in a temp folder, and Chromium pages playing the phone, a
// computer and the wall. Chromium comes from Playwright's browser folder; set
// PW_CHROMIUM to use another one.

const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const staticDir = resolve('dist/web');

export type Device = 'phone' | 'computer' | 'wall';

const VIEWPORTS: Record<Device, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  computer: { width: 1440, height: 900 },
  wall: { width: 1920, height: 1080 },
};

export class Harness {
  server: RunningServer | null = null;
  dataDir = '';
  port = 0;
  pageErrors: string[] = [];
  private browser: Browser | null = null;
  private contexts: BrowserContext[] = [];
  private readonly seed: (now: Date) => Board;
  /** Added to page addresses, e.g. `?now=…` for sample-board dates. */
  private readonly query: string;
  /** Where the server's clock starts (it then runs normally), to match `?now=` pages. */
  private readonly startAt: string | undefined;
  private readonly pin: string | undefined;
  private offset = 0;

  constructor(seed: (now: Date) => Board, { query = '', now, pin }: { query?: string; now?: string; pin?: string } = {}) {
    this.seed = seed;
    this.query = query;
    this.startAt = now;
    this.pin = pin;
  }

  async launch(): Promise<void> {
    this.browser = await chromium.launch({ executablePath: CHROMIUM });
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }

  /** A fresh, empty data folder and a server on a free port. */
  async setUp(): Promise<void> {
    this.dataDir = await mkdtemp(join(tmpdir(), 'sticky-e2e-'));
    this.port = 0;
    this.pageErrors = [];
    this.offset = this.startAt ? Date.parse(this.startAt) - Date.now() : 0;
    await this.start();
  }

  async tearDown(): Promise<void> {
    await Promise.all(this.contexts.map(context => context.close()));
    this.contexts = [];
    await this.stop();
    await rm(this.dataDir, { recursive: true, force: true });
  }

  /** Starts (or restarts) the server on the same port and folder. */
  async start(): Promise<void> {
    const { buildId } = JSON.parse(await readFile(join(staticDir, 'build.json'), 'utf8')) as { buildId: string };
    this.server = await startServer({
      port: this.port,
      host: '127.0.0.1',
      dataDir: this.dataDir,
      seed: this.seed,
      staticDir,
      connectUrl: null,
      buildId,
      now: () => new Date(Date.now() + this.offset),
      reminderTickMs: 250,
      pin: this.pin,
      tickerFetch: fakeTickerFetch,
    });
    this.port = this.server.port;
  }

  async stop(): Promise<void> {
    await this.server?.stop();
    this.server = null;
  }

  /**
   * A new browser (its own cookies) showing `hash`. Every page talks to the server on
   * 127.0.0.1, so it counts as the wall computer; `headers` like X-Forwarded-For make
   * it look like another device instead.
   */
  async open(device: Device, hash: string, { headers }: { headers?: Record<string, string> } = {}): Promise<Page> {
    if (!this.browser) throw new Error('launch() first');
    const phone = device === 'phone';
    const context = await this.browser.newContext({ viewport: VIEWPORTS[device], isMobile: phone, hasTouch: phone, extraHTTPHeaders: headers });
    this.contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => this.pageErrors.push(`${device}: ${error.message}`));
    await page.goto(`http://127.0.0.1:${this.port}/${this.query}#${hash}`);
    return page;
  }

  async saved(): Promise<{ board: Board }> {
    await this.server?.store.flush();
    return JSON.parse(await readFile(join(this.dataDir, 'board.json'), 'utf8'));
  }
}
