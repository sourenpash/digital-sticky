import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ScreenInfo } from '../../../shared/api.ts';
import { currentTime } from '../lib/now.ts';
import { onServerEvent } from './serverEvents.ts';
import { refreshSession } from './session.ts';

// Wall screens: any device can show the wall (an iPad, a TV's web browser, an old
// laptop). The server keeps the list and knows each one by a cookie. The device also
// remembers it's one, so it can open straight to the wall before the server answers.

const HINT_KEY = 'sticky-wall:wall-screen';
/** A wall screen checks in this often while it shows the wall. */
export const CHECK_IN_MS = 60_000;

export function wallScreenHint(): boolean {
  if (__DEMO_BUILD__) return false;
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setWallScreenHint(on: boolean): void {
  if (__DEMO_BUILD__) return;
  try {
    if (on) localStorage.setItem(HINT_KEY, '1');
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // Private browsing can refuse storage: the server still knows, it just opens a moment later.
  }
}

/** A name to start from for this device: "iPad", "Mac", "TV"… */
export function defaultScreenName(): string {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/SMART-TV|SmartTV|Tizen|Web0S|webOS|CrKey|AFT\w|BRAVIA/i.test(ua)) return 'TV';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows computer';
  return 'Computer';
}

function call(path: string, method = 'GET', body?: unknown): Promise<Response> {
  return fetch(new URL(path, document.baseURI), {
    method,
    cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

// ---- The preview page's sample screens ----

let demoScreens: ScreenInfo[] = [];
const demoListeners = new Set<() => void>();

function demoSet(next: ScreenInfo[]): void {
  demoScreens = next;
  demoListeners.forEach(listener => listener());
}

if (__DEMO_BUILD__) {
  const now = currentTime().getTime();
  demoScreens = [
    { id: 'wall-computer', name: 'Wall computer', addedAt: new Date(now - 20 * 86_400_000).toISOString(), lastSeenAt: new Date(now).toISOString(), showing: true, thisDevice: false, wallComputer: true },
    { id: 'demo-ipad', name: 'Kitchen iPad', addedAt: new Date(now - 6 * 86_400_000).toISOString(), lastSeenAt: new Date(now - 3 * 3_600_000).toISOString(), showing: false, thisDevice: false, wallComputer: false },
  ];
}

// ---- The list, for the Wall tab ----

/** The wall screens (null while loading), kept up to date while shown. */
export function useScreens(): ScreenInfo[] | null {
  const demo = useSyncExternalStore(
    listener => {
      demoListeners.add(listener);
      return () => demoListeners.delete(listener);
    },
    () => demoScreens,
  );
  const [screens, setScreens] = useState<ScreenInfo[] | null>(null);
  useEffect(() => {
    if (__DEMO_BUILD__) return;
    let live = true;
    const load = () =>
      call('api/screens')
        .then(response => (response.ok ? (response.json() as Promise<{ screens: ScreenInfo[] }>) : null))
        .then(
          data => {
            if (live && data) setScreens(data.screens);
          },
          () => {},
        );
    void load();
    const off = onServerEvent('screens', () => void load());
    // "Showing now" and "last seen" go stale by themselves.
    const timer = window.setInterval(() => void load(), CHECK_IN_MS);
    return () => {
      live = false;
      off();
      window.clearInterval(timer);
    };
  }, []);
  return __DEMO_BUILD__ ? demo : screens;
}

/** Sets this device up as a wall screen. */
export async function becomeWallScreen(name: string): Promise<boolean> {
  if (__DEMO_BUILD__) {
    demoSet([...demoScreens.filter(screen => !screen.thisDevice), { id: 'demo-this', name, addedAt: currentTime().toISOString(), lastSeenAt: null, showing: false, thisDevice: true, wallComputer: false }]);
    return true;
  }
  try {
    const response = await call('api/screens', 'POST', { name });
    if (!response.ok) return false;
  } catch {
    return false;
  }
  setWallScreenHint(true);
  await refreshSession();
  return true;
}

export async function renameScreen(id: string, name: string): Promise<boolean> {
  if (__DEMO_BUILD__) {
    demoSet(demoScreens.map(screen => (screen.id === id ? { ...screen, name } : screen)));
    return true;
  }
  try {
    return (await call(`api/screens/${encodeURIComponent(id)}`, 'PATCH', { name })).ok;
  } catch {
    return false;
  }
}

/** Removes a wall screen (this device or another): it stops being one, and signs out if that's how it got in. */
export async function removeScreen(screen: ScreenInfo): Promise<boolean> {
  if (__DEMO_BUILD__) {
    demoSet(demoScreens.filter(entry => entry.id !== screen.id));
    return true;
  }
  try {
    if (!(await call(`api/screens/${encodeURIComponent(screen.id)}`, 'DELETE')).ok) return false;
  } catch {
    return false;
  }
  if (screen.thisDevice) {
    setWallScreenHint(false);
    await refreshSession();
  }
  return true;
}

/**
 * Tells the server this device is showing the wall. Answers with its wall-screen entry,
 * null if it isn't one (or was removed), or undefined if the server couldn't be reached.
 */
export async function checkIn(): Promise<ScreenInfo | null | undefined> {
  try {
    const response = await call('api/screens/here', 'POST', {});
    if (!response.ok) return undefined;
    return ((await response.json()) as { screen: ScreenInfo | null }).screen;
  } catch {
    return undefined;
  }
}
