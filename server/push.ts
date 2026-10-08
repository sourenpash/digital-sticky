import { join } from 'node:path';
import webpush from 'web-push';
import { z } from 'zod';
import type { PushDeviceInfo } from '../shared/api.ts';
import type { Notice } from '../shared/notify.ts';
import type { Fetch } from './ai.ts';
import { PrivateFile } from './privateFile.ts';
import { newId, StoreError } from './store.ts';

// Notifications on phones and computers (Web Push): an iPhone gets them from the board
// added to its Home Screen, opened at the board's https address. The board signs each
// one with its own key (made on first use, in <data>/push.json, readable only by you)
// and encrypts it for the device, then hands it to the device's push service (Apple's,
// Google's, Mozilla's), which can't read it.

export const MAX_PUSH_DEVICES = 20;
/** How long a push service keeps trying to deliver a notification (a reminder an hour late is still worth seeing). */
const TTL_S = 4 * 60 * 60;
const SEND_TIMEOUT_MS = 15_000;

const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  endpoint: z.string(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  addedAt: z.string(),
  lastSentAt: z.string().optional(),
  problem: z.string().optional(),
});
type Device = z.infer<typeof deviceSchema>;

const fileSchema = z.object({ version: z.literal(1), publicKey: z.string(), privateKey: z.string(), devices: z.array(deviceSchema) });
type PushFile = z.infer<typeof fileSchema>;

/** What a browser sends to turn notifications on (PushSubscription.toJSON()). */
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .max(2048)
    .refine(value => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Push addresses are https:// addresses'),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export interface PushOptions {
  fetch?: Fetch;
  /** Who's sending, for the push services: the board's https address, or a mailto: address. */
  subject: () => string;
  log?: (message: string) => void;
}

export interface PushResult {
  sent: number;
  failed: number;
}

export class PushService {
  private data: PushFile;
  private readonly file: PrivateFile<PushFile>;
  private readonly fetcher: Fetch;
  private readonly subject: () => string;
  private readonly log: (message: string) => void;
  private readonly listeners = new Set<() => void>();

  private constructor(file: PrivateFile<PushFile>, data: PushFile, options: PushOptions) {
    this.file = file;
    this.data = data;
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.subject = options.subject;
    this.log = options.log ?? (() => {});
  }

  static async open(dataDir: string, options: PushOptions): Promise<PushService> {
    const file = new PrivateFile<PushFile>(join(dataDir, 'push.json'));
    let fresh = false;
    const data = await file.read(
      fileSchema,
      () => {
        fresh = true;
        const keys = webpush.generateVAPIDKeys();
        return { version: 1, publicKey: keys.publicKey, privateKey: keys.privateKey, devices: [] };
      },
      why => options.log?.(`push.json could not be read (${why}), so notifications start over: turn them on again on each device.`),
    );
    const service = new PushService(file, data, options);
    if (fresh) await file.write(data);
    return service;
  }

  /** Called when the devices change. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The key browsers subscribe with (public). */
  get publicKey(): string {
    return this.data.publicKey;
  }

  devices(): PushDeviceInfo[] {
    return this.data.devices.map(device => ({
      id: device.id,
      name: device.name,
      addedAt: device.addedAt,
      lastSentAt: device.lastSentAt ?? null,
      problem: device.problem ?? null,
      endpointEnd: device.endpoint.slice(-12),
    }));
  }

  /** Turns notifications on for a device (or renames it, if it's already on). */
  async add(subscription: PushSubscriptionInput, name: string, now: Date): Promise<PushDeviceInfo> {
    const existing = this.data.devices.find(device => device.endpoint === subscription.endpoint);
    if (!existing && this.data.devices.length >= MAX_PUSH_DEVICES) throw new StoreError(409, `At most ${MAX_PUSH_DEVICES} devices can get notifications`);
    const device: Device = existing
      ? { ...existing, name, keys: subscription.keys }
      : { id: newId(), name, endpoint: subscription.endpoint, keys: subscription.keys, addedAt: now.toISOString() };
    const { problem: _cleared, ...fixed } = device;
    await this.save({ ...this.data, devices: existing ? this.data.devices.map(d => (d === existing ? fixed : d)) : [...this.data.devices, fixed] });
    return this.devices().find(info => info.id === device.id)!;
  }

  async remove(id: string): Promise<void> {
    if (!this.data.devices.some(device => device.id === id)) return;
    await this.save({ ...this.data, devices: this.data.devices.filter(device => device.id !== id) });
  }

  /** Sends a notification to every device (or one). Devices whose push service says they're gone are removed. */
  async send(notice: Notice, now: Date, only?: string): Promise<PushResult> {
    const targets = this.data.devices.filter(device => !only || device.id === only);
    const results = await Promise.all(targets.map(device => this.sendOne(device, notice).then(outcome => ({ device, outcome }))));
    let devices = this.data.devices;
    for (const { device, outcome } of results) {
      if (outcome === 'gone') {
        devices = devices.filter(d => d.id !== device.id);
        this.log(`Notifications: ${device.name} no longer takes them (turned off there), so it was removed.`);
      } else {
        const { problem: _old, ...rest } = device;
        const next: Device = outcome === 'ok' ? { ...rest, lastSentAt: now.toISOString() } : { ...rest, problem: outcome };
        devices = devices.map(d => (d.id === device.id ? next : d));
        if (outcome !== 'ok') this.log(`Notifications: couldn’t send to ${device.name}: ${outcome}`);
      }
    }
    if (results.length) await this.save({ ...this.data, devices });
    const sent = results.filter(r => r.outcome === 'ok').length;
    return { sent, failed: results.length - sent };
  }

  private async sendOne(device: Device, notice: Notice): Promise<'ok' | 'gone' | string> {
    const { publicKey, privateKey } = this.data;
    let details;
    try {
      details = webpush.generateRequestDetails({ endpoint: device.endpoint, keys: device.keys }, JSON.stringify(notice), {
        vapidDetails: { subject: this.subject(), publicKey, privateKey },
        contentEncoding: 'aes128gcm',
        TTL: TTL_S,
        urgency: 'high',
      });
    } catch (error) {
      return `its keys don’t work (${error instanceof Error ? error.message : String(error)}). Turn notifications off and on again there.`;
    }
    try {
      const response = await this.fetcher(details.endpoint, {
        method: 'POST',
        // As text (fetch works out the length itself).
        headers: Object.fromEntries(
          Object.entries(details.headers)
            .filter(([name]) => name.toLowerCase() !== 'content-length')
            .map(([name, value]) => [name, String(value)]),
        ),
        body: details.body ? new Uint8Array(details.body) : null,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        redirect: 'error',
      });
      if (response.ok) return 'ok';
      if (response.status === 404 || response.status === 410) return 'gone';
      return `its push service said no (${response.status}).`;
    } catch {
      return 'its push service couldn’t be reached.';
    }
  }

  flush(): Promise<void> {
    return this.file.flush();
  }

  private async save(next: PushFile): Promise<void> {
    this.data = next;
    await this.file.write(next);
    for (const listener of this.listeners) listener();
  }
}
