import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { Board } from '../shared/types.ts';
import { startServer, type RunningServer } from '../server/server.ts';
import { KioskProbe } from './kioskProbe.ts';
import { fakeTickerFetch } from './tickerFixtures.ts';

// A real board server in a temp folder, and Chromium pages playing the phone, a
// computer and the wall. Chromium comes from Playwright's browser folder; set
// PW_CHROMIUM to use another one. With `kiosk`, the wall computer's own browser runs
// too, started by the real kiosk script (scripts/linux/kiosk.sh, with Chromium
// headless), and tests look into it through its debugging port like the server does.
// The AIs the board wakes up are never reached: a stand-in records each wake-up and
// answers like a Claude routine.

const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const staticDir = resolve('dist/web');

export type Device = 'phone' | 'computer' | 'wall';

/** A wake-up the board sent to an AI (to the stand-in). */
export interface WakeUp {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

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
  /** Every wake-up sent to an AI, newest last. */
  wakeUps: WakeUp[] = [];
  private browser: Browser | null = null;
  private contexts: BrowserContext[] = [];
  private readonly seed: (now: Date) => Board;
  /** Added to page addresses, e.g. `?now=…` for sample-board dates. */
  private readonly query: string;
  /** Where the server's clock starts (it then runs normally), to match `?now=` pages. */
  private readonly startAt: string | undefined;
  private readonly pin: string | undefined;
  private readonly withKiosk: boolean;
  /** The address the wall's "Connect your phone" code shows. */
  private readonly connectUrl: string | null;
  /** Open the board's door for the internet too (as Tailscale Funnel would reach it). */
  private readonly withOutside: boolean;
  /** The internet door's port, and the address pages use to come in through it. */
  publicPort: number | null = null;
  outsideUrl = '';
  private kioskProcess: ChildProcess | null = null;
  private kioskHome = '';
  /** The kiosk browser's debugging port. */
  kioskPort: number | null = null;
  /** A look into the kiosk browser (with `kiosk`). */
  kiosk: KioskProbe | null = null;
  private offset = 0;

  constructor(
    seed: (now: Date) => Board,
    {
      query = '',
      now,
      pin,
      kiosk = false,
      connectUrl = null,
      outside = false,
    }: { query?: string; now?: string; pin?: string; kiosk?: boolean; connectUrl?: string | null; outside?: boolean } = {},
  ) {
    this.seed = seed;
    this.query = query;
    this.startAt = now;
    this.pin = pin;
    this.withKiosk = kiosk;
    this.connectUrl = connectUrl;
    this.withOutside = outside;
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
    this.wakeUps = [];
    this.offset = this.startAt ? Date.parse(this.startAt) - Date.now() : 0;
    if (this.withKiosk) this.kioskPort = await freePort();
    if (this.withOutside) {
      this.publicPort = await freePort();
      this.outsideUrl = `http://127.0.0.1:${this.publicPort}`;
    }
    await this.start();
    if (this.withKiosk) await this.startKiosk();
  }

  async tearDown(): Promise<void> {
    await Promise.all(this.contexts.map(context => context.close()));
    this.contexts = [];
    await this.stopKiosk();
    await this.stop();
    await rm(this.dataDir, { recursive: true, force: true });
  }

  private kioskEnv(): NodeJS.ProcessEnv {
    return { HOME: this.kioskHome, PATH: `${join(this.kioskHome, 'bin')}:/usr/bin:/bin`, PORT: String(this.port), KIOSK_DEBUG_PORT: String(this.kioskPort) };
  }

  /** The kiosk script, with Chromium (headless, full HD) standing in for the wall computer's browser. */
  private async startKiosk(): Promise<void> {
    this.kioskHome = await mkdtemp(join(tmpdir(), 'sticky-kiosk-'));
    await mkdir(join(this.kioskHome, 'bin'));
    await writeFile(join(this.kioskHome, 'bin', 'chromium'), `#!/bin/sh\nexec ${CHROMIUM} --headless=new --no-sandbox --screen-info={1920x1080} --window-size=1920,1080 "$@"\n`, { mode: 0o755 });
    this.kioskProcess = spawn('bash', [resolve('scripts/linux/kiosk.sh')], { env: this.kioskEnv(), stdio: 'ignore', detached: true });
    const kiosk = new KioskProbe(this.kioskPort!);
    this.kiosk = kiosk;
    for (let tries = 0; tries < 150; tries++) {
      try {
        if (await kiosk.evaluate<boolean>('!!document.querySelector(".wall")', url => url.endsWith('#wall'))) return;
      } catch {
        // Not up yet.
      }
      await new Promise(done => setTimeout(done, 200));
    }
    throw new Error('The kiosk script did not bring up the wall screen');
  }

  private async stopKiosk(): Promise<void> {
    if (!this.kioskProcess) return;
    await new Promise(done => spawn('bash', [resolve('scripts/linux/kiosk.sh'), '--stop'], { env: this.kioskEnv(), stdio: 'ignore' }).on('exit', done));
    try {
      process.kill(-this.kioskProcess.pid!, 'SIGKILL'); // anything left of its process group
    } catch {
      // Already gone.
    }
    this.kioskProcess = null;
    this.kiosk = null;
    await rm(this.kioskHome, { recursive: true, force: true });
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
      // From anywhere, the wall's code leads to the internet address.
      connectUrl: this.withOutside ? this.outsideUrl : this.connectUrl,
      buildId,
      now: () => new Date(Date.now() + this.offset),
      reminderTickMs: 250,
      pin: this.pin,
      tickerFetch: fakeTickerFetch,
      aiFetch: async (url, init) => {
        this.wakeUps.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return new Response(JSON.stringify({ type: 'routine_fire', claude_code_session_id: 'session_test', claude_code_session_url: 'https://claude.ai/code/session_test' }));
      },
      remoteDebugPort: this.kioskPort,
      // Pages reach the internet door over plain http here, so its cookies can't be Secure.
      ...(this.withOutside ? { publicPort: this.publicPort, anywhereUrl: this.outsideUrl, outsideHttps: false } : {}),
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
   * it look like another device instead. `outside` comes in through the internet door.
   */
  async open(device: Device, hash: string, { headers, outside = false }: { headers?: Record<string, string>; outside?: boolean } = {}): Promise<Page> {
    if (!this.browser) throw new Error('launch() first');
    const phone = device === 'phone';
    const context = await this.browser.newContext({ viewport: VIEWPORTS[device], isMobile: phone, hasTouch: phone, extraHTTPHeaders: headers });
    this.contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => this.pageErrors.push(`${device}: ${error.message}`));
    const base = outside ? this.outsideUrl : `http://127.0.0.1:${this.port}`;
    await page.goto(`${base}/${this.query}#${hash}`);
    return page;
  }

  async saved(): Promise<{ board: Board }> {
    await this.server?.store.flush();
    return JSON.parse(await readFile(join(this.dataDir, 'board.json'), 'utf8'));
  }
}

/** A port nothing is listening on right now. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  await new Promise(done => server.close(done));
  return port;
}
