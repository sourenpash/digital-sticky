// Board data shared by the wall, the editor and the server.

export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'white'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

/** What a column is for; decides which template a new note in it starts from. */
export const LANE_KINDS = ['application', 'source', 'task', 'routine', 'reminder', 'note'] as const;
export type LaneKind = (typeof LANE_KINDS)[number];

export const STAGES = ['Researching', 'Drafting', 'Submitted', 'Interview', 'Awarded', 'Declined'] as const;
export type Stage = (typeof STAGES)[number];

/** Stages after which the deadline no longer needs attention (and that count as submitted). */
export const FINISHED_STAGES: readonly Stage[] = ['Submitted', 'Interview', 'Awarded', 'Declined'];

/** What an application is for; decides its checklist and wording (see applications.ts). */
export const APP_TYPES = ['grant', 'job', 'school', 'fellowship', 'other'] as const;
export type AppType = (typeof APP_TYPES)[number];

/** A to-do can be a message to send: an email, a text or a call (see messages.ts). */
export const CHANNELS = ['email', 'text', 'call'] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * Nudges to follow up once an application is in or a message is sent: at `at`, then
 * again every `everyDays` days (same time of day) until the answer comes in.
 */
export interface FollowUp {
  /** The next nudge (ISO date-time). "I followed up" moves it on. */
  at: string;
  /** 0 = just once. */
  everyDays: number;
}

export const AI_SCHEDULES = ['once', 'daily', 'weekly'] as const;
export type AiSchedule = (typeof AI_SCHEDULES)[number];

/** A sticky handed to the AI helper: what it should do, and how often. */
export interface AiTask {
  instructions: string;
  schedule: AiSchedule;
  /** Local time of day, `HH:MM`. */
  time: string;
  /** Weekly only (0 = Sunday). */
  weekday?: number;
  /** It may add stickies for new things it finds (as related tasks of this one). */
  mayAdd: boolean;
  /** It may tick off and add to this sticky's checklist and links. */
  mayEdit: boolean;
  /** When it was handed to the AI (ISO date-time): scheduled checks count from then. */
  since?: string;
  /** "Run now": asked for a check outside the schedule (ISO date-time). */
  requestedAt?: string;
  /** The AI connection that does it (an id from the Wall tab); none means the default one. */
  by?: string;
}

/** Most runs a note keeps in its AI log (newest first). */
export const MAX_AI_LOG = 10;

/** One run of the AI helper. */
export interface AiRun {
  id: string;
  at: string;
  status: 'done' | 'error';
  /** What it found (or what went wrong), in a few sentences. */
  summary: string;
  links: Array<{ url: string; label?: string }>;
  /** Stickies it added. */
  added: string[];
}

export const AI_STATES = ['queued', 'running', 'needs-setup', 'error'] as const;

/**
 * What the AI helper is doing with a sticky right now: `queued` once an AI has been
 * woken up for it, `running` once the AI has picked it up, until it reports back.
 */
export interface AiState {
  status: (typeof AI_STATES)[number];
  message?: string;
  since: string;
  /** The AI connection's name, for "Asked Claude routine at 8 AM". */
  by?: string;
  /** Where to watch the run (a Claude routine's session), when the AI gives one. */
  url?: string;
}

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

/** Note fields only the server sets: what it has already nudged about, and the AI helper's work. */
export const SERVER_NOTE_FIELDS = ['remindedFor', 'followedUpFor', 'aiLog', 'aiState', 'addedBy'] as const;
export type ServerNoteField = (typeof SERVER_NOTE_FIELDS)[number];

export interface Note {
  id: string;
  laneId: string;
  title: string;
  body: string;
  color?: NoteColor;
  /** A related task: the sticky it belongs to. */
  parentId?: string;
  /** `YYYY-MM-DD` for an all-day deadline, or a full ISO date-time. */
  due?: string;
  /** ISO date-time when the wall should show a reminder. */
  remindAt?: string;
  /** The `remindAt` the server has already shown (or skipped). Moving the reminder arms it again. */
  remindedFor?: string;
  /** Applications only. */
  appType?: AppType;
  stage?: Stage;
  /** Who the application goes to: funder, company, school… (for a message: who it's to). */
  funder?: string;
  amount?: string;
  /** A to-do that's an email, text or call. */
  channel?: Channel;
  /** When the message was sent, or the application submitted. */
  sentAt?: string;
  followUp?: FollowUp;
  /** The follow-up time the server has already nudged about (or skipped). */
  followedUpFor?: string;
  /** Handed to the AI helper. */
  ai?: AiTask;
  /** The AI helper's runs, newest first (the server keeps these). */
  aiLog?: AiRun[];
  aiState?: AiState;
  /** Added by the AI helper. */
  addedBy?: 'ai';
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

/** The ribbon along the bottom of the wall: prices and tech headlines. */
export interface TickerSettings {
  show: boolean;
  /** Coin symbols, e.g. BTC. */
  crypto: string[];
  /** Stock symbols, e.g. AAPL. */
  stocks: string[];
  /** News sources: ids from NEWS_SOURCES (shared/ticker.ts) or RSS/Atom addresses. */
  news: string[];
}

/** The AI helper: whether an AI may connect to the board (over MCP), and how often it may be woken. */
export interface AiSettings {
  connect: boolean;
  /** Most wake-ups a day, across all AI connections. */
  dailyCap: number;
}

export interface Settings {
  night: { mode: NightMode; start: string; end: string; style: NightStyle };
  wall: { showConnect: boolean; chime: boolean; alertMinutes: number };
  ticker: TickerSettings;
  ai: AiSettings;
}

/** A reminder that has gone off and is showing on the wall. */
export interface Alert {
  id: string;
  noteId: string;
  title: string;
  firedAt: string;
  /** A nudge to follow up (see FollowUp), rather than the note's reminder. */
  kind?: 'follow';
}

export interface Board {
  lanes: Lane[];
  notes: Note[];
  goals: Goal[];
  settings: Settings;
  alerts: Alert[];
}
