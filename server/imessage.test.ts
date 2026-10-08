import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { reminderNotice } from '../shared/notify.ts';
import type { Board, Note } from '../shared/types.ts';
import type { Fetch } from './ai.ts';
import { addressKey, IMessage } from './imessage.ts';
import { Notifier } from './notify.ts';
import { PushService } from './push.ts';
import { BoardStore } from './store.ts';

// Texts through iMessage, against a stand-in BlueBubbles Server: no texts are sent.

const ME = '+1 555 010 4477';
const MAC = 'http://mac-mini.local:1234';

function note(fields: Partial<Note>): Note {
  return {
    id: 'n1',
    laneId: 'remind',
    title: 'Call the financial office',
    body: '',
    checklist: [],
    links: [],
    pinned: false,
    done: false,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...fields,
  };
}

interface Text {
  url: string;
  body: { chatGuid: string; message: string; method: string; tempGuid: string };
}

let dir: string;
let clock: Date;
let store: BoardStore;
let texts: IMessage;
let sent: Text[];
let status: number;
const standIn: Fetch = async (url, init) => {
  sent.push({ url, body: JSON.parse(String(init.body)) as Text['body'] });
  return new Response(JSON.stringify({ status: 200, message: 'Message sent!' }), { status });
};

async function setUp(notes: Note[] = [], settings: Partial<Board['settings']> = {}) {
  const board = { ...makeEmptyBoard(), notes };
  board.settings = { ...board.settings, ...settings };
  store = await BoardStore.open({ dir, seed: () => board, now: () => clock });
  texts = await IMessage.open(dir, { fetch: standIn });
  await texts.put({ url: MAC, password: 'hunter2', addresses: [ME], reminders: true, followUps: true, morning: false, morningTime: '08:00' });
}

/** A new message, as BlueBubbles posts it. */
const message = (text: string, from = '+15550104477', extra: object = {}) => ({
  type: 'new-message',
  data: { guid: `msg-${Math.random()}`, text, isFromMe: false, handle: { address: from }, chats: [{ guid: `iMessage;-;${from}` }], ...extra },
});
const sticky = (id = 'n1') => store.board.notes.find(n => n.id === id);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sticky-texts-'));
  clock = new Date('2026-09-30T14:00:00');
  sent = [];
  status = 200;
});

afterEach(async () => {
  await store?.close();
  await texts?.flush();
  await rm(dir, { recursive: true, force: true });
});

describe('texts through iMessage', () => {
  it('keeps the password in a private file and never shows it', async () => {
    await setUp();
    await texts.flush();
    expect((await stat(join(dir, 'imessage.json'))).mode & 0o777).toBe(0o600);
    const info = texts.info({ anywhere: 'https://nuc.tail1234.ts.net', home: null });
    expect(JSON.stringify(info)).not.toContain('hunter2');
    expect(info).toMatchObject({ url: MAC, passwordSet: true, addresses: [ME] });
    expect(info.webhook.anywhere).toMatch(/^https:\/\/nuc\.tail1234\.ts\.net\/hooks\/imessage\/[\w-]{43}$/);
    // Saved again without a password: the old one stays.
    await texts.put({ url: MAC, addresses: [ME, '(555) 010-4477', 'Me@iCloud.com'], reminders: true, followUps: false, morning: false, morningTime: '08:00' });
    expect(JSON.parse(await readFile(join(dir, 'imessage.json'), 'utf8'))).toMatchObject({ password: 'hunter2', addresses: [ME, 'Me@iCloud.com'] });
  });

  it('texts a reminder through BlueBubbles, and done finishes that sticky', async () => {
    await setUp([note({ remindAt: '2026-09-30T18:00:00.000Z' })]);
    await texts.reminder('n1', undefined, reminderNotice(sticky()!, undefined, 'a1', clock), clock);
    expect(sent).toEqual([
      {
        url: `${MAC}/api/v1/message/text?password=hunter2`,
        body: { chatGuid: 'iMessage;-;+15550104477', tempGuid: expect.stringMatching(/^sticky-/), message: 'Reminder · 2 PM: Call the financial office\nText done, or snooze 1h.', method: 'apple-script' },
      },
    ]);

    expect(await texts.received(message('Done'), store)).toBe('Done: “Call the financial office”. (To undo it, untick it in the app.)');
    expect(sticky()?.done).toBe(true);
    // The reply goes back to the same chat.
    expect(sent[1]!.body).toMatchObject({ chatGuid: 'iMessage;-;+15550104477', message: 'Done: “Call the financial office”. (To undo it, untick it in the app.)' });
  });

  it('snoozes the reminder, or a follow-up nudge', async () => {
    await setUp([note({ remindAt: '2026-09-30T18:00:00.000Z' }), note({ id: 'n2', title: 'NIH R01', followUp: { at: '2026-09-30T13:00:00.000Z', everyDays: 14 } })]);
    store.apply({ type: 'alert.fire', id: 'a1', noteId: 'n1' });
    await texts.reminder('n1', undefined, reminderNotice(sticky()!, undefined, 'a1', clock), clock);
    expect(await texts.received(message('snooze 2h'), store)).toBe('Snoozed “Call the financial office” until 4 PM.');
    expect(sticky()?.remindAt).toBe(new Date('2026-09-30T16:00:00').toISOString());
    // It comes back later, so it's taken down from the wall now.
    expect(store.board.alerts).toEqual([]);

    await texts.reminder('n2', 'follow', reminderNotice(sticky('n2')!, 'follow', 'a2', clock), clock);
    expect(await texts.received(message('snooze tomorrow'), store)).toBe('Snoozed “NIH R01” until tomorrow 9 AM.');
    expect(sticky('n2')?.followUp).toEqual({ at: new Date('2026-10-01T09:00:00').toISOString(), everyDays: 14 });
  });

  it('adds a to-do, says what’s due today, and helps', async () => {
    await setUp([note({ id: 'n2', laneId: 'apps', title: 'NSF CAREER', due: '2026-09-30' }), note({ id: 'n3', title: 'Old one', due: '2026-09-20' })]);
    expect(await texts.received(message('add call NSF friday'), store)).toBe('Added “Call NSF” to To-do, due Fri Oct 2.');
    expect(store.board.notes.find(n => n.title === 'Call NSF')).toMatchObject({ laneId: 'todo', due: '2026-10-02', done: false });
    expect(await texts.received(message('today'), store)).toBe('Today:\n• Old one (overdue)\n• NSF CAREER (due today)');
    expect(await texts.received(message('help'), store)).toContain('snooze 1h');
    expect(await texts.received(message('what is love'), store)).toMatch(/^I didn’t get that\. You can text:/);
    expect(await texts.received(message('done Old one'), store)).toBe('Done: “Old one”. (To undo it, untick it in the app.)');
  });

  it('listens only to people on the list, in one-to-one chats, once per message', async () => {
    await setUp([note({})]);
    await texts.reminder('n1', undefined, reminderNotice(sticky()!, undefined, 'a1', clock), clock);
    sent = [];
    expect(await texts.received(message('done', '+15559998888'), store)).toBeNull();
    expect(await texts.received(message('done', '+15550104477', { isFromMe: true }), store)).toBeNull();
    expect(await texts.received(message('done', '+15550104477', { chats: [{ guid: 'iMessage;+;chat123456' }] }), store)).toBeNull();
    expect(await texts.received({ type: 'updated-message', data: {} }, store)).toBeNull();
    expect(sent).toEqual([]);
    expect(sticky()?.done).toBe(false);
    // The same message twice is carried out once.
    const once = message('done');
    expect(await texts.received(once, store)).not.toBeNull();
    expect(await texts.received(once, store)).toBeNull();
  });

  it('sends the morning summary once, at its time', async () => {
    await setUp([note({ due: '2026-10-01' })]);
    await texts.put({ url: MAC, addresses: [ME], reminders: true, followUps: true, morning: true, morningTime: '08:00' });
    clock = new Date('2026-10-01T07:59:00');
    await texts.morningIfDue(store);
    expect(sent).toEqual([]);
    clock = new Date('2026-10-01T08:00:30');
    await texts.morningIfDue(store);
    await texts.morningIfDue(store);
    expect(sent.map(text => text.body.message)).toEqual(['Good morning. Today:\n• Call the financial office (due today)']);
    // Long after its time (the board was off), it waits for tomorrow.
    clock = new Date('2026-10-02T11:00:00');
    await texts.morningIfDue(store);
    expect(sent).toHaveLength(1);
  });

  it('says when BlueBubbles can’t be reached or refuses', async () => {
    await setUp([note({})]);
    status = 401;
    expect(await texts.send('hi', clock)).toEqual({ ok: false, message: 'BlueBubbles didn’t accept the password (401).' });
    expect(texts.info({ anywhere: null, home: null }).lastSent).toMatchObject({ ok: false });
  });

  it('compares phone numbers however they’re written', () => {
    expect(addressKey('+1 (555) 010-4477')).toBe(addressKey('5550104477'));
    expect(addressKey('Me@iCloud.com')).toBe('me@icloud.com');
  });
});

describe('reminders on phones', () => {
  it('sends to phones and texts when a reminder goes off, but not at night', async () => {
    await setUp([note({ remindAt: '2026-09-30T18:00:00.000Z' })]);
    const pushed: string[] = [];
    const push = await PushService.open(dir, {
      fetch: async url => {
        pushed.push(url);
        return new Response(null, { status: 201 });
      },
      subject: () => 'mailto:test@example.com',
    });
    const { createECDH } = await import('node:crypto');
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    await push.add({ endpoint: 'https://push.test/phone', keys: { p256dh: ecdh.getPublicKey('base64url'), auth: 'c2VjcmV0c2VjcmV0MTIzNA' } }, 'iPhone', clock);
    const notifier = new Notifier({ store, push, imessage: texts });
    const fire = [{ noteId: 'n1', remindAt: '2026-09-30T18:00:00.000Z', alertId: 'a1', show: true }];

    await notifier.reminders(fire);
    expect(pushed).toEqual(['https://push.test/phone']);
    expect(sent.map(text => text.body.message)).toEqual(['Reminder · 2 PM: Call the financial office\nText done, or snooze 1h.']);

    // Night mode: quiet (the wall still shows it).
    store.apply({ type: 'settings.patch', patch: { night: { mode: 'on' } } });
    await notifier.reminders(fire);
    expect(pushed).toHaveLength(1);
    expect(sent).toHaveLength(1);
    store.apply({ type: 'settings.patch', patch: { notify: { quietAtNight: false } } });
    await notifier.reminders(fire);
    expect(pushed).toHaveLength(2);
    await push.flush();
  });
});
