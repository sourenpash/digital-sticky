import { useEffect, useState } from 'react';
import type { WallCode } from '../../../shared/api.ts';
import { REMOTE_CURSOR_ID } from '../../../shared/remote.ts';
import { CHECK_IN_MS, checkIn, setWallScreenHint, wallScreenHint } from '../store/screens.ts';
import { onServerEvent } from '../store/serverEvents.ts';
import { refreshSession } from '../store/session.ts';
import type { SyncStatus } from '../store/sync.ts';

// Things only the real wall screen (the #wall page) does.

/** Keeps the screen from going to sleep. Works on the wall computer (localhost counts as secure). */
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (stopped) void next.release();
        else lock = next;
      } catch {
        // Not allowed here (a plain-http address, or battery saver): the screen settings decide.
      }
    };
    void acquire();
    // The lock is dropped whenever the page is hidden; take it again when it's back.
    document.addEventListener('visibilitychange', acquire);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, []);
}

/**
 * True while someone is using the wall computer's mouse (or touch screen), and for
 * `idleMs` after, so the pointer shows only then. The phone remote's moves reach the
 * page as mouse moves too; they don't count. The remote draws its own cursor just after
 * each move (server/remote.ts), so a move is looked at a moment later, once that's up.
 */
export function useMouseInUse(idleMs = 3000): boolean {
  const [inUse, setInUse] = useState(false);
  useEffect(() => {
    let check = 0;
    let idle = 0;
    const remoteCursorShowing = () => document.getElementById(REMOTE_CURSOR_ID)?.style.opacity === '1';
    const onPointer = () => {
      if (check) return;
      check = window.setTimeout(() => {
        check = 0;
        if (remoteCursorShowing()) return;
        setInUse(true);
        window.clearTimeout(idle);
        idle = window.setTimeout(() => setInUse(false), idleMs);
      }, 150);
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      window.clearTimeout(check);
      window.clearTimeout(idle);
    };
  }, [idleMs]);
  return inUse;
}

/** True once the board has been out of reach for a while (short blips don't count). */
export function useLongOffline(status: SyncStatus, afterMs = 10_000): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (status !== 'offline') {
      setLong(false);
      return;
    }
    const id = window.setTimeout(() => setLong(true), afterMs);
    return () => window.clearTimeout(id);
  }, [status, afterMs]);
  return long;
}

/** A few pixels, changing every ten minutes, so nothing sits on the same pixels for months. */
const DRIFT: Array<[number, number]> = [
  [0, 0],
  [3, 2],
  [-2, 3],
  [-3, -2],
  [2, -3],
];

export function useBurnInDrift(everyMs = 10 * 60_000): [number, number] {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setStep(s => (s + 1) % DRIFT.length), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return DRIFT[step]!;
}

/**
 * The sign-in code for the wall to show in its "Connect your phone" QR code, while this
 * is the wall computer or a wall screen. A fresh one comes every couple of minutes, and
 * right after someone signs in with it.
 */
export function useWallCode(enabled: boolean): string | null {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      setCode(null);
      return;
    }
    let live = true;
    const load = () =>
      fetch(new URL('api/pair-code', document.baseURI), { cache: 'no-store' })
        .then(response => (response.ok ? (response.json() as Promise<WallCode>) : null))
        .then(
          data => {
            if (live && data) setCode(data.code);
          },
          () => {},
        );
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    const off = onServerEvent('pair', () => void load());
    return () => {
      live = false;
      window.clearInterval(timer);
      off();
    };
  }, [enabled]);
  return code;
}

/**
 * While this device shows the wall as a wall screen (or is the wall computer), it checks
 * in every minute so the Wall tab can say it's showing. If it was removed meanwhile, it
 * forgets it was one.
 */
export function useCheckIn(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || __DEMO_BUILD__) return;
    let stopped = false;
    let timer = 0;
    const beat = async () => {
      const screen = await checkIn();
      if (stopped || screen !== null) return;
      // Not (or no longer) a wall screen: stop checking in.
      window.clearInterval(timer);
      if (wallScreenHint()) {
        setWallScreenHint(false);
        void refreshSession();
      }
    };
    timer = window.setInterval(() => void beat(), CHECK_IN_MS);
    void beat();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
}
