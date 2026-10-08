import { addDays, addHours, addMinutes, format, isValid, set } from 'date-fns';

// What you can text the board (through iMessage), in plain words:
//   done                  finishes the sticky it just reminded you about (or "done NSF")
//   snooze 1h             reminds you again later: 10m, 2 hours, tonight, tomorrow, friday
//   add call NSF friday   adds a to-do, with a deadline when the end says when
//   today                 what's due today
//   help                  these
// Anything else gets "I didn't get that", with the list.

export type TextCommand =
  | { type: 'done'; what?: string }
  | { type: 'snooze'; until: Date; label: string; what?: string }
  | { type: 'add'; title: string; due?: string }
  | { type: 'today' }
  | { type: 'help' }
  | { type: 'unknown' };

/** What a snoozed or texted-in reminder means by "tomorrow", "friday": this time of day. */
const MORNING = { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 };
const EVENING = { hours: 20, minutes: 0, seconds: 0, milliseconds: 0 };

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export const HELP_TEXT = [
  'You can text:',
  '• done (or done NSF) to finish a sticky',
  '• snooze 1h (or 10m, tonight, tomorrow, friday)',
  '• add call NSF friday to add a to-do',
  '• today for what’s due today',
].join('\n');

/** A weekday from "fri", "friday", "fri." (0 = Sunday), or -1. */
function weekdayOf(word: string): number {
  const w = word.replace(/\.$/, '');
  if (w.length < 3) return -1;
  return WEEKDAYS.findIndex(day => day.startsWith(w));
}

/** The next day with this weekday: today if `today` allows it, else the coming one. */
function nextWeekday(now: Date, weekday: number, todayCounts: boolean): Date {
  let ahead = (weekday - now.getDay() + 7) % 7;
  if (ahead === 0 && !todayCounts) ahead = 7;
  return addDays(now, ahead);
}

/** A date (no time) from the end of a to-do: "today", "tomorrow", "fri", "next friday", "oct 14", "10/14", "2026-10-14". */
function dateAtEnd(words: string[], now: Date): { date: Date; used: number } | null {
  const n = words.length;
  const last = words[n - 1] ?? '';
  const before = words[n - 2] ?? '';
  if (last === 'today' || last === 'tonight') return { date: now, used: 1 };
  if (last === 'tomorrow' || last === 'tmrw' || last === 'tmr') return { date: addDays(now, 1), used: 1 };
  const weekday = weekdayOf(last);
  if (weekday >= 0) {
    // "friday" on a Friday is today; "next friday" is a week on.
    return before === 'next' ? { date: nextWeekday(now, weekday, false), used: 2 } : { date: nextWeekday(now, weekday, true), used: 1 };
  }
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(last);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return isValid(date) && date.getDate() === Number(match[3]) ? { date, used: 1 } : null;
  }
  match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(last);
  if (match) return monthDay(now, Number(match[1]) - 1, Number(match[2]), match[3], 1);
  const month = MONTHS.indexOf(before.slice(0, 3));
  if (month >= 0 && /^\d{1,2}(st|nd|rd|th)?$/.test(last)) return monthDay(now, month, parseInt(last, 10), undefined, 2);
  return null;
}

/** A month and day: this year, or next year once it's passed. */
function monthDay(now: Date, month: number, day: number, year: string | undefined, used: number): { date: Date; used: number } | null {
  const fullYear = year ? (year.length === 2 ? 2000 + Number(year) : Number(year)) : now.getFullYear();
  let date = new Date(fullYear, month, day);
  if (!isValid(date) || date.getMonth() !== month || date.getDate() !== day) return null;
  if (!year && date < set(now, { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 })) date = new Date(fullYear + 1, month, day);
  return { date, used };
}

/** When to snooze until, from "10m", "10 min", "2 hours", "an hour", "tonight", "tomorrow", "friday". */
function snoozeUntil(words: string[], now: Date): { until: Date; label: string; used: number } | null {
  const [first = '', second = ''] = words;
  const amount = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/.exec(first);
  if (amount) {
    const value = Number(amount[1]);
    const unit = amount[2] || second;
    const used = amount[2] ? 1 : 2;
    if (/^(m|min|mins|minute|minutes)$/.test(unit) && value > 0 && value <= 24 * 60) return { until: addMinutes(now, value), label: `${value} min`, used };
    if (/^(h|hr|hrs|hour|hours)$/.test(unit) && value > 0 && value <= 72) return { until: addMinutes(now, Math.round(value * 60)), label: `${value} ${value === 1 ? 'hour' : 'hours'}`, used };
    return null;
  }
  if ((first === 'an' || first === 'a') && /^(hour|hr)$/.test(second)) return { until: addHours(now, 1), label: '1 hour', used: 2 };
  if (first === 'tonight') {
    const evening = set(now, EVENING);
    return { until: evening > now ? evening : addHours(now, 1), label: 'tonight', used: 1 };
  }
  if (first === 'tomorrow' || first === 'tmrw' || first === 'tmr') return { until: set(addDays(now, 1), MORNING), label: 'tomorrow', used: 1 };
  const weekday = weekdayOf(first);
  if (weekday >= 0) return { until: set(nextWeekday(now, weekday, false), MORNING), label: format(nextWeekday(now, weekday, false), 'EEEE'), used: 1 };
  return null;
}

/** Reads a text. `now` is the board's time, for "tomorrow" and "friday". */
export function parseTextCommand(text: string, now: Date): TextCommand {
  const clean = text
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ');
  const lower = clean.toLowerCase();
  const words = lower.split(' ').filter(Boolean);
  const [verb = '', ...rest] = words;

  if (['help', 'commands', 'menu'].includes(lower) || text.trim() === '?') return { type: 'help' };
  if (['today', "what's due", 'what’s due', 'whats due', 'due', 'agenda', 'due today'].includes(lower)) return { type: 'today' };

  if (['done', 'did it', 'finished', 'complete', 'completed', '✅', '👍'].includes(lower)) return { type: 'done' };
  if (verb === 'done' || verb === 'finished') return { type: 'done', what: clean.slice(verb.length).trim() };

  if (verb === 'snooze' || verb === 'later' || verb === 'remind') {
    // "remind me in 1h", "snooze for 2 hours", "later"
    let after = rest;
    if (after[0] === 'me') after = after.slice(1);
    if (after[0] === 'in' || after[0] === 'for' || after[0] === 'until') after = after.slice(1);
    if (!after.length) return { type: 'snooze', until: addHours(now, 1), label: '1 hour' };
    const when = snoozeUntil(after, now);
    if (when) {
      const what = after.slice(when.used).join(' ').trim();
      return { type: 'snooze', until: when.until, label: when.label, ...(what ? { what } : {}) };
    }
    return { type: 'unknown' };
  }

  if (verb === 'add' || verb === 'todo' || verb === 'to-do') {
    const original = clean.split(' ').slice(1);
    if (!original.length) return { type: 'unknown' };
    const found = dateAtEnd(rest, now);
    let titleWords = original;
    let due: string | undefined;
    if (found && found.used < original.length) {
      titleWords = original.slice(0, original.length - found.used);
      due = format(found.date, 'yyyy-MM-dd');
      // "add call NSF by friday", "… on friday", "… due friday"
      const tail = titleWords[titleWords.length - 1]?.toLowerCase();
      if (titleWords.length > 1 && (tail === 'by' || tail === 'on' || tail === 'due')) titleWords = titleWords.slice(0, -1);
    }
    const title = titleWords.join(' ');
    return { type: 'add', title: title.charAt(0).toUpperCase() + title.slice(1), ...(due ? { due } : {}) };
  }

  return { type: 'unknown' };
}
