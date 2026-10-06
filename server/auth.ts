import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';

// The optional PIN. A phone or computer enters it once and gets a signed cookie that
// lasts a year (renewed while it's used). The wall computer itself, opening the board at
// localhost, is let in without it: it has no keyboard.

export const SESSION_COOKIE = 'sticky_wall_session';
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

/** A request from this computer: a local connection, to a local name, not passed on by a proxy. */
export function fromThisComputer(c: Context): boolean {
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

export interface AuthOptions {
  pin: string;
  secret: Buffer;
  /** Let the wall computer (localhost) in without the PIN. */
  trustLocalhost: boolean;
  now?: () => Date;
}

export interface Session {
  signedIn: boolean;
  /** Old enough to hand out a fresh cookie. */
  renew: boolean;
}

export class Auth {
  readonly limiter = new LoginLimiter();
  private readonly cookieKey: string;
  private readonly pinDigest: Buffer;
  private readonly secret: Buffer;
  private readonly trustLocalhost: boolean;
  private readonly now: () => Date;

  constructor({ pin, secret, trustLocalhost, now }: AuthOptions) {
    this.secret = secret;
    this.trustLocalhost = trustLocalhost;
    this.now = now ?? (() => new Date());
    // Cookies are signed with a key that includes the PIN, so changing the PIN signs everyone out.
    this.cookieKey = createHmac('sha256', secret).update(`cookie:${pin}`).digest('hex');
    this.pinDigest = this.digest(pin);
  }

  private digest(pin: string): Buffer {
    return createHmac('sha256', this.secret).update(`pin:${pin}`).digest();
  }

  checkPin(pin: string): boolean {
    return timingSafeEqual(this.digest(pin), this.pinDigest);
  }

  /** The wall computer's own browser, when it's let in without the PIN. */
  isWallComputer(c: Context): boolean {
    return this.trustLocalhost && fromThisComputer(c);
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
    if (new URL(c.req.url).protocol === 'https:') return true;
    // Only a proxy on this computer (like `tailscale serve`) is believed about https.
    const address = remoteAddress(c);
    return c.req.header('x-forwarded-proto') === 'https' && address !== undefined && LOOPBACK.test(address);
  }
}
