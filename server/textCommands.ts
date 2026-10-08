import { differenceInCalendarDays, format, isSameDay, parseISO } from 'date-fns';
import { deadlineDone, lanesInOrder } from '../shared/board.ts';
import { timeLabel } from '../shared/dates.ts';
import { followUpDue } from '../shared/followups.ts';
import { HELP_TEXT, type TextCommand } from '../shared/textCommands.ts';
import type { Board, Note } from '../shared/types.ts';
import { newId, type BoardStore } from './store.ts';

// Carrying out what someone texted the board (see shared/textCommands.ts), and the reply.
// Every change is an ordinary change to the board: it shows on the wall straight away,
// and can be changed back in the app.

/** The sticky the board last texted this person about, which "done" and "snooze" mean. */
export interface LastReminded {
  noteId: string;
  kind?: 'follow';
}

const MAX_TODAY_LINES = 8;

/** "8:42 PM" today, "tomorrow 9 AM", "Fri Oct 2, 9 AM". */
function whenWords(date: Date, now: Date): string {
  const days = differenceInCalendarDays(date, now);
  if (days === 0) return timeLabel(date);
  if (days === 1) return `tomorrow ${timeLabel(date)}`;
  return `${format(date, 'EEE MMM d')}, ${timeLabel(date)}`;
}

const quote = (note: Note) => `“${note.title.trim() || 'Untitled note'}”`;

/** The sticky someone means by a few words of its name: an exact title first, then one containing them. */
function findSticky(board: Board, words: string): Note | undefined {
  const wanted = words.trim().toLowerCase();
  if (!wanted) return undefined;
  const open = board.notes.filter(note => !note.done);
  return open.find(note => note.title.trim().toLowerCase() === wanted) ?? open.find(note => note.title.toLowerCase().includes(wanted));
}

/** What's due today, one line each: overdue deadlines and today's, today's reminders, and follow-ups. */
export function todayLines(board: Board, now: Date): string[] {
  const lines: Array<{ order: number; text: string }> = [];
  for (const note of board.notes) {
    if (note.done) continue;
    const title = note.title.trim() || 'Untitled note';
    if (note.followUp && followUpDue(note, now)) {
      lines.push({ order: 0, text: `• ${title} (follow up)` });
      continue;
    }
    if (note.due && !deadlineDone(note)) {
      const due = note.due.length === 10 ? parseISO(`${note.due}T23:59:59`) : parseISO(note.due);
      const days = differenceInCalendarDays(due, now);
      if (days < 0) {
        lines.push({ order: 1, text: `• ${title} (overdue)` });
        continue;
      }
      if (days === 0) {
        lines.push({ order: 2, text: `• ${title} (due today${note.due.length > 10 ? `, ${timeLabel(due)}` : ''})` });
        continue;
      }
    }
    if (note.remindAt) {
      const at = parseISO(note.remindAt);
      if (isSameDay(at, now)) lines.push({ order: 3, text: `• ${title} (${timeLabel(at)})` });
    }
  }
  lines.sort((a, b) => a.order - b.order);
  const shown = lines.slice(0, MAX_TODAY_LINES).map(line => line.text);
  if (lines.length > MAX_TODAY_LINES) shown.push(`…and ${lines.length - MAX_TODAY_LINES} more on the board`);
  return shown;
}

/** Carries out a texted command on the board, and says what happened. */
export function runTextCommand(command: TextCommand, store: BoardStore, last: LastReminded | undefined): string {
  const board = store.board;
  const now = store.now();
  const target = (what: string | undefined): Note | undefined => {
    if (what) return findSticky(board, what);
    const note = last ? board.notes.find(n => n.id === last.noteId) : undefined;
    return note && !note.done ? note : undefined;
  };

  switch (command.type) {
    case 'help':
      return HELP_TEXT;

    case 'today': {
      const lines = todayLines(board, now);
      return lines.length ? `Today:\n${lines.join('\n')}` : 'Nothing is due today.';
    }

    case 'done': {
      const note = target(command.what);
      if (!note) return command.what ? `I couldn’t find a sticky called “${command.what}”.` : 'Which one? Text done and a few words of its name, like done NSF.';
      if (note.repeat) {
        store.apply({ type: 'note.completions', id: note.id, add: [now.toISOString()] });
        return `Nice. Logged ${quote(note)}.`;
      }
      store.apply({ type: 'note.patch', id: note.id, patch: { done: true } });
      return `Done: ${quote(note)}. (To undo it, untick it in the app.)`;
    }

    case 'snooze': {
      const note = target(command.what);
      if (!note) return command.what ? `I couldn’t find a sticky called “${command.what}”.` : 'Which one? Text snooze and when, after a reminder.';
      const until = command.until.toISOString();
      const follow = note.followUp && (last?.noteId === note.id ? last.kind === 'follow' : !note.remindAt);
      if (follow && note.followUp) store.apply({ type: 'note.patch', id: note.id, patch: { followUp: { ...note.followUp, at: until } } });
      else store.apply({ type: 'note.patch', id: note.id, patch: { remindAt: until } });
      // It comes back later, so it comes down from the wall now.
      for (const alert of store.board.alerts.filter(a => a.noteId === note.id)) store.apply({ type: 'alert.dismiss', id: alert.id });
      return `Snoozed ${quote(note)} until ${whenWords(command.until, now)}.`;
    }

    case 'add': {
      const lanes = lanesInOrder(board.lanes);
      const lane = lanes.find(l => l.kind === 'task') ?? lanes[0]!;
      const stamp = now.toISOString();
      const note: Note = {
        id: newId(),
        laneId: lane.id,
        title: command.title.slice(0, 300),
        body: '',
        ...(command.due ? { due: command.due } : {}),
        checklist: [],
        links: [],
        pinned: false,
        done: false,
        createdAt: stamp,
        updatedAt: stamp,
      };
      store.apply({ type: 'note.add', note });
      const due = command.due ? `, due ${format(parseISO(command.due), 'EEE MMM d')}` : '';
      return `Added ${quote(note)} to ${lane.title}${due}.`;
    }

    default:
      return `I didn’t get that. ${HELP_TEXT}`;
  }
}
