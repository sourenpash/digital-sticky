import type { ScreenInfo } from '../shared/api.ts';
import type { EventHub } from './events.ts';
import type { BoardStore } from './store.ts';

// The devices set up as wall screens: the wall computer's own monitor, an iPad, a TV
// browser… Each showing wall checks in every minute; "showing now" is kept in memory,
// and the last time seen is saved now and then.

/** The wall computer's own entry: it's recognized by being this computer, not by a cookie. */
export const LOCAL_SCREEN_ID = 'wall-computer';
export const LOCAL_SCREEN_NAME = 'Wall computer';
/** A screen that checked in within this long is showing the wall now. */
export const SHOWING_MS = 3 * 60_000;

export class Screens {
  private readonly store: BoardStore;
  private readonly hub: EventHub | null;
  private readonly checkIns = new Map<string, number>();
  private showing = new Set<string>();

  constructor(store: BoardStore, hub: EventHub | null) {
    this.store = store;
    this.hub = hub;
  }

  /** Every wall screen, for the Wall tab. `thisId`: the asking device's own screen. */
  list(thisId: string | null): ScreenInfo[] {
    const now = this.store.now().getTime();
    return this.store.screens.map(screen => {
      const lastCheckIn = this.checkIns.get(screen.id);
      const lastSeen = Math.max(lastCheckIn ?? 0, screen.lastSeenAt ? Date.parse(screen.lastSeenAt) : 0);
      return {
        id: screen.id,
        name: screen.name,
        addedAt: screen.addedAt,
        lastSeenAt: lastSeen ? new Date(lastSeen).toISOString() : null,
        showing: lastCheckIn !== undefined && now - lastCheckIn < SHOWING_MS,
        thisDevice: screen.id === thisId,
        wallComputer: screen.id === LOCAL_SCREEN_ID,
      };
    });
  }

  /** A wall screen checked in: it's showing the wall. */
  checkIn(id: string): void {
    const now = this.store.now();
    this.checkIns.set(id, now.getTime());
    this.store.markScreenSeen(id, now);
    if (!this.showing.has(id)) {
      this.showing.add(id);
      this.changed();
    }
  }

  forget(id: string): void {
    this.checkIns.delete(id);
    this.showing.delete(id);
  }

  /** Tells open screens to fetch the list again. */
  changed(): void {
    this.hub?.broadcast('screens', {});
  }

  /** Notices screens that stopped checking in. */
  sweep(): void {
    const now = this.store.now().getTime();
    let stopped = false;
    for (const id of this.showing) {
      const at = this.checkIns.get(id);
      if (at === undefined || now - at >= SHOWING_MS) {
        this.showing.delete(id);
        stopped = true;
      }
    }
    if (stopped) this.changed();
  }

  start(everyMs = 30_000): () => void {
    const timer = setInterval(() => this.sweep(), everyMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}
