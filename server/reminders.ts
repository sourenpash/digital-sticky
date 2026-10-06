import { latestNudge } from '../shared/followups.ts';
import type { ReminderFire, ServerOp } from '../shared/ops.ts';
import { MAX_ALERTS } from '../shared/schema.ts';
import type { Board } from '../shared/types.ts';
import { newId, type BoardStore } from './store.ts';

// Reminders go off here, on the server, so every screen agrees on what's showing.
// Every few seconds: reminders whose time has come pop up on the wall, and so do
// follow-up nudges (again at each interval until they're dealt with). Pop-ups that
// have been up for the "Reminders stay up for" time go away.

const MINUTE_MS = 60_000;
/** A reminder missed by longer than this (the board was off) is skipped, not shown late. */
export const CATCH_UP_MS = 24 * 60 * MINUTE_MS;

export type ReminderTick = Extract<ServerOp, { type: 'reminders.tick' }>;

/** What needs to change on the wall right now, or null if nothing does. */
export function reminderTick(board: Board, now: Date, makeId: () => string = newId): ReminderTick | null {
  const time = now.getTime();
  const staysUp = board.settings.wall.alertMinutes * MINUTE_MS;
  const expire = board.alerts.filter(alert => Date.parse(alert.firedAt) + staysUp <= time).map(alert => alert.id);
  const showing = new Set(board.alerts.filter(alert => !expire.includes(alert.id)).map(alert => alert.noteId));
  let room = MAX_ALERTS - showing.size;

  const fire: ReminderFire[] = [];
  const due = (noteId: string, at: number, done: boolean): { show: boolean } | null => {
    // A finished note, or one from long ago, is marked as handled without popping up.
    const show = !done && time - at <= CATCH_UP_MS;
    if (show && !showing.has(noteId)) {
      if (room <= 0) return null; // waits for older pop-ups to go
      room -= 1;
      showing.add(noteId);
    }
    return { show };
  };
  for (const note of board.notes) {
    if (note.remindAt) {
      const at = Date.parse(note.remindAt);
      if (at <= time && (note.remindedFor === undefined || Date.parse(note.remindedFor) !== at)) {
        const item = due(note.id, at, note.done);
        if (item) fire.push({ noteId: note.id, remindAt: note.remindAt, alertId: makeId(), ...item });
      }
    }
    const nudge = note.followUp ? latestNudge(note.followUp, now) : null;
    if (nudge && (note.followedUpFor === undefined || Date.parse(note.followedUpFor) !== nudge.getTime())) {
      const item = due(note.id, nudge.getTime(), note.done);
      if (item) fire.push({ noteId: note.id, remindAt: nudge.toISOString(), alertId: makeId(), kind: 'follow', ...item });
    }
  }
  return fire.length || expire.length ? { type: 'reminders.tick', fire, expire } : null;
}

export interface ReminderOptions {
  tickMs?: number;
  log?: (message: string) => void;
}

/** Checks for reminders now (catching up after a restart) and every `tickMs`. Returns stop. */
export function startReminders(store: BoardStore, { tickMs = 10_000, log = () => {} }: ReminderOptions = {}): () => void {
  const tick = () => {
    try {
      const change = reminderTick(store.board, store.now());
      if (change) store.apply(change);
    } catch (error) {
      log(`Could not update reminders: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  tick();
  const timer = setInterval(tick, tickMs);
  timer.unref();
  return () => clearInterval(timer);
}
