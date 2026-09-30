import { isFinishedStage, noteWhen } from '../../../shared/board.ts';
import { countdownLabel, isPast, reminderLabel, urgencyOf } from '../../../shared/dates.ts';
import type { Note } from '../../../shared/types.ts';

export type ChipTone = 'overdue' | 'today' | 'soon' | 'week' | 'later' | 'remind' | 'good' | 'muted';

export interface ChipInfo {
  label: string;
  tone: ChipTone;
  icon?: 'bell' | 'check';
}

/** What the little date badge on a note says, and how loud it is. */
export function chipFor(note: Note, now: Date): ChipInfo | null {
  if (note.done) return null;
  if (note.stage && isFinishedStage(note)) {
    return note.stage === 'Declined'
      ? { label: 'Declined', tone: 'muted' }
      : { label: note.stage, tone: 'good', icon: 'check' };
  }
  const w = noteWhen(note);
  if (!w) return null;
  if (w.kind === 'remind') {
    return isPast(w.when, now)
      ? { label: 'Went off', tone: 'muted', icon: 'bell' }
      : { label: reminderLabel(w.when, now), tone: 'remind', icon: 'bell' };
  }
  return { label: countdownLabel(w.when, now), tone: urgencyOf(w.when, now) };
}

/** Small, stable tilt per note so the wall looks hand-placed without jumping around. */
export function tiltFor(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return ((Math.abs(hash) % 31) - 15) / 10; // -1.5° … 1.5°
}
