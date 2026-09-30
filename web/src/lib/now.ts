import { useEffect, useState } from 'react';

/** `?now=2026-09-30T22:42` freezes the clock (used for repeatable screenshots). */
function readFrozenNow(): Date | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('now');
    if (!raw) return null;
    const date = new Date(raw); // no offset → local time
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

const FROZEN = readFrozenNow();

export function currentTime(): Date {
  return FROZEN ? new Date(FROZEN) : new Date();
}

/** Re-renders every `intervalMs` so clocks, countdowns and night mode roll over on an always-on screen. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(currentTime);
  useEffect(() => {
    if (FROZEN) return;
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
