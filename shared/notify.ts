import { addDays, format, isValid, parseISO } from 'date-fns';
import { inTimeWindow, timeLabel } from './dates.ts';
import { latestNudge } from './followups.ts';
import { CHANNEL_INFO } from './messages.ts';
import type { Board, Note, Settings } from './types.ts';

// What a reminder says away from the wall, in a notification on a phone or a text: the
// same words as the wall's banner.

/** True while the wall is in night mode. */
export function isNightTime(settings: Pick<Settings, 'night'>, now: Date): boolean {
  const { mode, start, end } = settings.night;
  return mode === 'on' || (mode === 'auto' && inTimeWindow(now, start, end));
}

/** "Follow up · submitted Oct 6", "Follow up · sent Oct 6". */
export function followUpKicker(note: Pick<Note, 'sentAt' | 'channel'> | undefined): string {
  if (!note?.sentAt) return 'Time to follow up';
  const word = note.channel ? CHANNEL_INFO[note.channel].sentWord : 'Submitted';
  return `Follow up · ${word.toLowerCase()} ${format(parseISO(note.sentAt), 'MMM d')}`;
}

/** A reminder (or a nudge to follow up) for a phone. */
export interface Notice {
  /** "Reminder · 2 PM", "Follow up · sent Oct 6". */
  title: string;
  /** The sticky's title. */
  body: string;
  /** Where a tap opens the app (a route, like "#note-abc"). */
  url: string;
  /** Notifications with the same tag replace each other. */
  tag: string;
}

export function reminderNotice(note: Pick<Note, 'id' | 'title' | 'remindAt' | 'sentAt' | 'channel'>, kind: 'follow' | undefined, tag: string, firedAt: Date): Notice {
  const time = timeLabel(note.remindAt ? parseISO(note.remindAt) : firedAt);
  return {
    title: kind === 'follow' ? followUpKicker(note) : `Reminder · ${time}`,
    body: note.title.trim() || 'Untitled note',
    url: `#note-${note.id}`,
    tag,
  };
}

/** A notification the iPhone app sets for later, so it goes off even with no connection. */
export interface UpcomingNotice extends Notice {
  /** When it goes off (ISO). */
  at: string;
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * The reminders and follow-up nudges coming up, soonest first, for the iPhone app to set
 * as notifications on the phone. The same ones the wall would send, so none fall in
 * night mode while that's quiet. The app asks again whenever the board changes.
 */
export function upcomingNotices(board: Pick<Board, 'notes' | 'settings'>, now: Date, { days = 14, max = 60 } = {}): UpcomingNotice[] {
  const from = now.getTime();
  const until = from + days * DAY_MS;
  const quiet = board.settings.notify.quietAtNight;
  const notices: UpcomingNotice[] = [];
  const add = (note: Note, kind: 'follow' | undefined, at: Date) => {
    const time = at.getTime();
    if (time <= from || time > until || (quiet && isNightTime(board.settings, at))) return;
    const iso = at.toISOString();
    notices.push({ ...reminderNotice(note, kind, `${note.id}:${kind ?? 'remind'}:${iso}`, at), at: iso });
  };
  for (const note of board.notes) {
    if (note.done) continue;
    if (note.remindAt) add(note, undefined, parseISO(note.remindAt));
    const followUp = note.followUp;
    if (!followUp || !isValid(parseISO(followUp.at))) continue;
    // The next nudge, and the ones after it in case nobody gets to it.
    let at = latestNudge(followUp, now) ?? parseISO(followUp.at);
    for (let i = 0; i < 20 && at.getTime() <= until; i++) {
      add(note, 'follow', at);
      if (followUp.everyDays <= 0) break;
      at = addDays(at, followUp.everyDays);
    }
  }
  return notices.sort((a, b) => a.at.localeCompare(b.at)).slice(0, max);
}
