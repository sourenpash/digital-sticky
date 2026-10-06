import { addDays, isSameDay, parseISO, startOfDay } from 'date-fns';
import { dayKey, isPast, parseWhen, type When } from './dates.ts';
import { followUpDue } from './followups.ts';
import { isRested } from './recurring.ts';
import { FINISHED_STAGES, type Lane, type Note, type NoteColor } from './types.ts';

export interface NoteWhen {
  when: When;
  /** `due` = deadline, `remind` = reminder time, `follow` = time to follow up. */
  kind: 'due' | 'remind' | 'follow';
}

/**
 * The date that matters for a note: when to follow up, otherwise its deadline,
 * otherwise its reminder. Once an application is submitted (or a message sent) its
 * deadline stops counting, but a reminder (say, for the interview) still shows.
 */
export function noteWhen(note: Note): NoteWhen | null {
  const follow = parseWhen(note.followUp?.at);
  if (follow) return { when: follow, kind: 'follow' };
  const due = deadlineDone(note) ? null : parseWhen(note.due);
  if (due) return { when: due, kind: 'due' };
  const remind = parseWhen(note.remindAt);
  if (remind) return { when: remind, kind: 'remind' };
  return null;
}

/** Submitted, interviewing, awarded or declined applications no longer count down. */
export function isFinishedStage(note: Note): boolean {
  return note.stage !== undefined && FINISHED_STAGES.includes(note.stage);
}

/** The deadline no longer counts: the application went in, or the message was sent. */
export function deadlineDone(note: Note): boolean {
  return isFinishedStage(note) || (note.channel !== undefined && note.sentAt !== undefined);
}

export interface Related {
  /** The sticky this one is a related task of (if it's still on the board). */
  parent?: Note;
  children: Note[];
}

/** A sticky's related tasks, and the sticky it belongs to. */
export function relatedTo(notes: Note[], note: Note): Related {
  const parent = note.parentId && note.parentId !== note.id ? notes.find(n => n.id === note.parentId) : undefined;
  return { parent, children: notes.filter(n => n.parentId === note.id && n.id !== note.id) };
}

export interface NoteLinks {
  /** The sticky this one belongs to, and its paper color. */
  parent?: Note;
  parentColor?: NoteColor;
  /** Its related tasks, and how many are done. */
  tasks?: { done: number; total: number };
}

/** Every sticky's links at once (for drawing a whole board of squares). */
export function linksByNote(notes: Note[], lanes: Lane[] = []): Map<string, NoteLinks> {
  const byId = new Map(notes.map(note => [note.id, note]));
  const links = new Map<string, NoteLinks>();
  const entry = (id: string): NoteLinks => {
    let found = links.get(id);
    if (!found) links.set(id, (found = {}));
    return found;
  };
  for (const note of notes) {
    const parent = note.parentId && note.parentId !== note.id ? byId.get(note.parentId) : undefined;
    if (!parent) continue;
    const link = entry(note.id);
    link.parent = parent;
    link.parentColor = noteColor(parent, lanes.find(lane => lane.id === parent.laneId));
    const tasks = (entry(parent.id).tasks ??= { done: 0, total: 0 });
    tasks.total += 1;
    if (note.done) tasks.done += 1;
  }
  return links;
}

/** "2/3 tasks" on a sticky with related tasks, or null. */
export function childProgress(notes: Note[], note: Note): { done: number; total: number } | null {
  const children = notes.filter(n => n.parentId === note.id && n.id !== note.id);
  return children.length ? { done: children.filter(child => child.done).length, total: children.length } : null;
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
  if (deadlineDone(note) && !followUpDue(note, now)) return 2;
  return note.pinned ? 0 : 1;
}

/**
 * Pinned first, then soonest date (overdue first), then newest. Finished applications
 * and sent messages (unless it's time to follow up), done notes and recurring tasks
 * that are done for now go last.
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
    .filter(note => !note.done)
    .flatMap(note => {
      const w = noteWhen(note);
      return w ? [{ note, ...w }] : [];
    })
    .sort((a, b) => a.when.date.getTime() - b.when.date.getTime());
}

export function lanesInOrder(lanes: Lane[]): Lane[] {
  return [...lanes].sort((a, b) => a.order - b.order);
}

export interface StripItem extends NoteWhen {
  note: Note;
  /** A deadline that has passed; it's listed on today. */
  overdue: boolean;
}

export interface StripDay {
  date: Date;
  key: string;
  isToday: boolean;
  isWeekend: boolean;
  items: StripItem[];
}

/**
 * The wall's calendar strip: today and the days after it, each with the deadlines,
 * follow-ups and reminders that fall on it. Overdue deadlines and follow-ups sit on
 * today so they can't be missed; reminders that already went off are left out.
 */
export function twoWeekDays(notes: Note[], now: Date, count = 14): StripDay[] {
  const start = startOfDay(now);
  const days: StripDay[] = Array.from({ length: count }, (_, i) => {
    const date = addDays(start, i);
    return { date, key: dayKey(date), isToday: i === 0, isWeekend: date.getDay() === 0 || date.getDay() === 6, items: [] };
  });
  const byKey = new Map(days.map(day => [day.key, day]));
  for (const item of datedNotes(notes)) {
    const past = isPast(item.when, now);
    if (past && item.kind === 'remind') continue;
    const day = past ? days[0] : byKey.get(dayKey(item.when.date));
    day?.items.push({ ...item, overdue: past });
  }
  return days;
}
