import { z } from 'zod';
import { GOAL_MEASURES, LANE_KINDS, NIGHT_MODES, NIGHT_STYLES, NOTE_COLORS, REPEAT_EVERY, STAGES } from './types.ts';

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

export const noteSchema = z.object({
  id,
  laneId: id,
  title,
  body,
  color: noteColorSchema.optional(),
  due: when.optional(),
  remindAt: dateTime.optional(),
  stage: z.enum(STAGES).optional(),
  funder: funder.optional(),
  amount: amount.optional(),
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

/** POST /api/notes. Only the column and title are required; the rest has defaults. */
export const newNoteSchema = noteSchema.extend({
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
  due: clearable(when),
  remindAt: clearable(dateTime),
  stage: clearable(z.enum(STAGES)),
  funder: clearable(funder),
  amount: clearable(amount),
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
});

export const settingsPatchSchema = z.object({
  night: settingsSchema.shape.night.partial().optional(),
  wall: settingsSchema.shape.wall.partial().optional(),
});

export const alertSchema = z.object({ id, noteId: id, title, firedAt: dateTime });
export const newAlertSchema = z.object({ id: id.optional(), noteId: id });

export const boardSchema = z.object({
  lanes: z.array(laneSchema).min(1).max(40),
  notes: z.array(noteSchema).max(5000),
  goals: z.array(goalSchema).max(100),
  settings: settingsSchema,
  alerts: z.array(alertSchema).max(200),
});

/** Deleted things wait here for 30 days so Undo works, even from another device. */
export const trashSchema = z.object({
  notes: z.array(z.object({ note: noteSchema, deletedAt: dateTime })),
  lanes: z.array(z.object({ lane: laneSchema, notes: z.array(noteSchema), deletedAt: dateTime })),
  goals: z.array(z.object({ goal: goalSchema, deletedAt: dateTime })),
});

/** The saved file, data/board.json. */
export const savedFileSchema = z.object({
  version: z.literal(1),
  rev: z.number().int().min(0),
  savedAt: dateTime,
  board: boardSchema,
  trash: trashSchema.default({ notes: [], lanes: [], goals: [] }),
});

export type Trash = z.infer<typeof trashSchema>;
export type SavedFile = z.infer<typeof savedFileSchema>;

/** A short, readable message for an invalid request. */
export function describeIssues(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request';
  const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
  const more = error.issues.length > 1 ? ` (and ${error.issues.length - 1} more)` : '';
  return `${where}${issue.message}${more}`;
}
