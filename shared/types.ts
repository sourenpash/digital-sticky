// Board data shared by the wall, the editor and the server.

export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'white'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

/** What a column is for; decides which template a new note in it starts from. */
export const LANE_KINDS = ['application', 'source', 'task', 'routine', 'reminder', 'note'] as const;
export type LaneKind = (typeof LANE_KINDS)[number];

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

export const REPEAT_EVERY = ['day', 'week', 'month'] as const;
export type RepeatEvery = (typeof REPEAT_EVERY)[number];

/** A recurring task has no deadline; it comes back every day, week or month. */
export interface Repeat {
  every: RepeatEvery;
  /** Times per week or month ("3 times a week"). Daily tasks are once a day. */
  times: number;
  /** Weekly only: set weekdays (0 = Sunday). When set, they decide how many times. */
  days?: number[];
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
  /** The `remindAt` the server has already shown (or skipped). Moving the reminder arms it again. */
  remindedFor?: string;
  stage?: Stage;
  funder?: string;
  amount?: string;
  checklist: ChecklistItem[];
  links: SourceLink[];
  /** Recurring tasks only. */
  repeat?: Repeat;
  /** Recurring tasks: when each "Did it" was logged (ISO date-times). */
  completions?: string[];
  pinned: boolean;
  done: boolean;
  doneAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** What moves a goal's progress bar. */
export const GOAL_MEASURES = ['submitted', 'won', 'count'] as const;
export type GoalMeasure = (typeof GOAL_MEASURES)[number];

/** A target with a progress bar on the wall, like "Submit 5 applications by Dec 31". */
export interface Goal {
  id: string;
  title: string;
  /** Submitted applications, money from awarded ones, or a number kept by hand. */
  measure: GoalMeasure;
  target: number;
  /** Progress so far for `count` goals. */
  count: number;
  /** Optional finish date, `YYYY-MM-DD`. */
  by?: string;
  createdAt: string;
}

export const NIGHT_MODES = ['auto', 'on', 'off'] as const;
export type NightMode = (typeof NIGHT_MODES)[number];
export const NIGHT_STYLES = ['dim', 'clock'] as const;
export type NightStyle = (typeof NIGHT_STYLES)[number];

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
  goals: Goal[];
  settings: Settings;
  alerts: Alert[];
}
