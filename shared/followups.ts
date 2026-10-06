import { addDays, differenceInCalendarDays, isValid, parseISO, set } from 'date-fns';
import type { FollowUp, Note } from './types.ts';

// Following up after an application goes in or a message is sent. The board nudges at
// the chosen time, then again every so often (same time of day) until you hear back.

/** Nudges go off at this hour. */
const NUDGE_HOUR = 9;

export interface FollowUpChoice {
  days: number;
  label: string;
}

const CHOICES: FollowUpChoice[] = [
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '1 month' },
];

/** "3 days" is offered for texts and calls only; applications take longer. */
export function followUpChoices(note: Pick<Note, 'channel'>): FollowUpChoice[] {
  return note.channel ? CHOICES : CHOICES.slice(1);
}

/** The usual wait: 2 weeks for an application, a week for an email, 3 days for a text or call. */
export function defaultFollowUpDays(note: Pick<Note, 'channel'>): number {
  if (!note.channel) return 14;
  return note.channel === 'email' ? 7 : 3;
}

/** "every 2 weeks", "every 3 days", "every month". */
export function everyLabel(days: number): string {
  if (days === 30) return 'every month';
  if (days === 7) return 'every week';
  if (days % 7 === 0) return `every ${days / 7} weeks`;
  return days === 1 ? 'every day' : `every ${days} days`;
}

function nudgeOn(day: Date): string {
  return set(day, { hours: NUDGE_HOUR, minutes: 0, seconds: 0, milliseconds: 0 }).toISOString();
}

/** Follow up in `days`, and again every `days` until there's an answer. */
export function startFollowUp(days: number, now: Date): FollowUp {
  return { at: nudgeOn(addDays(now, days)), everyDays: days };
}

/** After "I followed up": the next nudge, or nothing for a one-time follow-up. */
export function afterFollowingUp(followUp: FollowUp, now: Date): FollowUp | undefined {
  return followUp.everyDays > 0 ? { at: nudgeOn(addDays(now, followUp.everyDays)), everyDays: followUp.everyDays } : undefined;
}

/** The latest nudge time that has come (at or before `now`), or null if none has yet. */
export function latestNudge(followUp: FollowUp, now: Date): Date | null {
  const first = parseISO(followUp.at);
  if (!isValid(first) || first.getTime() > now.getTime()) return null;
  if (followUp.everyDays <= 0) return first;
  const steps = Math.floor(differenceInCalendarDays(now, first) / followUp.everyDays);
  const due = addDays(first, steps * followUp.everyDays);
  return due.getTime() > now.getTime() ? addDays(due, -followUp.everyDays) : due;
}

/** Whether `iso` is one of the follow-up's nudge times. */
export function isNudgeTime(followUp: FollowUp, iso: string): boolean {
  const first = parseISO(followUp.at);
  const time = parseISO(iso);
  if (!isValid(first) || !isValid(time) || time.getTime() < first.getTime()) return false;
  if (followUp.everyDays <= 0) return time.getTime() === first.getTime();
  const days = differenceInCalendarDays(time, first);
  return days % followUp.everyDays === 0 && addDays(first, days).getTime() === time.getTime();
}

/** A nudge has come and not been dealt with yet ("I followed up" moves `at` on). */
export function followUpDue(note: Pick<Note, 'followUp'>, now: Date): boolean {
  return note.followUp !== undefined && Date.parse(note.followUp.at) <= now.getTime();
}

/** Waiting to hear back: a submitted application, or a sent message that isn't done. */
export function awaitingReply(note: Pick<Note, 'stage' | 'channel' | 'sentAt' | 'done'>): boolean {
  if (note.done) return false;
  return note.stage === 'Submitted' || (note.channel !== undefined && note.sentAt !== undefined);
}
