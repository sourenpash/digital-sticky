import { addDays, addMinutes, differenceInCalendarDays, differenceInMinutes, endOfDay, format, isSameDay, startOfDay } from 'date-fns';
import { composeWhen, dayKey, parseWhen, splitWhen, timeLabel, type When } from './dates.ts';
import type { Note } from './types.ts';

// When something happens, for the calendar: an appointment from 2:30 to 3:30 PM, or a
// conference from Nov 18 to 20. A sticky's `start` and `end` are `YYYY-MM-DD` (all day,
// the end day included) or ISO date-times, like `due`. The end is optional.

export interface Span {
  start: When;
  /** Null when there's no end (or it doesn't fit: before the start, or one all-day and the other not). */
  end: When | null;
}

/** Days a span is shown on at most, so a typo like 2062 doesn't fill the calendar. */
const MAX_DAYS = 62;

/** The sticky's span, or null when it has no start. */
export function noteSpan(note: Pick<Note, 'start' | 'end'>): Span | null {
  const start = parseWhen(note.start);
  if (!start) return null;
  const end = parseWhen(note.end);
  if (!end || end.allDay !== start.allDay) return { start, end: null };
  const fits = start.allDay ? differenceInCalendarDays(end.date, start.date) >= 0 : end.date.getTime() > start.date.getTime();
  return { start, end: fits ? end : null };
}

/** When it's over: the end of its last day when it's all day, otherwise its end (or start). */
export function spanEnd(span: Span): Date {
  if (span.start.allDay) return endOfDay((span.end ?? span.start).date);
  return (span.end ?? span.start).date;
}

export function spanOver(span: Span, now: Date): boolean {
  return spanEnd(span).getTime() < now.getTime();
}

/** Started, and not over yet. */
export function spanNow(span: Span, now: Date): boolean {
  const started = span.start.allDay ? differenceInCalendarDays(now, span.start.date) >= 0 : span.start.date.getTime() <= now.getTime();
  return started && !spanOver(span, now);
}

/** More than one calendar day. */
export function multiDay(span: Span): boolean {
  return span.end !== null && !isSameDay(span.start.date, span.end.date);
}

/** The days it covers ("2026-11-18", …). A timed one that ends at midnight doesn't cover the next day. */
export function spanDays(span: Span): string[] {
  const first = startOfDay(span.start.date);
  const lastMoment = span.start.allDay || !span.end ? spanEnd(span) : addMinutes(span.end.date, -1);
  const count = Math.min(MAX_DAYS, Math.max(1, differenceInCalendarDays(lastMoment, first) + 1));
  return Array.from({ length: count }, (_, i) => dayKey(addDays(first, i)));
}

/** "2:30 – 3:30 PM", "11 AM – 1 PM", "2:30 PM". */
function timeRange(from: Date, to: Date | null): string {
  if (!to) return timeLabel(from);
  const sameHalf = format(from, 'a') === format(to, 'a');
  const short = (d: Date) => format(d, d.getMinutes() === 0 ? 'h' : 'h:mm');
  return sameHalf ? `${short(from)} – ${timeLabel(to)}` : `${timeLabel(from)} – ${timeLabel(to)}`;
}

/** "Nov 18 – 20", "Nov 30 – Dec 2". */
function dayRange(from: Date, to: Date): string {
  return `${format(from, 'MMM d')} – ${format(to, from.getMonth() === to.getMonth() ? 'd' : 'MMM d')}`;
}

/**
 * The whole span in words: "All day", "2:30 – 3:30 PM", "Nov 18 – 20",
 * "Nov 18, 9 AM – Nov 20, 5 PM". With `date`, single days say which: "Tue, Nov 18 · 2:30 – 3:30 PM".
 */
export function spanLabel(span: Span, opts: { date?: boolean } = {}): string {
  const { start, end } = span;
  if (multiDay(span)) {
    if (start.allDay) return dayRange(start.date, end!.date);
    return `${format(start.date, 'MMM d')}, ${timeLabel(start.date)} – ${format(end!.date, 'MMM d')}, ${timeLabel(end!.date)}`;
  }
  const time = start.allDay ? 'All day' : timeRange(start.date, end?.date ?? null);
  return opts.date ? `${format(start.date, 'EEE, MMM d')} · ${time}` : time;
}

/**
 * What a calendar day shows for it, kept short: the times on a single day, the start
 * time on the first of several days, "until 5 PM" on the last, "until Nov 20" for days
 * of an all-day one. Null when there's nothing to say beyond the title.
 */
export function spanOnDay(span: Span, day: Date): string | null {
  const { start, end } = span;
  if (!multiDay(span)) return start.allDay ? null : timeRange(start.date, end?.date ?? null);
  if (start.allDay) return isSameDay(day, end!.date) ? 'last day' : `until ${format(end!.date, 'MMM d')}`;
  if (isSameDay(day, start.date)) return `from ${timeLabel(start.date)}`;
  if (isSameDay(day, end!.date)) return `until ${timeLabel(end!.date)}`;
  return 'all day';
}

// ---- Editing ----

/**
 * The fields after the start moves to `start`: the end moves with it, keeping the same
 * length, and goes when there's no start, or when one is all day and the other isn't.
 */
export function moveStart(note: Pick<Note, 'start' | 'end'>, start: string | undefined): Pick<Note, 'start' | 'end'> {
  const before = noteSpan(note);
  const next = parseWhen(start);
  if (!next) return { start: undefined, end: undefined };
  if (!before?.end || before.start.allDay !== next.allDay) return { start, end: undefined };
  if (next.allDay) {
    const days = differenceInCalendarDays(before.end.date, before.start.date);
    return { start, end: dayKey(addDays(next.date, days)) };
  }
  return { start, end: addMinutes(next.date, differenceInMinutes(before.end.date, before.start.date)).toISOString() };
}

/**
 * The end, from the editor's date and time boxes. An all-day span ends on a day; a
 * timed one at a time (on the start's day when no day is picked, and at the start's
 * time on another day when only the day is). An end before the start is kept while
 * it's being typed; `noteSpan` leaves it out, and the editor says so.
 */
export function composeEnd(start: string | undefined, date: string, time: string): string | undefined {
  const from = parseWhen(start);
  if (!from) return undefined;
  if (from.allDay) return date || undefined;
  if (!date && !time) return undefined;
  const startParts = splitWhen(start);
  return composeWhen(date || startParts.date, time || startParts.time);
}

/** The end `minutes` after a timed start (for "1 hour" and the like). */
export function endAfter(start: string | undefined, minutes: number): string | undefined {
  const from = parseWhen(start);
  return from && !from.allDay ? addMinutes(from.date, minutes).toISOString() : undefined;
}
