import { isNudgeTime } from './followups.ts';
import { pruneCompletions } from './recurring.ts';
import { MAX_AI_LOG, type AiRun, type AiState, type Alert, type Board, type ChecklistItem, type Goal, type Lane, type Note, type ServerNoteField, type Settings, type SourceLink } from './types.ts';

// Every change to the board is one of these operations. The server applies them to
// the saved board, and phones and computers apply the same ones straight away
// (before the server answers) so taps feel instant. They are safe to apply twice.

type OptionalKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? K : never }[keyof T];

/** Changed fields only. Optional fields can be cleared with `null` (JSON has no `undefined`). */
export type Patch<T> = { [K in keyof T]?: K extends OptionalKeys<T> ? T[K] | null : T[K] };

export type NotePatch = Patch<Omit<Note, 'id' | 'createdAt' | 'updatedAt' | ServerNoteField>>;
export type LanePatch = Patch<Pick<Lane, 'title' | 'color' | 'kind'>>;
export type GoalPatch = Patch<Omit<Goal, 'id' | 'createdAt'>>;
export interface SettingsPatch {
  night?: Partial<Settings['night']>;
  wall?: Partial<Settings['wall']>;
  ticker?: Partial<Settings['ticker']>;
  ai?: Partial<Settings['ai']>;
  notify?: Partial<Settings['notify']>;
}

export type Op =
  | { type: 'note.add'; note: Note }
  | { type: 'note.patch'; id: string; patch: NotePatch }
  | { type: 'note.delete'; id: string }
  /** `note` is what the phone still holds; the server restores its own copy from the trash. */
  | { type: 'note.restore'; id: string; note?: Note }
  /** Recurring tasks: add or take back "Did it" times. */
  | { type: 'note.completions'; id: string; add?: string[]; remove?: string[] }
  | { type: 'lane.add'; lane: Lane }
  | { type: 'lane.patch'; id: string; patch: LanePatch }
  /** Deletes the column and the notes in it. */
  | { type: 'lane.delete'; id: string }
  | { type: 'lane.restore'; id: string; lane?: Lane; notes?: Note[] }
  | { type: 'lane.order'; ids: string[] }
  | { type: 'goal.add'; goal: Goal }
  | { type: 'goal.patch'; id: string; patch: GoalPatch }
  | { type: 'goal.delete'; id: string }
  | { type: 'goal.restore'; id: string; goal?: Goal }
  | { type: 'settings.patch'; patch: SettingsPatch }
  | { type: 'alert.fire'; id: string; noteId: string }
  | { type: 'alert.dismiss'; id: string };

/** A reminder (or follow-up nudge) whose time has come: marked as handled, and shown on the wall if `show`. */
export interface ReminderFire {
  noteId: string;
  /** The reminder time the server saw; skipped if the note's reminder has moved since. For a nudge, the nudge time. */
  remindAt: string;
  alertId: string;
  show: boolean;
  /** A nudge to follow up, rather than the note's reminder. */
  kind?: 'follow';
}

/** An AI's report on a sticky (see server/aiReport.ts, which checks it and builds this). */
export interface AiReport {
  noteId: string;
  run: AiRun;
  /** Stickies it found, as related tasks of this one. */
  add: Note[];
  /** The sticky's checklist and sources with its changes, when it may change them. */
  checklist?: ChecklistItem[];
  links?: SourceLink[];
}

/**
 * Changes only the server makes. Every 10 seconds it shows reminders and follow-up
 * nudges that are due and takes down ones that have been up long enough, as one change.
 * An AI reports back on a sticky, and the board notes what the AI helper is doing
 * (`ai.state`: null clears it).
 */
export type ServerOp =
  | Op
  | { type: 'reminders.tick'; fire: ReminderFire[]; expire: string[] }
  | ({ type: 'ai.report' } & AiReport)
  | { type: 'ai.state'; ids: string[]; state: AiState | null };

/** Applies a patch: `null` (or `undefined`) removes a field, anything else replaces it. */
export function applyPatch<T extends object>(target: T, patch: object): T {
  const out = { ...target } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete out[key];
    else out[key] = value;
  }
  return out as T;
}

export function patchNote(note: Note, patch: NotePatch, stamp: string): Note {
  const next = applyPatch(note, patch);
  if (patch.done === true && !note.done && !patch.doneAt) next.doneAt = stamp;
  if (patch.done === false) delete next.doneAt;
  next.updatedAt = stamp;
  return next;
}

function byTime(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b);
}

export function changeCompletions(note: Note, add: string[], remove: string[], now: Date): string[] {
  const drop = new Set(remove);
  const kept = [...(note.completions ?? []), ...add].filter(iso => !drop.has(iso));
  return pruneCompletions([...new Set(kept)].sort(byTime), now);
}

function withNote(board: Board, id: string, change: (note: Note) => Note): Board {
  let found = false;
  const notes = board.notes.map(note => {
    if (note.id !== id) return note;
    found = true;
    return change(note);
  });
  return found ? { ...board, notes } : board;
}

function withoutAlerts(alerts: Alert[], drop: (alert: Alert) => boolean): Alert[] {
  const kept = alerts.filter(alert => !drop(alert));
  return kept.length === alerts.length ? alerts : kept;
}

function withoutAlertsFor(alerts: Alert[], noteIds: Set<string>): Alert[] {
  return withoutAlerts(alerts, alert => noteIds.has(alert.noteId));
}

function definedOnly<T extends object>(patch: Partial<T> | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(patch ?? {}).filter(([, value]) => value !== undefined && value !== null)) as Partial<T>;
}

export function applyOp(board: Board, op: ServerOp, now: Date): Board {
  const stamp = now.toISOString();
  switch (op.type) {
    case 'note.add':
      if (board.notes.some(note => note.id === op.note.id)) return board;
      return { ...board, notes: [...board.notes, op.note] };

    case 'note.patch': {
      const next = withNote(board, op.id, note => patchNote(note, op.patch, stamp));
      if (next === board) return board;
      // A finished note has nothing left to remind about, and a follow-up that was
      // dealt with (moved on, or stopped) takes its nudge down.
      if (op.patch.done === true) return { ...next, alerts: withoutAlertsFor(next.alerts, new Set([op.id])) };
      if ('followUp' in op.patch) return { ...next, alerts: withoutAlerts(next.alerts, alert => alert.noteId === op.id && alert.kind === 'follow') };
      return next;
    }

    case 'note.delete':
      if (!board.notes.some(note => note.id === op.id)) return board;
      return {
        ...board,
        notes: board.notes.filter(note => note.id !== op.id),
        alerts: withoutAlertsFor(board.alerts, new Set([op.id])),
      };

    case 'note.restore':
      if (!op.note || board.notes.some(note => note.id === op.id)) return board;
      return { ...board, notes: [...board.notes, op.note] };

    case 'note.completions':
      return withNote(board, op.id, note => ({
        ...note,
        completions: changeCompletions(note, op.add ?? [], op.remove ?? [], now),
        updatedAt: stamp,
      }));

    case 'lane.add':
      if (board.lanes.some(lane => lane.id === op.lane.id)) return board;
      return { ...board, lanes: [...board.lanes, op.lane] };

    case 'lane.patch':
      if (!board.lanes.some(lane => lane.id === op.id)) return board;
      return { ...board, lanes: board.lanes.map(lane => (lane.id === op.id ? applyPatch(lane, op.patch) : lane)) };

    case 'lane.delete': {
      if (!board.lanes.some(lane => lane.id === op.id)) return board;
      const gone = new Set(board.notes.filter(note => note.laneId === op.id).map(note => note.id));
      return {
        ...board,
        lanes: board.lanes.filter(lane => lane.id !== op.id),
        notes: board.notes.filter(note => !gone.has(note.id)),
        alerts: withoutAlertsFor(board.alerts, gone),
      };
    }

    case 'lane.restore': {
      if (!op.lane || board.lanes.some(lane => lane.id === op.id)) return board;
      const have = new Set(board.notes.map(note => note.id));
      return {
        ...board,
        lanes: [...board.lanes, op.lane],
        notes: [...board.notes, ...(op.notes ?? []).filter(note => !have.has(note.id))],
      };
    }

    case 'lane.order': {
      const position = new Map(op.ids.map((id, index) => [id, index]));
      const place = (lane: Lane) => position.get(lane.id) ?? op.ids.length + lane.order;
      const sorted = [...board.lanes].sort((a, b) => place(a) - place(b) || a.order - b.order);
      return { ...board, lanes: sorted.map((lane, order) => (lane.order === order ? lane : { ...lane, order })) };
    }

    case 'goal.add':
      if (board.goals.some(goal => goal.id === op.goal.id)) return board;
      return { ...board, goals: [...board.goals, op.goal] };

    case 'goal.patch':
      if (!board.goals.some(goal => goal.id === op.id)) return board;
      return { ...board, goals: board.goals.map(goal => (goal.id === op.id ? applyPatch(goal, op.patch) : goal)) };

    case 'goal.delete':
      if (!board.goals.some(goal => goal.id === op.id)) return board;
      return { ...board, goals: board.goals.filter(goal => goal.id !== op.id) };

    case 'goal.restore':
      if (!op.goal || board.goals.some(goal => goal.id === op.id)) return board;
      return { ...board, goals: [...board.goals, op.goal] };

    case 'settings.patch':
      return {
        ...board,
        settings: {
          night: { ...board.settings.night, ...definedOnly(op.patch.night) },
          wall: { ...board.settings.wall, ...definedOnly(op.patch.wall) },
          ticker: { ...board.settings.ticker, ...definedOnly(op.patch.ticker) },
          ai: { ...board.settings.ai, ...definedOnly(op.patch.ai) },
          notify: { ...board.settings.notify, ...definedOnly(op.patch.notify) },
        },
      };

    case 'alert.fire': {
      const note = board.notes.find(n => n.id === op.noteId);
      if (!note || board.alerts.some(alert => alert.id === op.id || alert.noteId === op.noteId)) return board;
      return { ...board, alerts: [...board.alerts, { id: op.id, noteId: note.id, title: note.title, firedAt: stamp }] };
    }

    case 'alert.dismiss':
      if (!board.alerts.some(alert => alert.id === op.id)) return board;
      return { ...board, alerts: board.alerts.filter(alert => alert.id !== op.id) };

    case 'reminders.tick': {
      const expired = new Set(op.expire);
      let alerts = withoutAlerts(board.alerts, alert => expired.has(alert.id));
      let notes = board.notes;
      for (const item of op.fire) {
        const note = notes.find(n => n.id === item.noteId);
        if (!note) continue;
        if (item.kind === 'follow') {
          if (!note.followUp || !isNudgeTime(note.followUp, item.remindAt)) continue;
          notes = notes.map(n => (n === note ? { ...note, followedUpFor: item.remindAt } : n));
        } else {
          if (!note.remindAt || Date.parse(note.remindAt) !== Date.parse(item.remindAt)) continue;
          notes = notes.map(n => (n === note ? { ...note, remindedFor: item.remindAt } : n));
        }
        if (item.show && !note.done) {
          // A reminder already up for this note (from "Try it") makes way, so this one gets its full time.
          const alert: Alert = { id: item.alertId, noteId: note.id, title: note.title, firedAt: stamp, ...(item.kind ? { kind: item.kind } : {}) };
          alerts = [...withoutAlertsFor(alerts, new Set([note.id])), alert];
        }
      }
      return notes === board.notes && alerts === board.alerts ? board : { ...board, notes, alerts };
    }

    case 'ai.report': {
      const note = board.notes.find(n => n.id === op.noteId);
      // Already in (sent twice), or the sticky is gone.
      if (!note || note.aiLog?.some(run => run.id === op.run.id)) return board;
      const { aiState: _done, ...rest } = note;
      const reported: Note = {
        ...rest,
        aiLog: [op.run, ...(note.aiLog ?? [])].slice(0, MAX_AI_LOG),
        ...(op.checklist ? { checklist: op.checklist } : {}),
        ...(op.links ? { links: op.links } : {}),
        updatedAt: stamp,
      };
      const have = new Set(board.notes.map(n => n.id));
      const added = op.add.filter(n => !have.has(n.id));
      return { ...board, notes: [...board.notes.map(n => (n === note ? reported : n)), ...added] };
    }

    case 'ai.state': {
      const ids = new Set(op.ids);
      let changed = false;
      const notes = board.notes.map(note => {
        if (!ids.has(note.id) || (!note.aiState && !op.state)) return note;
        changed = true;
        if (op.state) return { ...note, aiState: op.state };
        const { aiState: _cleared, ...rest } = note;
        return rest;
      });
      return changed ? { ...board, notes } : board;
    }
  }
}
