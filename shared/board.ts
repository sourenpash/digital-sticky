import { isSameDay, parseISO } from 'date-fns';
import { parseWhen, type When } from './dates.ts';
import { isRested } from './recurring.ts';
import { FINISHED_STAGES, type Lane, type Note, type NoteColor } from './types.ts';

export interface NoteWhen {
  when: When;
  /** `due` = deadline, `remind` = reminder time. */
  kind: 'due' | 'remind';
}

/** The date that matters for a note: its deadline, otherwise its reminder. */
export function noteWhen(note: Note): NoteWhen | null {
  const due = parseWhen(note.due);
  if (due) return { when: due, kind: 'due' };
  const remind = parseWhen(note.remindAt);
  if (remind) return { when: remind, kind: 'remind' };
  return null;
}

/** Submitted / awarded / declined applications no longer count down. */
export function isFinishedStage(note: Note): boolean {
  return note.stage !== undefined && FINISHED_STAGES.includes(note.stage);
}

export function unverifiedCount(note: Note): number {
  return note.links.filter(link => !link.verified).length;
}

export function checklistProgress(note: Note): { done: number; total: number } {
  return { done: note.checklist.filter(item => item.done).length, total: note.checklist.length };
}

export function noteColor(note: Note, lane: Lane | undefined): NoteColor {
  return note.color ?? lane?.color ?? 'yellow';
}

function rank(note: Note, now: Date): number {
  if (note.done || isRested(note, now)) return 3;
  if (isFinishedStage(note)) return 2;
  return note.pinned ? 0 : 1;
}

/**
 * Pinned first, then soonest date (overdue first), then newest. Finished applications,
 * done notes and recurring tasks that are done for now go last.
 */
export function compareNotes(a: Note, b: Note, now: Date): number {
  const byRank = rank(a, now) - rank(b, now);
  if (byRank !== 0) return byRank;
  const wa = noteWhen(a);
  const wb = noteWhen(b);
  if (wa && wb) return wa.when.date.getTime() - wb.when.date.getTime();
  if (wa) return -1;
  if (wb) return 1;
  return b.createdAt.localeCompare(a.createdAt);
}

/** Done notes stay on the wall (faded) until midnight, then drop off. */
export function visibleOnWall(note: Note, now: Date): boolean {
  if (!note.done) return true;
  return note.doneAt !== undefined && isSameDay(parseISO(note.doneAt), now);
}

/** Open notes with a date, soonest first — for "Coming up" lists and the calendar. */
export function datedNotes(notes: Note[]): Array<{ note: Note } & NoteWhen> {
  return notes
    .filter(note => !note.done && !isFinishedStage(note))
    .flatMap(note => {
      const w = noteWhen(note);
      return w ? [{ note, ...w }] : [];
    })
    .sort((a, b) => a.when.date.getTime() - b.when.date.getTime());
}

export function lanesInOrder(lanes: Lane[]): Lane[] {
  return [...lanes].sort((a, b) => a.order - b.order);
}
