import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { format, set } from 'date-fns';
import { z } from 'zod';
import type { IMessageInfo } from '../shared/api.ts';
import type { Notice } from '../shared/notify.ts';
import type { IMessageInput } from '../shared/schema.ts';
import { parseTextCommand } from '../shared/textCommands.ts';
import type { Fetch } from './ai.ts';
import { PrivateFile } from './privateFile.ts';
import { newId, type BoardStore } from './store.ts';
import { runTextCommand, todayLines, type LastReminded } from './textCommands.ts';

// Reminders by iMessage, and texting the board back, through a Mac that stays on with
// BlueBubbles Server (free, bluebubbles.app) signed in to Messages. The board sends
// texts with BlueBubbles' REST API, and BlueBubbles tells the board about new messages
// by posting them to the board's link (which holds a secret). Only the numbers and
// Apple IDs listed in the Wall tab get texts, and only they can text the board.
// Settings, with BlueBubbles' password, are kept in <data>/imessage.json, readable only by you.

const SEND_TIMEOUT_MS = 15_000;
/** A missed morning summary is still sent this long after its time (the board was restarting, say). */
const MORNING_GRACE_MS = 2 * 60 * 60_000;
/** BlueBubbles may tell the board about a message more than once: these are remembered and skipped. */
const SEEN_MESSAGES = 200;

const lastRemindedSchema = z.object({ noteId: z.string(), kind: z.literal('follow').optional(), at: z.string() });

const fileSchema = z.object({
  version: z.literal(1),
  url: z.string().optional(),
  password: z.string().optional(),
  addresses: z.array(z.string()),
  reminders: z.boolean(),
  followUps: z.boolean(),
  morning: z.boolean(),
  morningTime: z.string(),
  /** In the link BlueBubbles posts new messages to. */
  secret: z.string(),
  /** The day the last morning summary went (yyyy-MM-dd). */
  lastMorning: z.string().optional(),
  /** Per address: the sticky the board last texted about, for "done" and "snooze". */
  lastReminded: z.record(z.string(), lastRemindedSchema),
  lastSent: z.object({ at: z.string(), ok: z.boolean(), message: z.string() }).nullable(),
  lastReceived: z.object({ at: z.string(), from: z.string(), text: z.string() }).nullable(),
});
type IMessageFile = z.infer<typeof fileSchema>;

const emptyFile = (): IMessageFile => ({
  version: 1,
  addresses: [],
  reminders: true,
  followUps: true,
  morning: false,
  morningTime: '08:00',
  secret: randomBytes(32).toString('base64url'),
  lastReminded: {},
  lastSent: null,
  lastReceived: null,
});

/** How a phone number or Apple ID is written for comparing: digits only for numbers, lower case for emails. */
export function addressKey(address: string): string {
  const trimmed = address.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  const digits = trimmed.replace(/\D/g, '');
  // +1 555 123 4567 and 555-123-4567 are the same phone (the last 10 digits).
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** The address as BlueBubbles wants it in a chat: a number without spaces or dashes, or the email. */
function chatAddress(address: string): string {
  const trimmed = address.trim();
  return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed.replace(/[\s().-]/g, '');
}

/** A new message, as BlueBubbles posts it to the board. */
const webhookSchema = z.object({
  type: z.string(),
  data: z
    .object({
      guid: z.string().optional(),
      text: z.string().nullable().optional(),
      isFromMe: z.boolean().optional(),
      handle: z.object({ address: z.string() }).nullable().optional(),
      chats: z.array(z.object({ guid: z.string() })).optional(),
    })
    .passthrough(),
});

export interface IMessageOptions {
  fetch?: Fetch;
  log?: (message: string) => void;
}

export interface SendResult {
  ok: boolean;
  message: string;
}

export class IMessage {
  private data: IMessageFile;
  private readonly file: PrivateFile<IMessageFile>;
  private readonly fetcher: Fetch;
  private readonly log: (message: string) => void;
  private readonly seen: string[] = [];
  private readonly listeners = new Set<() => void>();

  private constructor(file: PrivateFile<IMessageFile>, data: IMessageFile, options: IMessageOptions) {
    this.file = file;
    this.data = data;
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.log = options.log ?? (() => {});
  }

  static async open(dataDir: string, options: IMessageOptions = {}): Promise<IMessage> {
    const file = new PrivateFile<IMessageFile>(join(dataDir, 'imessage.json'));
    let fresh = false;
    const data = await file.read(
      fileSchema,
      () => {
        fresh = true;
        return emptyFile();
      },
      why => options.log?.(`imessage.json could not be read (${why}), so texts need setting up again.`),
    );
    const service = new IMessage(file, data, options);
    if (fresh) await file.write(data);
    return service;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Set up enough to send texts. */
  get ready(): boolean {
    return Boolean(this.data.url && this.data.password && this.data.addresses.length);
  }

  get secretPath(): string {
    return `/hooks/imessage/${this.data.secret}`;
  }

  matches(candidate: string): boolean {
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.data.secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** What browsers may see (no password). `bases` are the board's addresses, for BlueBubbles' link. */
  info(bases: { anywhere: string | null; home: string | null }): IMessageInfo {
    const link = (base: string | null) => (base ? `${base.replace(/\/$/, '')}${this.secretPath}` : null);
    const { data } = this;
    return {
      url: data.url ?? null,
      passwordSet: Boolean(data.password),
      addresses: data.addresses,
      reminders: data.reminders,
      followUps: data.followUps,
      morning: data.morning,
      morningTime: data.morningTime,
      webhook: { anywhere: link(bases.anywhere), home: link(bases.home), path: this.secretPath },
      lastSent: data.lastSent,
      lastReceived: data.lastReceived,
    };
  }

  /** Saves the settings. A password left out keeps the saved one. */
  async put(input: IMessageInput): Promise<void> {
    const password = input.password === undefined ? this.data.password : input.password.trim() || undefined;
    const keys = new Set<string>();
    const addresses = input.addresses.filter(address => {
      const key = addressKey(address);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
    const { url: _url, password: _password, ...rest } = this.data;
    await this.save({
      ...rest,
      ...(input.url ? { url: input.url } : {}),
      ...(password ? { password } : {}),
      addresses,
      reminders: input.reminders,
      followUps: input.followUps,
      morning: input.morning,
      morningTime: input.morningTime,
    });
  }

  /** Whether this phone number or Apple ID may text the board. */
  allowed(address: string): boolean {
    const key = addressKey(address);
    return key.length > 0 && this.data.addresses.some(entry => addressKey(entry) === key);
  }

  /** Sends one text, to a person (an address) or a chat BlueBubbles named. */
  private async sendTo(chatGuid: string, text: string): Promise<SendResult> {
    const { url, password } = this.data;
    if (!url || !password) return { ok: false, message: 'Texts aren’t set up yet.' };
    const endpoint = new URL('api/v1/message/text', url.endsWith('/') ? url : `${url}/`);
    endpoint.searchParams.set('password', password);
    try {
      const response = await this.fetcher(endpoint.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatGuid, tempGuid: `sticky-${newId()}`, message: text, method: 'apple-script' }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        redirect: 'error',
      });
      if (response.ok) return { ok: true, message: 'Sent.' };
      if (response.status === 401 || response.status === 403) return { ok: false, message: `BlueBubbles didn’t accept the password (${response.status}).` };
      return { ok: false, message: `BlueBubbles couldn’t send it (${response.status}).` };
    } catch {
      return { ok: false, message: 'Couldn’t reach BlueBubbles at that address. Is the Mac on?' };
    }
  }

  /** Texts everyone on the list. */
  async send(text: string, now: Date): Promise<SendResult> {
    if (!this.ready) return { ok: false, message: 'Texts aren’t set up yet: add BlueBubbles’ address, its password and a phone number.' };
    const results = await Promise.all(this.data.addresses.map(address => this.sendTo(`iMessage;-;${chatAddress(address)}`, text)));
    const failed = results.find(result => !result.ok);
    const outcome = failed ?? { ok: true, message: results.length === 1 ? 'Sent.' : `Sent to ${results.length} people.` };
    await this.save({ ...this.data, lastSent: { at: now.toISOString(), ok: outcome.ok, message: outcome.message } });
    if (failed) this.log(`Texts: ${failed.message}`);
    return outcome;
  }

  /** A reminder (or a nudge to follow up), by text, when those are switched on. */
  async reminder(noteId: string, kind: 'follow' | undefined, notice: Notice, now: Date): Promise<void> {
    if (!this.ready || !(kind === 'follow' ? this.data.followUps : this.data.reminders)) return;
    const result = await this.send(`${notice.title}: ${notice.body}\nText done, or snooze 1h.`, now);
    if (!result.ok) return;
    const lastReminded = { ...this.data.lastReminded };
    for (const address of this.data.addresses) lastReminded[addressKey(address)] = { noteId, ...(kind ? { kind } : {}), at: now.toISOString() };
    await this.save({ ...this.data, lastReminded });
  }

  /** The morning summary, once a day at its time (when it's switched on). */
  async morningIfDue(store: BoardStore): Promise<void> {
    if (!this.ready || !this.data.morning) return;
    const now = store.now();
    const today = format(now, 'yyyy-MM-dd');
    if (this.data.lastMorning === today) return;
    const [hours = 8, minutes = 0] = this.data.morningTime.split(':').map(Number);
    const at = set(now, { hours, minutes, seconds: 0, milliseconds: 0 });
    if (now < at || now.getTime() - at.getTime() > MORNING_GRACE_MS) return;
    await this.save({ ...this.data, lastMorning: today });
    const lines = todayLines(store.board, now);
    await this.send(lines.length ? `Good morning. Today:\n${lines.join('\n')}` : 'Good morning. Nothing is due today.', now);
  }

  /**
   * A new message from BlueBubbles. Messages from someone on the list are carried out
   * and answered; anything else (your own messages, group chats, other people) is ignored.
   * Returns the reply sent, or null.
   */
  async received(payload: unknown, store: BoardStore): Promise<string | null> {
    const parsed = webhookSchema.safeParse(payload);
    if (!parsed.success || parsed.data.type !== 'new-message') return null;
    const message = parsed.data.data;
    const from = message.handle?.address;
    const text = message.text?.trim();
    if (message.isFromMe || !from || !text) return null;
    const chat = message.chats?.[0]?.guid ?? `iMessage;-;${chatAddress(from)}`;
    // Only one-to-one chats (a group chat's id has a + in the middle).
    if (!/;-;/.test(chat)) return null;
    if (!this.allowed(from)) {
      this.log('Texts: ignored a message from someone not on the list.');
      return null;
    }
    if (message.guid) {
      if (this.seen.includes(message.guid)) return null;
      this.seen.push(message.guid);
      if (this.seen.length > SEEN_MESSAGES) this.seen.shift();
    }
    const now = store.now();
    const key = addressKey(from);
    const command = parseTextCommand(text, now);
    const reply = runTextCommand(command, store, this.data.lastReminded[key] satisfies LastReminded | undefined);
    await this.save({ ...this.data, lastReceived: { at: now.toISOString(), from, text: text.slice(0, 200) } });
    const sent = await this.sendTo(chat, reply);
    await this.save({ ...this.data, lastSent: { at: store.now().toISOString(), ok: sent.ok, message: sent.message } });
    return reply;
  }

  flush(): Promise<void> {
    return this.file.flush();
  }

  private async save(next: IMessageFile): Promise<void> {
    this.data = next;
    await this.file.write(next);
    for (const listener of this.listeners) listener();
  }
}

/** Settings that were sent can't be saved: says why. */
export function imessageProblem(input: IMessageInput, passwordSaved: boolean): string | null {
  if (!input.url && (input.password || input.addresses.length)) return 'Paste BlueBubbles Server’s address too.';
  if (input.url && !input.password && !passwordSaved) return 'Paste BlueBubbles Server’s password too.';
  return null;
}
