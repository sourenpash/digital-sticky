import { useEffect, useSyncExternalStore } from 'react';
import type { SessionResponse } from '../../../shared/api.ts';
import { engine } from './board.ts';

// Signing in, when this device has to: with the board's PIN, or with the code shown on
// the wall. The server keeps the device signed in with a cookie, so there's nothing to
// store here; this only remembers what the server said about this device.

export type SessionInfo = SessionResponse;

export type LoginResult = { ok: true } | { ok: false; reason: 'wrong' | 'wait' | 'offline'; retryAfter?: number };

let session: SessionInfo | null = null;
let asking: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Asks the server about this device again (after signing in or out, or becoming a wall screen). */
export function refreshSession(): Promise<void> {
  if (__DEMO_BUILD__) return Promise.resolve();
  const ask = fetch(new URL('api/session', document.baseURI), { cache: 'no-store' })
    .then(response => (response.ok ? (response.json() as Promise<SessionInfo>) : null))
    .then(
      data => {
        if (!data) return;
        session = data;
        listeners.forEach(listener => listener());
      },
      () => {},
    )
    .finally(() => {
      if (asking === ask) asking = null;
    });
  asking = ask;
  return ask;
}

/** What the server last said about this device, if it's been asked yet. */
export function currentSession(): SessionInfo | null {
  return session;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the board has a PIN and how this device got in (null until known; never asked on the preview page). */
export function useSession(): SessionInfo | null {
  const info = useSyncExternalStore(subscribeSession, currentSession);
  useEffect(() => {
    if (!session && !asking) void refreshSession();
  }, []);
  return info;
}

function post(path: string, body: unknown): Promise<Response> {
  return fetch(new URL(path, document.baseURI), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function signIn(path: string, body: unknown): Promise<LoginResult> {
  let response: Response;
  try {
    response = await post(path, body);
  } catch {
    return { ok: false, reason: 'offline' };
  }
  if (response.ok) {
    engine.unlock();
    await refreshSession();
    return { ok: true };
  }
  if (response.status === 429) return { ok: false, reason: 'wait', retryAfter: Number(response.headers.get('Retry-After')) || 60 };
  if (response.status === 401 || response.status === 400) return { ok: false, reason: 'wrong' };
  return { ok: false, reason: 'offline' };
}

export function login(pin: string): Promise<LoginResult> {
  return signIn('api/login', { pin });
}

/** Signs in with a code from the wall (scanned or typed). */
export function pair(code: string): Promise<LoginResult> {
  return signIn('api/pair', { code });
}

export async function logout(): Promise<void> {
  try {
    await post('api/logout', {});
  } finally {
    await Promise.all([engine.refresh(), refreshSession()]);
  }
}
