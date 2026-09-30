import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A parsed deadline or reminder time. All-day values are local calendar dates. */
export interface When {
  date: Date;
  allDay: boolean;
}

export type Urgency = 'overdue' | 'today' | 'soon' | 'week' | 'later';

/**
 * Parse a stored `due` / `remindAt` value. `YYYY-MM-DD` becomes local midnight
 * (never `new Date("2026-10-03")`, which is UTC and shows a day early in the Americas).
 */
export function parseWhen(value: string | undefined): When | null {
  if (!value) return null;
  const date = parseISO(value);
  if (!isValid(date)) return null;
  return { date, allDay: DATE_ONLY.test(value) };
}

export function daysUntil(when: When, now: Date): number {
  return differenceInCalendarDays(when.date, now);
}

export function isPast(when: When, now: Date): boolean {
  return when.allDay ? daysUntil(when, now) < 0 : when.date.getTime() < now.getTime();
}

export function urgencyOf(when: When, now: Date): Urgency {
  if (isPast(when, now)) return 'overdue';
  const days = daysUntil(when, now);
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  if (days <= 7) return 'week';
  return 'later';
}

/** "5 PM" or "5:30 PM". */
export function timeLabel(date: Date): string {
  return format(date, date.getMinutes() === 0 ? 'h a' : 'h:mm a');
}

/** Countdown for chips: "Today 5 PM", "Tomorrow", "3 days", "2 days overdue". */
export function countdownLabel(when: When, now: Date): string {
  const days = daysUntil(when, now);
  const time = when.allDay ? '' : ` ${timeLabel(when.date)}`;
  if (isPast(when, now)) {
    if (days >= 0) return 'Overdue';
    return days === -1 ? '1 day overdue' : `${-days} days overdue`;
  }
  if (days === 0) return `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  if (days < 100) return `${days} days`;
  return format(when.date, 'MMM d');
}

/** "Fri, Oct 3" or "Fri, Oct 3 · 5 PM". */
export function dateLabel(when: When, opts: { weekday?: boolean } = {}): string {
  const base = format(when.date, opts.weekday === false ? 'MMM d' : 'EEE, MMM d');
  return when.allDay ? base : `${base} · ${timeLabel(when.date)}`;
}

function minutesOf(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** True when `now` falls inside a daily window such as 22:00–07:00 (may cross midnight). */
export function inTimeWindow(now: Date, start: string, end: string): boolean {
  const t = now.getHours() * 60 + now.getMinutes();
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

export interface CalendarDay {
  date: Date;
  key: string;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
}

/** Local calendar key for a date, e.g. "2026-10-03". */
export function dayKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/** Weeks (Sunday first) covering the month that contains `month`. */
export function monthGrid(month: Date, now: Date): CalendarDay[][] {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month)),
    end: endOfWeek(endOfMonth(month)),
  }).map(date => ({
    date,
    key: dayKey(date),
    inMonth: isSameMonth(date, month),
    isToday: isSameDay(date, now),
    isPast: differenceInCalendarDays(date, now) < 0,
  }));
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** Build a stored value from the editor's date input and optional time input. */
export function composeWhen(date: string, time: string): string | undefined {
  if (!date) return undefined;
  if (!time) return date;
  const local = parseISO(`${date}T${time}`);
  return isValid(local) ? local.toISOString() : date;
}

/** Split a stored value back into local date / time input values. */
export function splitWhen(value: string | undefined): { date: string; time: string } {
  const when = parseWhen(value);
  if (!when) return { date: '', time: '' };
  return {
    date: format(when.date, 'yyyy-MM-dd'),
    time: when.allDay ? '' : format(when.date, 'HH:mm'),
  };
}

/** Reminder times read as clock times: "Today 3:30 PM", "Tomorrow 10 AM", "Fri 3:30 PM", "Oct 12 5 PM". */
export function reminderLabel(when: When, now: Date): string {
  const days = daysUntil(when, now);
  const time = when.allDay ? '' : ` ${timeLabel(when.date)}`;
  if (days === 0) return `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  if (days > 1 && days < 7) return `${format(when.date, 'EEE')}${time}`;
  return `${format(when.date, 'MMM d')}${time}`;
}

/** `weeks` weeks starting with the week that contains `now` (Sunday first). */
export function rollingWeeks(now: Date, weeks: number): CalendarDay[][] {
  const start = startOfWeek(now);
  const days = eachDayOfInterval({ start, end: addDays(start, weeks * 7 - 1) }).map(date => ({
    date,
    key: dayKey(date),
    inMonth: isSameMonth(date, now),
    isToday: isSameDay(date, now),
    isPast: differenceInCalendarDays(date, now) < 0,
  }));
  const rows: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  return rows;
}
