import { useSyncExternalStore } from 'react';
import { pruneCompletions, repeatStatus } from '../../../shared/recurring.ts';
import type { Board, Goal, Lane, LaneKind, Note, Settings } from '../../../shared/types.ts';
import { makeSampleBoard } from '../data/sample.ts';
import { currentTime } from '../lib/now.ts';
import { uid } from '../lib/uid.ts';

// Checkpoint 1: an in-memory board filled with placeholder data. Nothing is saved.
// Checkpoint 2 swaps this for the server API + live updates behind the same functions.

let state: Board = makeSampleBoard(currentTime());
const listeners = new Set<() => void>();

function commit(next: Board): void {
  state = next;
  listeners.forEach(listener => listener());
}

const stamp = () => currentTime().toISOString();

function updateNote(id: string, patch: Partial<Note>): void {
  commit({
    ...state,
    notes: state.notes.map(note => (note.id === id ? { ...note, ...patch, updatedAt: stamp() } : note)),
  });
}

export const board = {
  get: (): Board => state,

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  updateNote,

  addNote(note: Note): void {
    commit({ ...state, notes: [...state.notes, { ...note, createdAt: stamp(), updatedAt: stamp() }] });
  },

  /** Removes a note and returns it so the caller can offer Undo. */
  deleteNote(id: string): Note | undefined {
    const note = state.notes.find(n => n.id === id);
    if (!note) return undefined;
    commit({
      ...state,
      notes: state.notes.filter(n => n.id !== id),
      alerts: state.alerts.filter(alert => alert.noteId !== id),
    });
    return note;
  },

  restoreNote(note: Note): void {
    if (state.notes.some(n => n.id === note.id)) return;
    commit({ ...state, notes: [...state.notes, note] });
  },

  setDone(id: string, done: boolean): void {
    updateNote(id, { done, doneAt: done ? stamp() : undefined });
    if (done) commit({ ...state, alerts: state.alerts.filter(alert => alert.noteId !== id) });
  },

  toggleChecklistItem(noteId: string, itemId: string): void {
    const note = state.notes.find(n => n.id === noteId);
    if (!note) return;
    updateNote(noteId, {
      checklist: note.checklist.map(item => (item.id === itemId ? { ...item, done: !item.done } : item)),
    });
  },

  toggleLinkVerified(noteId: string, linkId: string): void {
    const note = state.notes.find(n => n.id === noteId);
    if (!note) return;
    updateNote(noteId, {
      links: note.links.map(link => (link.id === linkId ? { ...link, verified: !link.verified } : link)),
    });
  },

  /** Recurring tasks: log one "Did it" now. */
  logRoutine(id: string): void {
    const note = state.notes.find(n => n.id === id);
    if (!note?.repeat) return;
    updateNote(id, { completions: pruneCompletions([...(note.completions ?? []), stamp()], currentTime()) });
  },

  /** Recurring tasks: take back the latest "Did it" from the current day, week or month. */
  undoRoutine(id: string): void {
    const note = state.notes.find(n => n.id === id);
    const status = note ? repeatStatus(note, currentTime()) : null;
    if (!note || !status || status.done === 0) return;
    const completions = [...(note.completions ?? [])].sort();
    completions.pop();
    updateNote(id, { completions });
  },

  addGoal(goal: Goal): void {
    commit({ ...state, goals: [...state.goals, { ...goal, createdAt: stamp() }] });
  },

  updateGoal(id: string, patch: Partial<Goal>): void {
    commit({ ...state, goals: state.goals.map(goal => (goal.id === id ? { ...goal, ...patch } : goal)) });
  },

  /** Removes a goal and returns it so the caller can offer Undo. */
  deleteGoal(id: string): Goal | undefined {
    const goal = state.goals.find(g => g.id === id);
    if (goal) commit({ ...state, goals: state.goals.filter(g => g.id !== id) });
    return goal;
  },

  restoreGoal(goal: Goal): void {
    if (!state.goals.some(g => g.id === goal.id)) commit({ ...state, goals: [...state.goals, goal] });
  },

  updateSettings(change: (settings: Settings) => Settings): void {
    commit({ ...state, settings: change(state.settings) });
  },

  addLane(title: string, kind: LaneKind = 'note'): void {
    const lane: Lane = { id: uid(), title, color: 'white', kind, order: state.lanes.length };
    commit({ ...state, lanes: [...state.lanes, lane] });
  },

  updateLane(id: string, patch: Partial<Lane>): void {
    commit({ ...state, lanes: state.lanes.map(lane => (lane.id === id ? { ...lane, ...patch } : lane)) });
  },

  /** Prototype stand-in for the server's reminder timer. */
  fireReminder(noteId: string): void {
    const note = state.notes.find(n => n.id === noteId);
    if (!note || state.alerts.some(alert => alert.noteId === noteId)) return;
    commit({ ...state, alerts: [...state.alerts, { id: uid(), noteId, title: note.title, firedAt: stamp() }] });
  },

  dismissAlert(id: string): void {
    commit({ ...state, alerts: state.alerts.filter(alert => alert.id !== id) });
  },
};

export function useBoard(): Board {
  return useSyncExternalStore(board.subscribe, board.get);
}

const APPLICATION_CHECKLIST = ['Confirm eligibility', 'Budget', 'Narrative / statement', 'Letters of support', 'Submit'];

/** A blank note for the "Add" templates; it joins the board only when the user taps Add. */
export function draftNote(kind: LaneKind, lanes: Lane[]): Note {
  const lane =
    lanes.find(l => l.kind === kind) ?? (kind === 'routine' ? lanes.find(l => l.kind === 'task') : undefined) ?? lanes[0];
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
