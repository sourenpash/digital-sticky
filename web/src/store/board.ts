import { useSyncExternalStore } from 'react';
import { lanesInOrder } from '../../../shared/board.ts';
import { DEFAULT_SETTINGS } from '../../../shared/defaults.ts';
import type { GoalPatch, LanePatch, NotePatch, SettingsPatch } from '../../../shared/ops.ts';
import { periodStart, repeatStatus } from '../../../shared/recurring.ts';
import { makeSampleBoard, SAMPLE_CONNECT_URL } from '../../../shared/sample.ts';
import type { Board, ChecklistItem, Goal, Lane, LaneKind, Note, NoteColor, Settings } from '../../../shared/types.ts';
import { currentTime } from '../lib/now.ts';
import { uid } from '../lib/uid.ts';
import { SyncEngine, type SyncState } from './sync.ts';
import { HttpTransport, LocalTransport } from './transport.ts';
import { showToast } from './toasts.ts';

// The board as the app sees it, and every change the app can make. Changes show
// here at once and are saved on the board server in the background (see sync.ts).
// The single-file preview page has no server and keeps its sample board in memory.

const local = __DEMO_BUILD__ ? new LocalTransport(makeSampleBoard(currentTime()), currentTime, SAMPLE_CONNECT_URL) : null;

export const engine = new SyncEngine({
  transport: local ?? new HttpTransport(),
  initial: local?.snapshot(),
  clock: currentTime,
  buildId: __BUILD_ID__,
  onError: text => showToast({ text }, 7000),
  onReload: () => window.location.reload(),
});

if (local) {
  local.onChange = rev => engine.handleChange({ epoch: 'local', rev });
  engine.setStreamUp(true);
}

/** Shown for the moment before the board has loaded. */
const EMPTY: Board = { lanes: [], notes: [], goals: [], settings: DEFAULT_SETTINGS, alerts: [] };

const current = (): Board => engine.getBoard() ?? EMPTY;
const stamp = () => currentTime().toISOString();
const findNote = (id: string) => current().notes.find(note => note.id === id);

/** Typing waits this long for the next letter before it's sent. */
const TYPING_MS = 600;
const TEXT_FIELDS = new Set(['title', 'body', 'funder', 'amount']);

const NOTE_FIELDS = [
  'laneId', 'title', 'body', 'color', 'due', 'remindAt', 'stage', 'funder', 'amount',
  'checklist', 'links', 'repeat', 'completions', 'pinned', 'done', 'doneAt',
] as const;

function notePatch(patch: Partial<Note>): NotePatch {
  const out: Record<string, unknown> = {};
  for (const key of NOTE_FIELDS) if (key in patch) out[key] = patch[key];
  return out as NotePatch;
}

/** Only checklist wording changed (not ticks, order or items). */
function checklistTextOnly(before: ChecklistItem[], after: ChecklistItem[] | undefined): boolean {
  return !!after && after.length === before.length && after.every((item, i) => item.id === before[i]?.id && item.done === before[i]?.done);
}

function typingDelay(note: Note, patch: NotePatch): number {
  const keys = Object.keys(patch);
  const typing = keys.length > 0 && keys.every(key => TEXT_FIELDS.has(key) || (key === 'checklist' && checklistTextOnly(note.checklist, patch.checklist)));
  return typing ? TYPING_MS : 0;
}

const KIND_COLOR: Record<LaneKind, NoteColor> = {
  application: 'yellow',
  source: 'blue',
  task: 'green',
  routine: 'orange',
  reminder: 'pink',
  note: 'white',
};

export interface DeletedLane {
  lane: Lane;
  notes: Note[];
}

/**
 * The change for moving a note to another column. Moving into a Recurring column
 * makes it repeat (weekly to start with); moving out of one makes it a one-off again.
 */
export function laneChange(note: Note, lanes: Lane[], laneId: string): NotePatch {
  const to = lanes.find(lane => lane.id === laneId);
  const patch: NotePatch = { laneId };
  if (to && (to.kind === 'routine') !== Boolean(note.repeat)) {
    patch.repeat = to.kind === 'routine' ? { every: 'week', times: 1 } : null;
    patch.completions = to.kind === 'routine' ? [] : null;
  }
  return patch;
}

export const board = {
  get: current,
  subscribe: engine.subscribe,

  updateNote(id: string, change: Partial<Note>): void {
    const note = findNote(id);
    if (!note) return;
    const patch = notePatch(change);
    // Recurring "Did it" times go as additions and removals, so two phones logging at
    // the same moment both count.
    if (patch.completions && note.repeat) {
      const before = new Set(note.completions ?? []);
      const after = new Set(patch.completions);
      const add = [...after].filter(iso => !before.has(iso));
      const remove = [...before].filter(iso => !after.has(iso));
      if (add.length || remove.length) engine.dispatch({ type: 'note.completions', id, add, remove });
      delete patch.completions;
    }
    if (Object.keys(patch).length) engine.dispatch({ type: 'note.patch', id, patch }, typingDelay(note, patch));
  },

  addNote(note: Note): void {
    engine.dispatch({ type: 'note.add', note: { ...note, createdAt: stamp(), updatedAt: stamp() } });
  },

  /** Removes a note and returns it so the caller can offer Undo. */
  deleteNote(id: string): Note | undefined {
    const note = findNote(id);
    if (note) engine.dispatch({ type: 'note.delete', id });
    return note;
  },

  restoreNote(note: Note): void {
    engine.dispatch({ type: 'note.restore', id: note.id, note });
  },

  setDone(id: string, done: boolean): void {
    engine.dispatch({ type: 'note.patch', id, patch: { done, doneAt: done ? stamp() : null } });
  },

  toggleChecklistItem(noteId: string, itemId: string): void {
    const note = findNote(noteId);
    if (!note) return;
    const checklist = note.checklist.map(item => (item.id === itemId ? { ...item, done: !item.done } : item));
    engine.dispatch({ type: 'note.patch', id: noteId, patch: { checklist } });
  },

  toggleLinkVerified(noteId: string, linkId: string): void {
    const note = findNote(noteId);
    if (!note) return;
    const links = note.links.map(link => (link.id === linkId ? { ...link, verified: !link.verified } : link));
    engine.dispatch({ type: 'note.patch', id: noteId, patch: { links } });
  },

  /** Moves a note to another column (see laneChange) and returns Undo. */
  moveNote(id: string, laneId: string): (() => void) | undefined {
    const note = findNote(id);
    if (!note || note.laneId === laneId) return undefined;
    const patch = laneChange(note, current().lanes, laneId);
    const undo: NotePatch = { laneId: note.laneId };
    if ('repeat' in patch) {
      undo.repeat = note.repeat ?? null;
      undo.completions = note.completions ?? null;
    }
    engine.dispatch({ type: 'note.patch', id, patch });
    return () => engine.dispatch({ type: 'note.patch', id, patch: undo });
  },

  /** Recurring tasks: log one "Did it" now. Returns its time, for Undo. */
  logRoutine(id: string): string | undefined {
    const note = findNote(id);
    if (!note?.repeat) return undefined;
    // Each "Did it" needs its own time. Two in the same millisecond only happen with the
    // screenshot clock (?now=), but step back rather than lose one.
    const taken = new Set(note.completions ?? []);
    let time = currentTime().getTime();
    while (taken.has(new Date(time).toISOString())) time -= 1;
    const at = new Date(time).toISOString();
    engine.dispatch({ type: 'note.completions', id, add: [at] });
    return at;
  },

  /** Takes back one "Did it" (the one at `at`, or the latest in the current period). */
  undoRoutine(id: string, at?: string): void {
    const note = findNote(id);
    const status = note ? repeatStatus(note, currentTime()) : null;
    if (!note?.repeat || !status) return;
    const start = periodStart(note.repeat.every, currentTime()).getTime();
    const latest = (note.completions ?? []).filter(iso => Date.parse(iso) >= start).sort().pop();
    const remove = at ?? latest;
    if (remove) engine.dispatch({ type: 'note.completions', id, remove: [remove] });
  },

  addGoal(goal: Goal): void {
    engine.dispatch({ type: 'goal.add', goal: { ...goal, createdAt: stamp() } });
  },

  updateGoal(id: string, change: Partial<Goal>): void {
    const patch: GoalPatch = {};
    if ('title' in change) patch.title = change.title;
    if ('measure' in change) patch.measure = change.measure;
    if ('target' in change) patch.target = change.target;
    if ('count' in change) patch.count = change.count;
    if ('by' in change) patch.by = change.by ?? null;
    const typing = Object.keys(patch).every(key => key === 'title' || key === 'target');
    engine.dispatch({ type: 'goal.patch', id, patch }, typing ? TYPING_MS : 0);
  },

  /** Removes a goal and returns it so the caller can offer Undo. */
  deleteGoal(id: string): Goal | undefined {
    const goal = current().goals.find(g => g.id === id);
    if (goal) engine.dispatch({ type: 'goal.delete', id });
    return goal;
  },

  restoreGoal(goal: Goal): void {
    engine.dispatch({ type: 'goal.restore', id: goal.id, goal });
  },

  updateSettings(change: (settings: Settings) => Settings): void {
    const before = current().settings;
    const after = change(before);
    const diff = <T extends object>(a: T, b: T): Partial<T> =>
      Object.fromEntries(Object.entries(b).filter(([key, value]) => (a as Record<string, unknown>)[key] !== value)) as Partial<T>;
    const patch: SettingsPatch = {};
    const night = diff(before.night, after.night);
    const wall = diff(before.wall, after.wall);
    if (Object.keys(night).length) patch.night = night;
    if (Object.keys(wall).length) patch.wall = wall;
    if (patch.night || patch.wall) engine.dispatch({ type: 'settings.patch', patch });
  },

  addLane(title: string, kind: LaneKind = 'note'): void {
    const lanes = current().lanes;
    const order = Math.max(-1, ...lanes.map(lane => lane.order)) + 1;
    engine.dispatch({ type: 'lane.add', lane: { id: uid(), title, color: KIND_COLOR[kind], kind, order } });
  },

  updateLane(id: string, patch: LanePatch): void {
    const typing = Object.keys(patch).every(key => key === 'title');
    engine.dispatch({ type: 'lane.patch', id, patch }, typing ? TYPING_MS : 0);
  },

  /** Moves a column one place left (-1) or right (+1). */
  moveLane(id: string, step: -1 | 1): void {
    const ids = lanesInOrder(current().lanes).map(lane => lane.id);
    const from = ids.indexOf(id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    engine.dispatch({ type: 'lane.order', ids });
  },

  /** Deletes a column and its notes; returns them so the caller can offer Undo. */
  deleteLane(id: string): DeletedLane | undefined {
    const { lanes, notes } = current();
    const lane = lanes.find(l => l.id === id);
    if (!lane || lanes.length <= 1) return undefined;
    engine.dispatch({ type: 'lane.delete', id });
    return { lane, notes: notes.filter(note => note.laneId === id) };
  },

  restoreLane({ lane, notes }: DeletedLane): void {
    engine.dispatch({ type: 'lane.restore', id: lane.id, lane, notes });
  },

  /** Shows a note's reminder on the wall now (the server does this at the set time from checkpoint 3). */
  fireReminder(noteId: string): void {
    engine.dispatch({ type: 'alert.fire', id: uid(), noteId });
  },

  dismissAlert(id: string): void {
    engine.dispatch({ type: 'alert.dismiss', id });
  },

  /** Send anything still waiting (e.g. when a note is closed). */
  flush(): void {
    engine.flush();
  },
};

/** Asks every screen showing the wall to reload (for when it looks stuck). */
export async function reloadWall(): Promise<void> {
  if (__DEMO_BUILD__) {
    showToast({ text: 'The wall screen is reloading' });
    return;
  }
  try {
    const response = await fetch(new URL('api/wall/reload', document.baseURI), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    showToast({ text: response.ok ? 'The wall screen is reloading' : 'Couldn’t reach the wall' });
  } catch {
    showToast({ text: 'Couldn’t reach the wall' });
  }
}

export function useBoard(): Board {
  return useSyncExternalStore(engine.subscribe, current);
}

export function useSync(): SyncState {
  return useSyncExternalStore(engine.subscribe, engine.getState);
}

const APPLICATION_CHECKLIST = ['Confirm eligibility', 'Budget', 'Narrative / statement', 'Letters of support', 'Submit'];

/** A blank note for the "Add" templates; it joins the board only when the user taps Add. */
export function draftNote(kind: LaneKind, lanes: Lane[]): Note {
  const lane =
    lanes.find(l => l.kind === kind) ?? (kind === 'routine' ? lanes.find(l => l.kind === 'task') : undefined) ?? lanesInOrder(lanes)[0];
  const now = stamp();
  const blank: Note = {
    id: uid(),
    laneId: lane?.id ?? '',
    title: '',
    body: '',
    checklist: [],
    links: [],
    pinned: false,
    done: false,
    createdAt: now,
    updatedAt: now,
  };
  if (kind === 'application') {
    return {
      ...blank,
      stage: 'Researching',
      checklist: APPLICATION_CHECKLIST.map(text => ({ id: uid(), text, done: false })),
    };
  }
  if (kind === 'routine') return { ...blank, repeat: { every: 'week', times: 1 }, completions: [] };
  return blank;
}

/** A blank goal for the goal form; it joins the board only when the user taps Add. */
export function draftGoal(): Goal {
  return { id: uid(), title: '', measure: 'submitted', target: 5, count: 0, createdAt: stamp() };
}
