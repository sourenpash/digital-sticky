import { useEffect, useSyncExternalStore } from 'react';
import type { IMessageInfo } from '../../../shared/api.ts';
import type { IMessageInput } from '../../../shared/schema.ts';
import { SAMPLE_ANYWHERE_URL, SAMPLE_CONNECT_URL } from '../../../shared/sample.ts';
import { currentTime } from '../lib/now.ts';
import { onServerEvent } from './serverEvents.ts';

// Texts through iMessage (BlueBubbles on a Mac): the settings, for the Wall tab.

const DEMO_PATH = '/hooks/imessage/4tQ9xLmW2cRvB7nKs1JpZ8yHdF3gUeA6oVi0bN5wqCE';

let info: IMessageInfo | null = __DEMO_BUILD__
  ? {
      url: 'http://mac-mini.local:1234',
      passwordSet: true,
      addresses: ['+1 555 010 4477'],
      reminders: true,
      followUps: true,
      morning: true,
      morningTime: '08:00',
      webhook: { anywhere: `${SAMPLE_ANYWHERE_URL}${DEMO_PATH}`, home: `${SAMPLE_CONNECT_URL}${DEMO_PATH}`, path: DEMO_PATH },
      lastSent: { at: new Date(currentTime().getTime() - 2 * 3_600_000).toISOString(), ok: true, message: 'Sent.' },
      lastReceived: { at: new Date(currentTime().getTime() - 2 * 3_600_000 + 60_000).toISOString(), from: '+1 555 010 4477', text: 'done' },
    }
  : null;
const listeners = new Set<() => void>();

function set(next: IMessageInfo): void {
  info = next;
  listeners.forEach(listener => listener());
}

function call(path: string, method = 'GET', body?: unknown): Promise<Response> {
  return fetch(new URL(path, document.baseURI), {
    method,
    cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

async function load(): Promise<void> {
  if (__DEMO_BUILD__) return;
  try {
    const response = await call('api/imessage');
    if (response.ok) set((await response.json()) as IMessageInfo);
  } catch {
    // Offline: keep what's showing.
  }
}

/** The texts settings (null until loaded). */
export function useTexts(): IMessageInfo | null {
  const value = useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => info,
  );
  useEffect(() => {
    if (__DEMO_BUILD__) return;
    void load();
    return onServerEvent('imessage', () => void load());
  }, []);
  return value;
}

/** Saves the settings. Answers with a problem to show, or null. */
export async function saveTexts(input: IMessageInput): Promise<string | null> {
  if (__DEMO_BUILD__) {
    set({ ...info!, url: input.url || null, passwordSet: info!.passwordSet || Boolean(input.password), addresses: input.addresses, reminders: input.reminders, followUps: input.followUps, morning: input.morning, morningTime: input.morningTime });
    return null;
  }
  try {
    const response = await call('api/imessage', 'PUT', input);
    if (!response.ok) return ((await response.json().catch(() => ({}))) as { error?: string }).error ?? 'That didn’t work. Try again.';
    set((await response.json()) as IMessageInfo);
    return null;
  } catch {
    return 'Couldn’t reach the wall. Check your connection and try again.';
  }
}

/** "Send a test text": a real text, to everyone on the list. */
export async function testText(): Promise<{ ok: boolean; message: string }> {
  if (__DEMO_BUILD__) return { ok: true, message: 'In this preview nothing is sent.' };
  try {
    const response = await call('api/imessage/test', 'POST', {});
    const result = (await response.json()) as { ok?: boolean; message?: string; error?: string };
    void load();
    return { ok: Boolean(result.ok), message: result.message ?? result.error ?? 'That didn’t work.' };
  } catch {
    return { ok: false, message: 'Couldn’t reach the wall. Check your connection and try again.' };
  }
}
