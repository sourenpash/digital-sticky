import { z } from 'zod';
import { AI_CONNECTION_KINDS } from './ai.ts';
import { DEFAULT_SETTINGS } from './defaults.ts';
import { MAX_REMOTE_COMMANDS, MAX_REMOTE_STEP, MAX_REMOTE_TEXT, REMOTE_KEYS } from './remote.ts';
import { CRYPTO_SYMBOL, MAX_CRYPTO, MAX_NEWS, MAX_STOCKS, NEWS_SOURCE_IDS, STOCK_SYMBOL } from './ticker.ts';
import {
  AI_SCHEDULES,
  AI_STATES,
  APP_TYPES,
  CHANNELS,
  GOAL_MEASURES,
  LANE_KINDS,
  MAX_AI_LOG,
  NIGHT_MODES,
  NIGHT_STYLES,
  NOTE_COLORS,
  REPEAT_EVERY,
  STAGES,
} from './types.ts';

// What the server accepts. Strings are generous (a half-typed title is fine), while
// ids, dates, links and structure are strict, so a bad request can't damage the board.

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid id');
const dateTime = z.iso.datetime({ offset: true });
const dateOnly = z.iso.date();
/** A deadline: an all-day date or a date with a time. */
const when = z.union([dateOnly, dateTime]);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 22:00');

function isWebAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
const webAddress = z.string().max(2048).refine(isWebAddress, 'Links must be http:// or https:// web addresses');

/** Optional fields can be cleared in a patch by sending `null`. */
const clearable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

export const noteColorSchema = z.enum(NOTE_COLORS);
export const laneKindSchema = z.enum(LANE_KINDS);

export const laneSchema = z.object({
  id,
  title: z.string().max(80),
  color: noteColorSchema,
  order: z.number().int().min(0).max(10_000),
  kind: laneKindSchema,
});

const checklistItemSchema = z.object({ id, text: z.string().max(500), done: z.boolean() });
const sourceLinkSchema = z.object({ id, url: webAddress, label: z.string().max(200).optional(), verified: z.boolean() });
const repeatSchema = z.object({
  every: z.enum(REPEAT_EVERY),
  times: z.number().int().min(1).max(31),
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});

const title = z.string().max(300);
const body = z.string().max(20_000);
const funder = z.string().max(200);
const amount = z.string().max(100);
const checklist = z.array(checklistItemSchema).max(200);
const links = z.array(sourceLinkSchema).max(100);
const completions = z.array(dateTime).max(1000);

const followUpSchema = z.object({ at: dateTime, everyDays: z.number().int().min(0).max(366) });
const aiTaskSchema = z.object({
  instructions: z.string().max(4000),
  schedule: z.enum(AI_SCHEDULES),
  time: clock,
  weekday: z.number().int().min(0).max(6).optional(),
  mayAdd: z.boolean(),
  mayEdit: z.boolean(),
  since: dateTime.optional(),
  requestedAt: dateTime.optional(),
  by: id.optional(),
});
const aiRunSchema = z.object({
  id,
  at: dateTime,
  status: z.enum(['done', 'error']),
  summary: z.string().max(4000),
  links: z.array(z.object({ url: webAddress, label: z.string().max(200).optional() })).max(20),
  added: z.array(id).max(20),
});
const aiStateSchema = z.object({
  status: z.enum(AI_STATES),
  message: z.string().max(500).optional(),
  since: dateTime,
  by: z.string().max(80).optional(),
  url: webAddress.optional(),
});

export const noteSchema = z.object({
  id,
  laneId: id,
  title,
  body,
  color: noteColorSchema.optional(),
  parentId: id.optional(),
  due: when.optional(),
  remindAt: dateTime.optional(),
  remindedFor: dateTime.optional(),
  appType: z.enum(APP_TYPES).optional(),
  stage: z.enum(STAGES).optional(),
  funder: funder.optional(),
  amount: amount.optional(),
  channel: z.enum(CHANNELS).optional(),
  sentAt: dateTime.optional(),
  followUp: followUpSchema.optional(),
  followedUpFor: dateTime.optional(),
  ai: aiTaskSchema.optional(),
  aiLog: z.array(aiRunSchema).max(MAX_AI_LOG).optional(),
  aiState: aiStateSchema.optional(),
  addedBy: z.literal('ai').optional(),
  checklist,
  links,
  repeat: repeatSchema.optional(),
  completions: completions.optional(),
  pinned: z.boolean(),
  done: z.boolean(),
  doneAt: dateTime.optional(),
  createdAt: dateTime,
  updatedAt: dateTime,
});

/** POST /api/notes. Only the column and title are required; the rest has defaults (SERVER_NOTE_FIELDS are left out). */
export const newNoteSchema = noteSchema.omit({ remindedFor: true, followedUpFor: true, aiLog: true, aiState: true, addedBy: true }).extend({
  id: id.optional(),
  body: body.default(''),
  checklist: checklist.default([]),
  links: links.default([]),
  pinned: z.boolean().default(false),
  done: z.boolean().default(false),
  createdAt: dateTime.optional(),
  updatedAt: dateTime.optional(),
});

export const notePatchSchema = z.object({
  laneId: id.optional(),
  title: title.optional(),
  body: body.optional(),
  color: clearable(noteColorSchema),
  parentId: clearable(id),
  due: clearable(when),
  remindAt: clearable(dateTime),
  appType: clearable(z.enum(APP_TYPES)),
  stage: clearable(z.enum(STAGES)),
  funder: clearable(funder),
  amount: clearable(amount),
  channel: clearable(z.enum(CHANNELS)),
  sentAt: clearable(dateTime),
  followUp: clearable(followUpSchema),
  ai: clearable(aiTaskSchema),
  checklist: checklist.optional(),
  links: links.optional(),
  repeat: clearable(repeatSchema),
  completions: clearable(completions),
  pinned: z.boolean().optional(),
  done: z.boolean().optional(),
  doneAt: clearable(dateTime),
});

export const completionsChangeSchema = z.object({
  add: z.array(dateTime).max(50).default([]),
  remove: z.array(dateTime).max(1000).default([]),
});

export const newLaneSchema = z.object({
  id: id.optional(),
  title: laneSchema.shape.title,
  color: noteColorSchema.default('white'),
  kind: laneKindSchema.default('note'),
});

export const lanePatchSchema = z.object({
  title: laneSchema.shape.title.optional(),
  color: noteColorSchema.optional(),
  kind: laneKindSchema.optional(),
});

export const laneOrderSchema = z.object({ ids: z.array(id).max(100) });

export const goalSchema = z.object({
  id,
  title: z.string().max(200),
  measure: z.enum(GOAL_MEASURES),
  target: z.number().min(0).max(1e12),
  count: z.number().int().min(0).max(1e9),
  by: dateOnly.optional(),
  createdAt: dateTime,
});

export const newGoalSchema = goalSchema.extend({
  id: id.optional(),
  count: goalSchema.shape.count.default(0),
  createdAt: dateTime.optional(),
});

export const goalPatchSchema = z.object({
  title: goalSchema.shape.title.optional(),
  measure: goalSchema.shape.measure.optional(),
  target: goalSchema.shape.target.optional(),
  count: goalSchema.shape.count.optional(),
  by: clearable(dateOnly),
});

const tickerSchema = z.object({
  show: z.boolean(),
  crypto: z.array(z.string().regex(CRYPTO_SYMBOL, 'Use a coin symbol like BTC')).max(MAX_CRYPTO),
  stocks: z.array(z.string().regex(STOCK_SYMBOL, 'Use a stock symbol like AAPL')).max(MAX_STOCKS),
  news: z.array(z.union([z.enum(NEWS_SOURCE_IDS), webAddress])).max(MAX_NEWS),
});

/** Most AI wake-ups the daily limit can be set to. */
export const MAX_AI_DAILY_CAP = 100;

const aiSettingsSchema = z.object({
  connect: z.boolean(),
  dailyCap: z.number().int().min(1).max(MAX_AI_DAILY_CAP),
});

const notifySettingsSchema = z.object({ quietAtNight: z.boolean() });

export const settingsSchema = z.object({
  night: z.object({
    mode: z.enum(NIGHT_MODES),
    start: clock,
    end: clock,
    style: z.enum(NIGHT_STYLES),
  }),
  wall: z.object({
    showConnect: z.boolean(),
    chime: z.boolean(),
    alertMinutes: z.number().int().min(1).max(24 * 60),
  }),
  // Boards saved before the ticker (or the AI helper) existed get the default one.
  ticker: tickerSchema.default(() => structuredClone(DEFAULT_SETTINGS.ticker)),
  ai: aiSettingsSchema.default(() => structuredClone(DEFAULT_SETTINGS.ai)),
  notify: notifySettingsSchema.default(() => structuredClone(DEFAULT_SETTINGS.notify)),
});

export const settingsPatchSchema = z.object({
  night: settingsSchema.shape.night.partial().optional(),
  wall: settingsSchema.shape.wall.partial().optional(),
  ticker: tickerSchema.partial().optional(),
  ai: aiSettingsSchema.partial().optional(),
  notify: notifySettingsSchema.partial().optional(),
});

/** Most reminders that can be showing at once. */
export const MAX_ALERTS = 200;

export const alertSchema = z.object({ id, noteId: id, title, firedAt: dateTime, kind: z.literal('follow').optional() });
export const newAlertSchema = z.object({ id: id.optional(), noteId: id });

export const boardSchema = z.object({
  lanes: z.array(laneSchema).min(1).max(40),
  notes: z.array(noteSchema).max(5000),
  goals: z.array(goalSchema).max(100),
  settings: settingsSchema,
  alerts: z.array(alertSchema).max(MAX_ALERTS),
});

/** A remote move or scroll step: any size is accepted, but a huge one is cut down. */
const step = z.number().transform(value => Math.max(-MAX_REMOTE_STEP, Math.min(MAX_REMOTE_STEP, value)));

export const remoteCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), dx: step, dy: step }),
  z.object({ type: z.literal('click') }),
  z.object({ type: z.literal('scroll'), dx: step, dy: step }),
  z.object({ type: z.literal('text'), text: z.string().min(1).max(MAX_REMOTE_TEXT) }),
  z.object({ type: z.literal('key'), key: z.enum(REMOTE_KEYS) }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.literal('reload') }),
  z.object({ type: z.literal('board') }),
  z.object({ type: z.literal('open'), url: webAddress }),
  z.object({ type: z.literal('dialog'), accept: z.boolean() }),
]);

/** POST /api/remote */
export const remoteRequestSchema = z.object({ commands: z.array(remoteCommandSchema).min(1).max(MAX_REMOTE_COMMANDS) });

/** Deleted things wait here for 30 days so Undo works, even from another device. */
export const trashSchema = z.object({
  notes: z.array(z.object({ note: noteSchema, deletedAt: dateTime })),
  lanes: z.array(z.object({ lane: laneSchema, notes: z.array(noteSchema), deletedAt: dateTime })),
  goals: z.array(z.object({ goal: goalSchema, deletedAt: dateTime })),
});

/** Most AI connections the board keeps. */
export const MAX_AI_CONNECTIONS = 20;

/** PUT api/ai/connections/:id. A token left out keeps the saved one; an empty one removes it. */
export const aiConnectionInputSchema = z.object({
  kind: z.enum(AI_CONNECTION_KINDS),
  name: z.string().trim().min(1, 'Give it a name').max(60),
  url: z.union([webAddress, z.literal('')]).optional(),
  token: z.string().trim().max(2000).optional(),
  makeDefault: z.boolean().optional(),
});

export type AiConnectionInput = z.output<typeof aiConnectionInputSchema>;

/** Most phone numbers and Apple IDs that get texts from the board. */
export const MAX_TEXT_ADDRESSES = 10;

/** PUT api/imessage. A password left out keeps the saved one. */
export const imessageInputSchema = z.object({
  url: z.union([webAddress, z.literal('')]),
  password: z.string().max(200).optional(),
  addresses: z
    .array(
      z
        .string()
        .trim()
        .min(3)
        .max(100)
        .regex(/^(\+?[\d\s().-]{6,}|[^\s@]+@[^\s@]+\.[^\s@]+)$/, 'Use a phone number (with its country code, like +1 555 123 4567) or an Apple ID email'),
    )
    .max(MAX_TEXT_ADDRESSES),
  reminders: z.boolean(),
  followUps: z.boolean(),
  morning: z.boolean(),
  morningTime: clock,
});

export type IMessageInput = z.output<typeof imessageInputSchema>;

/** Most devices that can be set up as wall screens. */
export const MAX_SCREENS = 50;

/** A device set up as a wall screen (kept by the server, not part of the board). */
export const screenSchema = z.object({ id, name: z.string().min(1).max(60), addedAt: dateTime, lastSeenAt: dateTime.optional() });

/** POST /api/screens, PATCH /api/screens/:id */
export const screenNameSchema = z.object({ name: z.string().trim().min(1, 'Give the screen a name').max(60) });

/** The saved file, data/board.json. */
export const savedFileSchema = z.object({
  version: z.literal(1),
  rev: z.number().int().min(0),
  savedAt: dateTime,
  board: boardSchema,
  trash: trashSchema.default({ notes: [], lanes: [], goals: [] }),
  screens: z.array(screenSchema).max(MAX_SCREENS).default([]),
});

export type Trash = z.infer<typeof trashSchema>;
export type SavedFile = z.infer<typeof savedFileSchema>;
export type ScreenEntry = z.infer<typeof screenSchema>;

/** A short, readable message for an invalid request. */
export function describeIssues(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request';
  const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
  const more = error.issues.length > 1 ? ` (and ${error.issues.length - 1} more)` : '';
  return `${where}${issue.message}${more}`;
}
