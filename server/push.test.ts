import { createECDH, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Fetch } from './ai.ts';
import { PushService } from './push.ts';

// Notifications, against a stand-in push service: nothing is sent anywhere. The test
// plays the phone too, holding the keys its browser would, to read what arrives.

const ece = createRequire(import.meta.url)('http_ece') as { decrypt: (body: Buffer, params: object) => Buffer };
const now = new Date('2026-09-30T19:42:00');
const notice = { title: 'Reminder · 2 PM', body: 'Call the financial office', url: '#note-n1', tag: 'a1' };

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
}

let dir: string;
let sent: Sent[];
let status: number;
const standIn: Fetch = async (url, init) => {
  sent.push({ url, headers: init.headers as Record<string, string>, body: Buffer.from(init.body as Uint8Array) });
  return new Response(null, { status });
};

/** A phone's browser: its keys, and the subscription it would hand over. */
function phone(endpoint = 'https://web.push.apple.com/QGuQyavXutnMH') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, subscription: { endpoint, keys: { p256dh: ecdh.getPublicKey('base64url'), auth: auth.toString('base64url') } } };
}

const open = () => PushService.open(dir, { fetch: standIn, subject: () => 'https://nuc.tail1234.ts.net' });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sticky-push-'));
  sent = [];
  status = 201;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('notifications', () => {
  it('keeps its own key, readable only by this user, and the same one after a restart', async () => {
    const push = await open();
    expect(push.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    await push.flush();
    expect((await stat(join(dir, 'push.json'))).mode & 0o777).toBe(0o600);
    expect((await open()).publicKey).toBe(push.publicKey);
  });

  it('sends a reminder that only the phone can read, signed by the board', async () => {
    const push = await open();
    const iphone = phone();
    await push.add(iphone.subscription, 'iPhone', now);
    expect(await push.send(notice, now)).toEqual({ sent: 1, failed: 0 });

    const [request] = sent;
    expect(request!.url).toBe(iphone.subscription.endpoint);
    expect(request!.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '14400', Urgency: 'high' });
    expect(request!.headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${push.publicKey}$`));
    // The push service sees only ciphertext; the phone reads the notice.
    expect(request!.body.toString('utf8')).not.toContain('financial');
    const plain = ece.decrypt(request!.body, { version: 'aes128gcm', privateKey: iphone.ecdh, authSecret: iphone.auth });
    expect(JSON.parse(plain.toString('utf8'))).toEqual(notice);
    expect(push.devices()[0]).toMatchObject({ name: 'iPhone', lastSentAt: now.toISOString(), problem: null });
  });

  it('removes a device that turned notifications off, and notes other problems', async () => {
    const push = await open();
    await push.add(phone('https://web.push.apple.com/gone').subscription, 'Old iPad', now);
    await push.add(phone('https://fcm.googleapis.com/fcm/send/x').subscription, 'Laptop', now);
    status = 410;
    const gone = await push.send(notice, now, push.devices()[0]!.id);
    expect(gone).toEqual({ sent: 0, failed: 1 });
    expect(push.devices().map(device => device.name)).toEqual(['Laptop']);
    status = 403;
    await push.send(notice, now);
    expect(push.devices()[0]!.problem).toBe('its push service said no (403).');
    // Turned on again there: the problem goes.
    await push.add(phone('https://fcm.googleapis.com/fcm/send/x').subscription, 'Laptop', now);
    expect(push.devices()).toEqual([expect.objectContaining({ name: 'Laptop', problem: null })]);
  });

  it('keeps devices in a private file, and never more than 20', async () => {
    const push = await open();
    for (let i = 0; i < 20; i++) await push.add(phone(`https://push.test/${i}`).subscription, `Phone ${i}`, now);
    await expect(push.add(phone('https://push.test/21').subscription, 'One too many', now)).rejects.toThrow('At most 20 devices');
    await push.flush();
    expect(JSON.parse(await readFile(join(dir, 'push.json'), 'utf8')).devices).toHaveLength(20);
  });
});
