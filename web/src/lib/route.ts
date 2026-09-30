import { useSyncExternalStore } from 'react';
import type { LaneKind } from '../../../shared/types.ts';

// Hash routes are plain tokens (#wall, #board, #note-abc) so they also work inside
// the published preview page, which only passes simple #anchors through.

export type EditorTab = 'board' | 'calendar' | 'check' | 'display';

export type Route =
  | { view: 'wall' }
  | { view: 'demo' }
  | { view: 'login' }
  | { view: 'editor'; tab: EditorTab; noteId?: string; newKind?: LaneKind; goalId?: string; newGoal?: boolean };

const TABS: EditorTab[] = ['board', 'calendar', 'check', 'display'];
const KINDS: LaneKind[] = ['application', 'source', 'task', 'routine', 'reminder', 'note'];

export function parseRoute(token: string): Route | null {
  if (token === 'wall' || token === 'demo' || token === 'login') return { view: token };
  if ((TABS as string[]).includes(token)) return { view: 'editor', tab: token as EditorTab };
  if (token.startsWith('note-')) return { view: 'editor', tab: 'board', noteId: token.slice(5) };
  if (token === 'new-goal') return { view: 'editor', tab: 'board', newGoal: true };
  if (token.startsWith('goal-')) return { view: 'editor', tab: 'board', goalId: token.slice(5) };
  if (token.startsWith('new-')) {
    const kind = token.slice(4) as LaneKind;
    if (KINDS.includes(kind)) return { view: 'editor', tab: 'board', newKind: kind };
  }
  return null;
}

function readHash(): string {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, ''));
  } catch {
    return '';
  }
}

let current = readHash();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

window.addEventListener('hashchange', () => {
  current = readHash();
  notify();
});

export function navigate(token: string): void {
  if (token === current) return;
  current = token;
  try {
    window.location.hash = token;
  } catch {
    // Some sandboxed frames refuse hash changes; the in-memory route still updates.
  }
  notify();
}

export function useHashToken(): string {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
