import { useSyncExternalStore } from 'react';
import { PAIR_ROUTE_PREFIX } from '../../../shared/pairing.ts';
import type { Channel, LaneKind } from '../../../shared/types.ts';

// Hash routes are plain tokens (#wall, #board, #note-abc) so they also work inside
// the published preview page, which only passes simple #anchors through.

export type EditorTab = 'board' | 'calendar' | 'check' | 'display';

export type Route =
  | { view: 'wall' }
  | { view: 'demo' }
  | { view: 'login' }
  | { view: 'remote' }
  /** Signing in with a code scanned from the wall (#pair-K7QM2XPA). */
  | { view: 'pair'; code: string }
  | { view: 'editor'; tab: EditorTab; noteId?: string; newKind?: LaneKind; newChannel?: Channel; goalId?: string; newGoal?: boolean };

const TABS: EditorTab[] = ['board', 'calendar', 'check', 'display'];
const KINDS: LaneKind[] = ['application', 'source', 'task', 'routine', 'reminder', 'note'];

export function parseRoute(token: string): Route | null {
  if (token === 'wall' || token === 'demo' || token === 'login' || token === 'remote') return { view: token };
  if (token.startsWith(PAIR_ROUTE_PREFIX)) return { view: 'pair', code: token.slice(PAIR_ROUTE_PREFIX.length) };
  if ((TABS as string[]).includes(token)) return { view: 'editor', tab: token as EditorTab };
  if (token.startsWith('note-')) return { view: 'editor', tab: 'board', noteId: token.slice(5) };
  if (token === 'new-goal') return { view: 'editor', tab: 'board', newGoal: true };
  if (token === 'new-message') return { view: 'editor', tab: 'board', newKind: 'task', newChannel: 'email' };
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

/** Goes to `token`. `replace` swaps the current address instead of adding to the history (Back skips it). */
export function navigate(token: string, { replace = false }: { replace?: boolean } = {}): void {
  if (token === current) return;
  current = token;
  try {
    if (replace) window.history.replaceState(window.history.state, '', `#${token}`);
    else window.location.hash = token;
  } catch {
    // Some sandboxed frames refuse hash changes; the in-memory route still updates.
  }
  notify();
}

/** The route the app opened at (before any navigating). */
export const startToken = current;

export function currentToken(): string {
  return current;
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
