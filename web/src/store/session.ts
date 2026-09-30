import { useEffect, useState } from 'react';
import { engine } from './board.ts';

// Signing in with the board's PIN (when it has one). The server keeps this device
// signed in with a cookie, so there's nothing to store here.

export interface SessionInfo {
  pinSet: boolean;
  signedIn: boolean;
  /** The wall computer itself, which gets in without the PIN. */
  wallComputer: boolean;
}

export type LoginResult = { ok: true } | { ok: false; reason: 'wrong' | 'wait' | 'offline'; retryAfter?: number };

function post(path: string, body: unknown): Promise<Response> {
  return fetch(new URL(path, document.baseURI), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function login(pin: string): Promise<LoginResult> {
  let response: Response;
  try {
    response = await post('api/login', { pin });
  } catch {
    return { ok: false, reason: 'offline' };
  }
  if (response.ok) {
    engine.unlock();
    return { ok: true };
  }
  if (response.status === 429) return { ok: false, reason: 'wait', retryAfter: Number(response.headers.get('Retry-After')) || 60 };
  if (response.status === 401) return { ok: false, reason: 'wrong' };
  return { ok: false, reason: 'offline' };
}

export async function logout(): Promise<void> {
  try {
    await post('api/logout', {});
  } finally {
    await engine.refresh();
  }
}

/** Whether the board has a PIN and how this device got in (null until known; never asked on the preview page). */
export function useSession(): SessionInfo | null {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  useEffect(() => {
    if (__DEMO_BUILD__) return;
    let cancelled = false;
    fetch(new URL('api/session', document.baseURI), { cache: 'no-store' })
      .then(response => (response.ok ? (response.json() as Promise<SessionInfo>) : null))
      .then(
        data => {
          if (!cancelled && data) setInfo(data);
        },
        () => {},
      );
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}
