import { useEffect, useState } from 'react';
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
