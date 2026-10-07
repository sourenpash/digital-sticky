import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { normalizePairCode, PAIR_ALPHABET, PAIR_CODE_LENGTH } from '../shared/pairing.ts';

// Signing in. A phone or computer signs in once, with the PIN or by scanning the code on
// the wall, and gets a signed cookie that lasts a year (renewed while it's used). On the
// home Wi-Fi a board without a PIN is open; from the internet everyone signs in. The wall
// computer itself, opening the board at localhost, is let in without signing in: it has
// no keyboard. So are the devices set up as wall screens.

export const SESSION_COOKIE = 'sticky_wall_session';
export const SCREEN_COOKIE = 'sticky_wall_screen';
const YEAR_S = 365 * 24 * 60 * 60;
const RENEW_AFTER_S = 30 * 24 * 60 * 60;
const CLOCK_SLACK_S = 5 * 60;
const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORWARDING_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-host'];

/** The connection's address, or undefined when there is none (requests made in tests). */
export function remoteAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

/**
 * A request from the internet: it came in through the board's own port for that (where
 * Tailscale Funnel delivers), whatever it claims about itself.
 */
export function isOutside(c: Context): boolean {
  return (c.env as { outside?: unknown } | undefined)?.outside === true;
}

/** A request from this computer: a local connection, to a local name, not passed on by a proxy. */
export function fromThisComputer(c: Context): boolean {
  if (isOutside(c)) return false;
  const address = remoteAddress(c);
  if (!address || !LOOPBACK.test(address)) return false;
  if (!LOCAL_NAMES.has(new URL(c.req.url).hostname)) return false;
  return FORWARDING_HEADERS.every(name => c.req.header(name) === undefined);
}

/** The random secret that signs cookies, kept in the data folder (created on first use). */
export async function loadSecret(dataDir: string): Promise<Buffer> {
  const path = join(dataDir, 'session-secret');
  try {
    const hex = (await readFile(path, 'utf8')).trim();
    if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const secret = randomBytes(32);
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${secret.toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
  return secret;
}

/**
 * 5 wrong PINs per device, and 30 overall, per 15 minutes. Each try counts as wrong
 * until it turns out right, so a burst of guesses sent at once can't slip past.
 */
export class LoginLimiter {
  private readonly fails = new Map<string, number[]>();
  private all: number[] = [];
  private readonly perClient: number;
  private readonly overall: number;
  private readonly windowMs: number;

  constructor(perClient = 5, overall = 30, windowMs = 15 * 60_000) {
    this.perClient = perClient;
    this.overall = overall;
    this.windowMs = windowMs;
  }

  /** Seconds to wait before `client` may try again (0 = now). */
  waitFor(client: string, now: number): number {
    const since = now - this.windowMs;
    this.all = this.all.filter(t => t > since);
    const mine = (this.fails.get(client) ?? []).filter(t => t > since);
    if (mine.length) this.fails.set(client, mine);
    else this.fails.delete(client);
    const wait = (times: number[], limit: number) => (times.length >= limit ? times[times.length - limit]! + this.windowMs - now : 0);
    return Math.ceil(Math.max(wait(mine, this.perClient), wait(this.all, this.overall)) / 1000);
  }

  /** Counts a try (as wrong until `succeeded`). */
  tried(client: string, now: number): void {
    this.fails.set(client, [...(this.fails.get(client) ?? []), now]);
    this.all.push(now);
    if (this.fails.size > 1000) {
      const since = now - this.windowMs;
      for (const [key, times] of this.fails) if (times.every(t => t <= since)) this.fails.delete(key);
    }
  }

  /** The try at `now` was right: it doesn't count, and neither do this device's earlier ones. */
  succeeded(client: string, now: number): void {
    this.fails.delete(client);
    const index = this.all.lastIndexOf(now);
    if (index >= 0) this.all.splice(index, 1);
  }
}

/**
 * Codes the wall shows (in its QR code, and as text to type) to sign a device in. Each
 * works once, for 10 minutes. 8 characters of base 32 is 40 bits: with at most 20 codes
 * alive and tries limited, guessing one would take millions of years.
 */
export class PairingCodes {
  /** How long a code works. */
  static readonly LIFE_MS = 10 * 60_000;
  /** The wall shows a fresh code this often. */
  static readonly REFRESH_MS = 2 * 60_000;
  private static readonly MAX = 20;
  private codes = new Map<string, number>(); // code → issued at
  private shown: string | null = null;

  /** The code for the wall to show now: a fresh one every couple of minutes, or once it's used. */
  current(now: number): { code: string; expiresAt: number } {
    const issued = this.shown ? this.codes.get(this.shown) : undefined;
    if (!this.shown || issued === undefined || now - issued >= PairingCodes.REFRESH_MS) this.shown = this.issue(now).code;
    const at = this.codes.get(this.shown)!;
    return { code: this.shown, expiresAt: at + PairingCodes.LIFE_MS };
  }

  /** A new code (for "Connect another device"). */
  issue(now: number): { code: string; expiresAt: number } {
    this.prune(now);
    let code = '';
    for (let i = 0; i < PAIR_CODE_LENGTH; i++) code += PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)];
    this.codes.set(code, now);
    while (this.codes.size > PairingCodes.MAX) this.codes.delete(this.codes.keys().next().value!);
    return { code, expiresAt: now + PairingCodes.LIFE_MS };
  }

  /** Uses up a code (as typed or scanned): true if it was real and still fresh. */
  redeem(typed: string, now: number): boolean {
    this.prune(now);
    const code = normalizePairCode(typed);
    if (!this.codes.has(code)) return false;
    this.codes.delete(code);
    if (this.shown === code) this.shown = null;
    return true;
  }

  private prune(now: number): void {
    for (const [code, at] of this.codes) if (now - at >= PairingCodes.LIFE_MS) this.codes.delete(code);
  }
}

export interface AuthOptions {
  /** 6–12 digits, or null for a board without a PIN. */
  pin: string | null;
  secret: Buffer;
  /** Let the wall computer (localhost) in without signing in. */
  trustLocalhost: boolean;
  /** Requests from the internet arrive over https (false only for a plain-http relay). */
  outsideHttps?: boolean;
  now?: () => Date;
}

export interface Session {
  signedIn: boolean;
  /** Old enough to hand out a fresh cookie. */
  renew: boolean;
}

export class Auth {
  readonly limiter = new LoginLimiter();
  /** From the internet, wrong PINs are limited harder: 5 per device and 20 overall an hour. */
  readonly outsideLimiter = new LoginLimiter(5, 20, 60 * 60_000);
  /** Codes are much harder to guess than a PIN: 10 wrong ones per device, and 200 overall, an hour. */
  readonly codeLimiter = new LoginLimiter(10, 200, 60 * 60_000);
  readonly codes = new PairingCodes();
  private readonly cookieKey: string;
  private readonly screenKey: string;
  private readonly pinDigest: Buffer | null;
  private readonly secret: Buffer;
  private readonly trustLocalhost: boolean;
  private readonly outsideHttps: boolean;
  private readonly now: () => Date;

  constructor({ pin, secret, trustLocalhost, outsideHttps = true, now }: AuthOptions) {
    this.secret = secret;
    this.trustLocalhost = trustLocalhost;
    this.outsideHttps = outsideHttps;
    this.now = now ?? (() => new Date());
    // Cookies are signed with a key that includes the PIN, so changing the PIN signs everyone out.
    this.cookieKey = createHmac('sha256', secret).update(`cookie:${pin ?? ''}`).digest('hex');
    // Wall screens are set up on purpose and stay set up until removed, PIN or not.
    this.screenKey = createHmac('sha256', secret).update('screen').digest('hex');
    this.pinDigest = pin ? this.digest(pin) : null;
  }

  get pinSet(): boolean {
    return this.pinDigest !== null;
  }

  private digest(pin: string): Buffer {
    return createHmac('sha256', this.secret).update(`pin:${pin}`).digest();
  }

  checkPin(pin: string): boolean {
    return this.pinDigest !== null && timingSafeEqual(this.digest(pin), this.pinDigest);
  }

  /** Whether this request has to come from a signed-in device: always from the internet, and everywhere with a PIN. */
  needsSignIn(c: Context): boolean {
    return this.pinSet || isOutside(c);
  }

  /** The wrong-PIN limiter for this request. */
  limiterFor(c: Context): LoginLimiter {
    return isOutside(c) ? this.outsideLimiter : this.limiter;
  }

  /** The wall computer's own browser, when it's let in without the PIN. */
  isWallComputer(c: Context): boolean {
    return this.trustLocalhost && fromThisComputer(c);
  }

  /** The wall screen this device was set up as (its id), if any. */
  async screenId(c: Context): Promise<string | null> {
    const value = await getSignedCookie(c, this.screenKey, SCREEN_COOKIE);
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
  }

  async setScreen(c: Context, id: string): Promise<void> {
    await setSignedCookie(c, SCREEN_COOKIE, id, this.screenKey, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: YEAR_S, secure: this.isHttps(c) });
  }

  clearScreen(c: Context): void {
    deleteCookie(c, SCREEN_COOKIE, { path: '/', secure: this.isHttps(c) });
  }

  /** Who is asking, for counting wrong PINs: the device, even behind a proxy on this computer. */
  clientKey(c: Context): string {
    const address = remoteAddress(c) ?? 'unknown';
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded && LOOPBACK.test(address)) return forwarded.split(',').at(-1)?.trim() || address;
    return address;
  }

  async session(c: Context): Promise<Session> {
    const value = await getSignedCookie(c, this.cookieKey, SESSION_COOKIE);
    if (typeof value !== 'string' || !/^\d{1,12}$/.test(value)) return { signedIn: false, renew: false };
    const age = Math.floor(this.now().getTime() / 1000) - Number(value);
    if (age < -CLOCK_SLACK_S || age > YEAR_S) return { signedIn: false, renew: false };
    return { signedIn: true, renew: age > RENEW_AFTER_S };
  }

  async signIn(c: Context): Promise<void> {
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    await setSignedCookie(c, SESSION_COOKIE, String(issuedAt), this.cookieKey, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: YEAR_S,
      // Browsers drop Secure cookies on plain http, which would ask for the PIN forever.
      secure: this.isHttps(c),
    });
  }

  signOut(c: Context): void {
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: this.isHttps(c) });
  }

  private isHttps(c: Context): boolean {
    if (isOutside(c)) return this.outsideHttps;
    if (new URL(c.req.url).protocol === 'https:') return true;
    // Only a proxy on this computer (like `tailscale serve`) is believed about https.
    const address = remoteAddress(c);
    return c.req.header('x-forwarded-proto') === 'https' && address !== undefined && LOOPBACK.test(address);
  }
}
