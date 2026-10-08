import { format, parseISO } from 'date-fns';
import { inTimeWindow, timeLabel } from './dates.ts';
import { CHANNEL_INFO } from './messages.ts';
import type { Note, Settings } from './types.ts';

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
