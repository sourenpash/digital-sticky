import { addDays, addMonths, addWeeks, getDay, isSameDay, isValid, parseISO, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import type { Note, Repeat, RepeatEvery } from './types.ts';

// Recurring tasks have no deadline. Each "Did it" is logged with a time, and the
// task counts how many times it was done in the current day, week or month.
// Weeks start on Sunday, like the calendars.

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function periodStart(every: RepeatEvery, now: Date): Date {
  if (every === 'day') return startOfDay(now);
  if (every === 'week') return startOfWeek(now);
  return startOfMonth(now);
}

export function nextPeriodStart(every: RepeatEvery, now: Date): Date {
  const start = periodStart(every, now);
  if (every === 'day') return addDays(start, 1);
  if (every === 'week') return addWeeks(start, 1);
  return addMonths(start, 1);
}

/** How many times per period the task should be done. */
export function repeatTarget(repeat: Repeat): number {
  if (repeat.every === 'day') return 1;
  if (repeat.every === 'week' && repeat.days?.length) return repeat.days.length;
  return Math.max(1, Math.round(repeat.times));
}

function completionDates(note: Note, now: Date): Date[] {
  return (note.completions ?? [])
    .map(iso => parseISO(iso))
    .filter(date => isValid(date) && date.getTime() <= now.getTime());
}

export interface RepeatStatus {
  every: RepeatEvery;
  /** Times done so far in the current day, week or month. */
  done: number;
  target: number;
  /** Done enough for now; the task comes back when the next period starts. */
  complete: boolean;
  doneToday: boolean;
  /** Weekly tasks with set days: today is one of them. */
  scheduledToday: boolean;
  /** Weekly tasks with set days: the next day it's due (today, if not done yet). */
  nextDay?: Date;
}

export function repeatStatus(note: Note, now: Date): RepeatStatus | null {
  const repeat = note.repeat;
  if (!repeat) return null;
  const start = periodStart(repeat.every, now).getTime();
  const dates = completionDates(note, now);
  const done = dates.filter(date => date.getTime() >= start).length;
  const target = repeatTarget(repeat);
  const doneToday = dates.some(date => isSameDay(date, now));
  const days = repeat.every === 'week' ? (repeat.days ?? []) : [];
  const scheduledToday = days.includes(getDay(now));

  let nextDay: Date | undefined;
  for (let offset = scheduledToday && !doneToday ? 0 : 1; days.length > 0 && offset <= 7; offset++) {
    const day = addDays(startOfDay(now), offset);
    if (days.includes(getDay(day))) {
      nextDay = day;
      break;
    }
  }

  return { every: repeat.every, done, target, complete: done >= target, doneToday, scheduledToday, nextDay };
}

/** Done for this day, week or month: it shows faded until the next one starts. */
export function isRested(note: Note, now: Date): boolean {
  return repeatStatus(note, now)?.complete ?? false;
}

/** "Every day", "Once a week", "3 times a week", "Every Monday", "Every Mon and Fri". */
export function describeRepeat(repeat: Repeat): string {
  if (repeat.every === 'day') return 'Every day';
  const days = repeat.every === 'week' ? [...(repeat.days ?? [])].sort((a, b) => a - b) : [];
  if (days.length === 7) return 'Every day of the week';
  if (days.join() === '1,2,3,4,5') return 'Every weekday';
  if (days.length === 1) return `Every ${WEEKDAY_NAMES[days[0] ?? 0]}`;
  if (days.length > 1) {
    const names = days.map(d => WEEKDAY_SHORT[d] ?? '');
    return `Every ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  const times = repeatTarget(repeat);
  if (times === 1) return `Once a ${repeat.every}`;
  if (times === 2) return `Twice a ${repeat.every}`;
  return `${times} times a ${repeat.every}`;
}

export interface WeekDot {
  date: Date;
  done: boolean;
  isToday: boolean;
  isFuture: boolean;
  /** Weekly tasks with set days: one of those days. */
  scheduled: boolean;
}

/** The current week, Sunday first, and whether the task was done on each day. */
export function weekDots(note: Note, now: Date): WeekDot[] {
  const dates = completionDates(note, now);
  const days = note.repeat?.every === 'week' ? (note.repeat.days ?? []) : [];
  const start = startOfWeek(now);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return {
      date,
      done: dates.some(d => isSameDay(d, date)),
      isToday: isSameDay(date, now),
      isFuture: date.getTime() > now.getTime() && !isSameDay(date, now),
      scheduled: days.includes(i),
    };
  });
}

/** Completions older than two months are dropped so the list stays short. */
export function pruneCompletions(completions: string[], now: Date): string[] {
  const cutoff = addMonths(now, -2).getTime();
  return completions.filter(iso => {
    const date = parseISO(iso);
    return isValid(date) && date.getTime() >= cutoff;
  });
}
