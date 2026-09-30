// Board data shared by the wall, the editor and (from checkpoint 2) the server.

export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'white'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

/** What a column is for; decides which template a new note in it starts from. */
export type LaneKind = 'application' | 'source' | 'task' | 'reminder' | 'note';

export const STAGES = ['Researching', 'Drafting', 'Submitted', 'Awarded', 'Declined'] as const;
export type Stage = (typeof STAGES)[number];

/** Stages after which a deadline no longer needs attention. */
export const FINISHED_STAGES: readonly Stage[] = ['Submitted', 'Awarded', 'Declined'];

export interface Lane {
  id: string;
  title: string;
  color: NoteColor;
  order: number;
  kind: LaneKind;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/** A link to double-check (funder page, guideline, citation). */
export interface SourceLink {
  id: string;
  url: string;
  label?: string;
  verified: boolean;
}

export interface Note {
  id: string;
  laneId: string;
  title: string;
  body: string;
  color?: NoteColor;
  /** `YYYY-MM-DD` for an all-day deadline, or a full ISO date-time. */
  due?: string;
  /** ISO date-time when the wall should show a reminder. */
  remindAt?: string;
  stage?: Stage;
  funder?: string;
  amount?: string;
  checklist: ChecklistItem[];
  links: SourceLink[];
  pinned: boolean;
  done: boolean;
  doneAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type NightMode = 'auto' | 'on' | 'off';
export type NightStyle = 'dim' | 'clock';

export interface Settings {
  night: { mode: NightMode; start: string; end: string; style: NightStyle };
  wall: { showConnect: boolean; chime: boolean; alertMinutes: number };
}

/** A reminder that has gone off and is showing on the wall. */
export interface Alert {
  id: string;
  noteId: string;
  title: string;
  firedAt: string;
}

export interface Board {
  lanes: Lane[];
  notes: Note[];
  settings: Settings;
  alerts: Alert[];
}
