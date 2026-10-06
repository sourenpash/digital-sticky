import { addDays, differenceInCalendarDays, format, parseISO, set } from 'date-fns';
import { timeLabel } from './dates.ts';
import type { AiTask, Note } from './types.ts';

// Handing a sticky to the AI helper: what it should do and how often. The helper
// itself runs on the wall computer (checkpoint 7); these are the settings and wording.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clockOn(day: Date, time: string): Date {
  const [hours = 8, minutes = 0] = time.split(':').map(Number);
  return set(day, { hours, minutes, seconds: 0, milliseconds: 0 });
}

/** Starting settings: the sticky's own words, and its rhythm if it repeats. */
export function defaultAiTask(note: Pick<Note, 'title' | 'body' | 'repeat'>): AiTask {
  const instructions = [note.title.trim(), note.body.trim()].filter(Boolean).join('\n\n');
  const weekly = note.repeat !== undefined && note.repeat.every !== 'day';
  return {
    instructions,
    schedule: note.repeat ? (weekly ? 'weekly' : 'daily') : 'once',
    time: '08:00',
    ...(weekly ? { weekday: note.repeat?.days?.[0] ?? 1 } : {}),
    mayAdd: true,
    mayEdit: false,
  };
}

/** "Every day at 8 AM", "Every Monday at 8 AM", "Once, at 8 AM". */
export function describeAiSchedule(ai: AiTask): string {
  const time = timeLabel(clockOn(new Date(2026, 0, 1), ai.time));
  if (ai.schedule === 'daily') return `Every day at ${time}`;
  if (ai.schedule === 'weekly') return `Every ${WEEKDAYS[ai.weekday ?? 1]} at ${time}`;
  return `Once, at ${time}`;
}

/** When the helper next looks at this sticky: null once a one-time task has run. */
export function nextAiRun(ai: AiTask, lastRunAt: string | undefined, now: Date): Date | null {
  if (ai.schedule === 'once' && lastRunAt) return null;
  let at = clockOn(now, ai.time);
  if (ai.schedule === 'weekly') {
    const ahead = ((ai.weekday ?? 1) - now.getDay() + 7) % 7;
    at = addDays(at, ahead);
    if (at.getTime() <= now.getTime()) at = addDays(at, 7);
    return at;
  }
  return at.getTime() <= now.getTime() ? addDays(at, 1) : at;
}

/** "8 AM" today, "Mon 8 AM" this week, "Oct 1" before that. */
export function whenLabel(date: Date, now: Date): string {
  const days = differenceInCalendarDays(now, date);
  if (days === 0) return timeLabel(date);
  if (days > 0 && days < 7) return `${format(date, 'EEE')} ${timeLabel(date)}`;
  return format(date, 'MMM d');
}

/** The small print at the top of a sticky handed to the AI: "AI · checked 8 AM". */
export function aiKicker(note: Pick<Note, 'ai' | 'aiLog' | 'aiState'>, now: Date): string | undefined {
  if (!note.ai) return undefined;
  if (note.aiState?.status === 'running') return 'AI · checking now';
  const last = note.aiLog?.[0];
  if (last) return `AI · checked ${whenLabel(parseISO(last.at), now)}`;
  if (note.ai.schedule === 'daily') return `AI · daily ${timeLabel(clockOn(now, note.ai.time))}`;
  if (note.ai.schedule === 'weekly') return `AI · ${WEEKDAYS[note.ai.weekday ?? 1]}s`;
  return 'AI helper';
}
