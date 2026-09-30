import { format } from 'date-fns';
import { stageLabel } from '../../../shared/applications.ts';
import { isFinishedStage, noteWhen } from '../../../shared/board.ts';
import { countdownLabel, daysUntil, isPast, reminderLabel, timeLabel, urgencyOf, type When } from '../../../shared/dates.ts';
import { repeatStatus, type RepeatStatus } from '../../../shared/recurring.ts';
import type { Note } from '../../../shared/types.ts';

export type ChipTone =
  | 'overdue'
  | 'today'
  | 'soon'
  | 'week'
  | 'later'
  | 'remind'
  | 'good'
  | 'muted'
  | 'repeat'
  | 'repeat-now';

export interface ChipInfo {
  label: string;
  tone: ChipTone;
  icon?: 'bell' | 'check' | 'repeat';
}

/** What the little badge on a note says, and how loud it is. Small squares get shorter wording. */
export function chipFor(note: Note, now: Date, opts: { compact?: boolean } = {}): ChipInfo | null {
  if (note.done) return null;
  const compact = opts.compact ?? false;
  const routine = repeatStatus(note, now);
  if (routine) return routineChip(routine, compact);
  const w = noteWhen(note);
  // An upcoming interview reminder says more than "Interview".
  const interviewSoon = note.stage === 'Interview' && w && !isPast(w.when, now);
  if (note.stage && isFinishedStage(note) && !interviewSoon) {
    return note.stage === 'Declined'
      ? { label: 'Declined', tone: 'muted' }
      : { label: stageLabel(note.stage, note.appType), tone: 'good', icon: 'check' };
  }
  if (!w) return null;
  if (w.kind === 'remind') {
    return isPast(w.when, now)
      ? { label: 'Went off', tone: 'muted', icon: 'bell' }
      : { label: compact ? shortReminder(w.when, now) : reminderLabel(w.when, now), tone: 'remind', icon: 'bell' };
  }
  return { label: compact ? shortCountdown(w.when, now) : countdownLabel(w.when, now), tone: urgencyOf(w.when, now) };
}

/** "3 PM" (today), "Thu 10 AM", "Oct 12". */
function shortReminder(when: When, now: Date): string {
  const days = daysUntil(when, now);
  const time = when.allDay ? '' : timeLabel(when.date);
  if (days === 0) return time || 'Today';
  if (days > 0 && days < 7) return [format(when.date, 'EEE'), time].filter(Boolean).join(' ');
  return format(when.date, 'MMM d');
}

/** "2 days late", "Tomorrow", "Today 5 PM", "3 days". */
function shortCountdown(when: When, now: Date): string {
  const days = daysUntil(when, now);
  if (isPast(when, now)) return days >= 0 ? 'Overdue' : `${-days} ${days === -1 ? 'day' : 'days'} late`;
  if (days === 1) return 'Tomorrow';
  return countdownLabel(when, now);
}

/** Recurring tasks never shout like deadlines: "Today", "Next: Fri", "2 more this week", "Done this week". */
function routineChip(status: RepeatStatus, compact: boolean): ChipInfo {
  const { every, done, target } = status;
  if (status.complete) {
    const label = compact ? 'Done' : every === 'day' ? 'Done today' : every === 'week' ? 'Done this week' : 'Done this month';
    return { label, tone: 'good', icon: 'check' };
  }
  if (every === 'day') return { label: 'Today', tone: 'repeat-now', icon: 'repeat' };
  if (status.nextDay) {
    return status.scheduledToday && !status.doneToday
      ? { label: 'Today', tone: 'repeat-now', icon: 'repeat' }
      : { label: `Next: ${format(status.nextDay, 'EEE')}`, tone: 'repeat', icon: 'repeat' };
  }
  const period = every === 'week' ? 'this week' : 'this month';
  const more = compact ? `${target - done} more` : `${target - done} more ${period}`;
  const label = target === 1 ? (every === 'week' ? 'This week' : 'This month') : more;
  return { label, tone: 'repeat', icon: 'repeat' };
}

/** Small, stable tilt per note so the wall looks hand-placed without jumping around. */
export function tiltFor(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return ((Math.abs(hash) % 31) - 15) / 10; // -1.5° … 1.5°
}
