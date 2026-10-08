import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PushDeviceInfo, PushOverview } from '../../../shared/api.ts';
import { currentTime } from '../lib/now.ts';
import { onServerEvent } from './serverEvents.ts';

// Notifications on this phone or computer (Web Push). An iPhone gets them only from the
// board added to its Home Screen and opened at the board's https address; the app says
// what's missing. Turning them on registers the service worker (sw.js), asks for
// permission, and gives the wall computer this device's push address.

export type PushSupport = 'ok' | 'needs-https' | 'needs-home-screen' | 'unsupported';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** Whether this browser can get the board's notifications, and if not, what's missing. */
export function pushSupport(): PushSupport {
  if (__DEMO_BUILD__) return 'ok';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  if (!window.isSecureContext) return 'needs-https';
  if (isIos() && !standalone) return 'needs-home-screen';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return isIos() ? 'needs-home-screen' : 'unsupported';
  return 'ok';
}

function call(path: string, method = 'GET', body?: unknown): Promise<Response> {
  return fetch(new URL(path, document.baseURI), {
    method,
    cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

async function readError(response: Response): Promise<string> {
  try {
    return ((await response.json()) as { error?: string }).error ?? 'That didn’t work. Try again.';
  } catch {
    return 'That didn’t work. Try again.';
  }
}

// ---- The list of devices, shared by everything that shows it ----

const DEMO_DEVICE: PushDeviceInfo = {
  id: 'demo-iphone',
  name: 'iPhone',
  addedAt: new Date(currentTime().getTime() - 4 * 86_400_000).toISOString(),
  lastSentAt: new Date(currentTime().getTime() - 3 * 3_600_000).toISOString(),
  problem: null,
  endpointEnd: 'demo-iphone',
};

let overview: PushOverview | null = __DEMO_BUILD__ ? { publicKey: '', devices: [DEMO_DEVICE] } : null;
const listeners = new Set<() => void>();

function set(next: PushOverview): void {
  overview = next;
  listeners.forEach(listener => listener());
}

async function load(): Promise<void> {
  if (__DEMO_BUILD__) return;
  try {
    const response = await call('api/push');
    if (response.ok) set((await response.json()) as PushOverview);
  } catch {
    // Offline: keep what's showing.
  }
}

/** The devices that get notifications (null until loaded). */
export function usePush(): PushOverview | null {
  const value = useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => overview,
  );
  useEffect(() => {
    if (__DEMO_BUILD__) return;
    void load();
    return onServerEvent('push', () => void load());
  }, []);
  return value;
}

// ---- This device ----

let demoEndpoint: string | null = null;

/** The end of this device's push address, when it gets notifications (to find it in the list). */
export function useThisDevice(): string | null | undefined {
  const [endpoint, setEndpoint] = useState<string | null | undefined>(__DEMO_BUILD__ ? demoEndpoint : undefined);
  const devices = usePush()?.devices;
  useEffect(() => {
    if (__DEMO_BUILD__) {
      setEndpoint(demoEndpoint);
      return;
    }
    if (pushSupport() !== 'ok') {
      setEndpoint(null);
      return;
    }
    let live = true;
    navigator.serviceWorker
      .getRegistration()
      .then(registration => registration?.pushManager.getSubscription())
      .then(
        subscription => live && setEndpoint(subscription?.endpoint ?? null),
        () => live && setEndpoint(null),
      );
    return () => {
      live = false;
    };
  }, [devices]);
  return endpoint;
}

/** The device in the list that is this one. */
export function thisDevice(devices: PushDeviceInfo[], endpoint: string | null | undefined): PushDeviceInfo | undefined {
  return endpoint ? devices.find(device => endpoint.endsWith(device.endpointEnd)) : undefined;
}

/** The server's key, as the bytes PushManager wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** "Turn on notifications on this phone". Call it straight from a tap (iPhones only ask then). Answers with a problem to show, or null. */
export async function turnOnNotifications(name: string): Promise<string | null> {
  if (__DEMO_BUILD__) {
    demoEndpoint = 'demo-this';
    set({ publicKey: '', devices: [...overview!.devices, { ...DEMO_DEVICE, id: 'demo-this', name, addedAt: currentTime().toISOString(), lastSentAt: null, endpointEnd: 'demo-this' }] });
    return null;
  }
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'Notifications are blocked for the board. Allow them in the iPhone’s Settings → Notifications (or the browser’s site settings), then try again.';
  if (permission !== 'granted') return 'Notifications weren’t allowed.';
  try {
    if (!overview) await load();
    if (!overview) return 'Couldn’t reach the wall. Check your connection and try again.';
    const registration = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(overview.publicKey) }));
    const response = await call('api/push/devices', 'POST', { subscription: subscription.toJSON(), name });
    if (!response.ok) return await readError(response);
    set((await response.json()) as PushOverview);
    return null;
  } catch (error) {
    return `Couldn’t turn them on here (${error instanceof Error ? error.message : String(error)}).`;
  }
}

/** Stops notifications on this device (or, with an id, on another one). */
export async function turnOffNotifications(device: PushDeviceInfo, here: boolean): Promise<boolean> {
  if (__DEMO_BUILD__) {
    if (here) demoEndpoint = null;
    set({ publicKey: '', devices: overview!.devices.filter(d => d.id !== device.id) });
    return true;
  }
  try {
    if (here) {
      const registration = await navigator.serviceWorker.getRegistration();
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
    }
    const response = await call(`api/push/devices/${encodeURIComponent(device.id)}`, 'DELETE');
    if (response.ok) set((await response.json()) as PushOverview);
    return response.ok;
  } catch {
    return false;
  }
}

/** "Send a test" to one device. */
export async function testNotification(device: PushDeviceInfo): Promise<string> {
  if (__DEMO_BUILD__) return 'In this preview nothing is sent.';
  try {
    const response = await call(`api/push/devices/${encodeURIComponent(device.id)}/test`, 'POST', {});
    if (!response.ok) return await readError(response);
    const result = (await response.json()) as { sent: number };
    void load();
    return result.sent ? 'Sent. It should show up in a moment.' : 'It didn’t go through. See below.';
  } catch {
    return 'Couldn’t reach the wall. Check your connection and try again.';
  }
}

/** A tapped notification opens its sticky, in this window if it's open (see sw.js). */
export function listenForNotificationTaps(go: (hash: string) => void): void {
  if (__DEMO_BUILD__ || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', event => {
    const data = event.data as { type?: unknown; url?: unknown } | null;
    if (data?.type !== 'open' || typeof data.url !== 'string') return;
    const hash = new URL(data.url, location.href).hash.replace(/^#/, '');
    if (hash) go(hash);
  });
}
