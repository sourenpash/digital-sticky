import { useSyncExternalStore } from 'react';

// The phone remote for the wall screen. For now it only drives a cursor on the
// side-by-side preview page; the step that sets up the wall computer connects it to
// the wall's browser, so the same controls move the real cursor and type there.

export interface RemoteCursor {
  /** Position as a share of the wall's width and height (0–1). */
  x: number;
  y: number;
  visible: boolean;
  /** Goes up with every tap, so the wall can show a click. */
  clicks: number;
}

/** Touchpad moves are in wall pixels of a 1920×1080 screen. */
const WALL_W = 1920;
const WALL_H = 1080;
const HIDE_AFTER_MS = 4000;

let cursor: RemoteCursor = { x: 0.5, y: 0.45, visible: false, clicks: 0 };
const listeners = new Set<() => void>();
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function update(next: Partial<RemoteCursor>): void {
  cursor = { ...cursor, ...next, visible: true };
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    cursor = { ...cursor, visible: false };
    listeners.forEach(listener => listener());
  }, HIDE_AFTER_MS);
  listeners.forEach(listener => listener());
}

export type RemoteKey = 'Enter' | 'Backspace' | 'Tab' | 'Escape' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
export type RemotePlace = 'board' | 'back' | 'reload' | { url: string };

export const remote = {
  /** Whether it reaches a real wall yet (the preview page's cursor is always there). */
  connected: false,
  move(dx: number, dy: number): void {
    update({ x: clamp(cursor.x + dx / WALL_W), y: clamp(cursor.y + dy / WALL_H) });
  },
  click(): void {
    update({ clicks: cursor.clicks + 1 });
  },
  scroll(_dx: number, _dy: number): void {},
  type(_text: string): void {},
  key(_key: RemoteKey): void {},
  go(_place: RemotePlace): void {},
};

export function useRemoteCursor(): RemoteCursor {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => cursor,
  );
}
