import { z } from 'zod';
import { lanesInOrder } from '../shared/board.ts';
import type { AiReport } from '../shared/ops.ts';
import type { Board, ChecklistItem, Note, SourceLink } from '../shared/types.ts';
import { newId } from './store.ts';

// An AI reporting back on a sticky (the report_ai_run tool). What it may change is
// up to the sticky's settings: new stickies only with "Add stickies", the checklist
// and sources only with "Tick off and add". Anything else it sends is skipped, and
// it's told so. Small mistakes (a bad link) are skipped too, rather than losing the
// whole report.

/** Most stickies one report can add. */
export const MAX_AI_NEW_STICKIES = 5;
const MAX_CHECKLIST = 200;
const MAX_LINKS = 100;
const MAX_RUN_LINKS = 20;

const link = z.object({
  url: z.string().max(2048).describe('A web address (https://…)'),
  label: z.string().max(200).optional().describe('A few words saying what it is'),
});

/** The report_ai_run tool's input. */
export const aiReportInput = z.object({
  stickyId: z.string().max(64).describe('The sticky’s id, from list_ai_tasks'),
  summary: z
    .string()
    .min(1)
    .max(4000)
    .describe('What you found, in a few sentences: what’s new, with dates, deadlines and amounts. Say so if nothing is new.'),
  status: z.enum(['done', 'error']).default('done').describe('"error" if you couldn’t do the task (say why in the summary)'),
  links: z.array(link).max(MAX_RUN_LINKS).default([]).describe('The pages you used'),
  newStickies: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        details: z.string().max(4000).optional().describe('What it is and what to do, in a sentence or two'),
        links: z.array(z.string().max(2048)).max(10).optional(),
        due: z.string().max(10).optional().describe('A deadline, YYYY-MM-DD'),
      }),
    )
    .max(10)
    .default([])
    .describe(`New things you found, each as a sticky (at most ${MAX_AI_NEW_STICKIES}; only when the task allows adding stickies)`),
  checklist: z
    .object({
      tick: z.array(z.string().max(500)).max(50).default([]).describe('Checklist items now done: their ids or their text'),
      add: z.array(z.string().min(1).max(500)).max(20).default([]).describe('New checklist items'),
    })
    .optional()
    .describe('Changes to the sticky’s checklist (only when the task allows editing)'),
  sources: z.array(link).max(20).optional().describe('Sources to add to the sticky, to double-check (only when the task allows editing)'),
});

export type AiReportInput = z.output<typeof aiReportInput>;

export class AiReportError extends Error {}

export interface BuiltReport {
  report: AiReport;
  /** Titles of the stickies added. */
  added: string[];
  /** What was left out, and why, to tell the AI. */
  skipped: string[];
}

function isWebAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const same = (a: string) => a.trim().toLowerCase().replace(/\s+/g, ' ');

function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Checks a report against the board and the sticky's settings, and builds the change. */
export function buildAiReport(board: Board, input: AiReportInput, now: Date, makeId: () => string = newId): BuiltReport {
  const note = board.notes.find(n => n.id === input.stickyId);
  if (!note) throw new AiReportError('There’s no sticky with that id. Call list_ai_tasks to get the ids.');
  const ai = note.ai;
  if (!ai) throw new AiReportError('That sticky isn’t handed to the AI helper, so there’s nothing to report on.');
  const stamp = now.toISOString();
  const skipped: string[] = [];

  /** Keeps the web addresses; says how many of the rest were left out ("a link", "2 sources on …"). */
  const goodLinks = (items: Array<{ url: string; label?: string }>, what: string, where = '') => {
    const good = items.filter(item => isWebAddress(item.url));
    const bad = items.length - good.length;
    if (bad) skipped.push(`${bad === 1 ? `a ${what}` : `${bad} ${what}s`}${where} that ${bad === 1 ? 'wasn’t a web address' : 'weren’t web addresses'}`);
    return good;
  };
  const runLinks = goodLinks(input.links, 'link');

  // New stickies, as related tasks of this one, in the Double-check column.
  const add: Note[] = [];
  if (input.newStickies.length && !ai.mayAdd) {
    skipped.push('the new stickies: this sticky’s settings don’t let the AI add stickies');
  } else if (input.newStickies.length) {
    const lanes = lanesInOrder(board.lanes);
    const laneId = (lanes.find(lane => lane.kind === 'source') ?? lanes.find(lane => lane.id === note.laneId) ?? lanes[0]!).id;
    const titles = new Set(board.notes.map(n => same(n.title)));
    for (const item of input.newStickies) {
      const title = item.title.trim();
      if (!title || titles.has(same(title))) {
        skipped.push(`"${title}": it’s already on the board`);
        continue;
      }
      if (add.length >= MAX_AI_NEW_STICKIES) {
        skipped.push(`"${title}": a report can add at most ${MAX_AI_NEW_STICKIES} stickies`);
        continue;
      }
      titles.add(same(title));
      const links = goodLinks(
        (item.links ?? []).map(url => ({ url })),
        'link',
        ` on "${title}"`,
      ).map((l): SourceLink => ({ id: makeId(), url: l.url, verified: false }));
      if (item.due && !isDay(item.due)) skipped.push(`the deadline on "${title}" (use YYYY-MM-DD)`);
      add.push({
        id: makeId(),
        laneId,
        title,
        body: item.details?.trim() ?? '',
        parentId: note.id,
        addedBy: 'ai',
        ...(item.due && isDay(item.due) ? { due: item.due } : {}),
        checklist: [],
        links,
        pinned: false,
        done: false,
        createdAt: stamp,
        updatedAt: stamp,
      });
    }
  }

  // The sticky's checklist and sources.
  let checklist: ChecklistItem[] | undefined;
  let links: SourceLink[] | undefined;
  const wantsEdit = Boolean(input.checklist?.tick.length || input.checklist?.add.length || input.sources?.length);
  if (wantsEdit && !ai.mayEdit) {
    skipped.push('the checklist and source changes: this sticky’s settings don’t let the AI change them');
  } else if (wantsEdit) {
    if (input.checklist) {
      const tick = new Set(input.checklist.tick.map(same));
      checklist = note.checklist.map(item => (tick.has(same(item.id)) || tick.has(same(item.text)) ? { ...item, done: true } : item));
      const have = new Set(checklist.map(item => same(item.text)));
      for (const text of input.checklist.add) {
        if (have.has(same(text)) || checklist.length >= MAX_CHECKLIST) continue;
        have.add(same(text));
        checklist.push({ id: makeId(), text: text.trim(), done: false });
      }
    }
    if (input.sources?.length) {
      links = [...note.links];
      const have = new Set(links.map(l => l.url));
      for (const source of goodLinks(input.sources, 'source')) {
        if (have.has(source.url) || links.length >= MAX_LINKS) continue;
        have.add(source.url);
        links.push({ id: makeId(), url: source.url, ...(source.label ? { label: source.label } : {}), verified: false });
      }
    }
  }

  return {
    report: {
      noteId: note.id,
      run: {
        id: makeId(),
        at: stamp,
        status: input.status,
        summary: input.summary.trim(),
        links: runLinks.map(l => ({ url: l.url, ...(l.label ? { label: l.label } : {}) })),
        added: add.map(n => n.id),
      },
      add,
      ...(checklist ? { checklist } : {}),
      ...(links ? { links } : {}),
    },
    added: add.map(n => n.title),
    skipped,
  };
}
