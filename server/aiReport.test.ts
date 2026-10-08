import { describe, expect, it } from 'vitest';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { applyOp } from '../shared/ops.ts';
import type { AiTask, Board, Note } from '../shared/types.ts';
import { aiReportInput, AiReportError, buildAiReport } from './aiReport.ts';

const now = new Date('2026-09-30T19:42:00Z');
const ai: AiTask = { instructions: 'Check grants.gov', schedule: 'daily', time: '08:00', mayAdd: true, mayEdit: false };

function note(fields: Partial<Note>): Note {
  return {
    id: 'n1',
    laneId: 'todo',
    title: 'Check grants.gov for new calls',
    body: '',
    checklist: [],
    links: [],
    pinned: false,
    done: false,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...fields,
  };
}

const board = (...notes: Note[]): Board => ({ ...makeEmptyBoard(), notes });
let counter = 0;
const ids = () => `id${++counter}`;
const input = (fields: object) => aiReportInput.parse({ stickyId: 'n1', summary: 'Two new calls.', ...fields });

describe('an AI’s report', () => {
  it('adds what it found as related stickies in Double-check, skipping ones already on the board', () => {
    counter = 0;
    const start = board(note({ ai }), note({ id: 'old', title: 'NIH K99/R00' }));
    const built = buildAiReport(
      start,
      input({
        links: [{ url: 'https://grants.gov/x', label: 'Grants.gov' }, { url: 'not a link' }],
        newStickies: [
          { title: 'NSF CAREER 2027', details: 'Due in July.', links: ['https://nsf.gov/career', 'ftp://x'], due: '2027-07-24' },
          { title: ' nih k99/r00 ' },
          { title: 'Simons fellowship', due: 'next July' },
        ],
      }),
      now,
      ids,
    );
    expect(built.added).toEqual(['NSF CAREER 2027', 'Simons fellowship']);
    expect(built.skipped).toEqual([
      'a link that wasn’t a web address',
      'a link on "NSF CAREER 2027" that wasn’t a web address',
      '"nih k99/r00": it’s already on the board',
      'the deadline on "Simons fellowship" (use YYYY-MM-DD)',
    ]);
    const [career, simons] = built.report.add;
    expect(career).toMatchObject({
      laneId: 'check',
      parentId: 'n1',
      addedBy: 'ai',
      title: 'NSF CAREER 2027',
      body: 'Due in July.',
      due: '2027-07-24',
      links: [{ url: 'https://nsf.gov/career', verified: false }],
    });
    expect(simons!.due).toBeUndefined();
    expect(built.report.run).toMatchObject({ status: 'done', summary: 'Two new calls.', links: [{ url: 'https://grants.gov/x', label: 'Grants.gov' }], added: [career!.id, simons!.id] });
    expect(built.report.checklist).toBeUndefined();

    const after = applyOp(start, { type: 'ai.report', ...built.report }, now);
    expect(after.notes.map(n => n.title)).toEqual(['Check grants.gov for new calls', 'NIH K99/R00', 'NSF CAREER 2027', 'Simons fellowship']);
  });

  it('adds at most 5 stickies, and none when the sticky doesn’t allow it', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ title: `Call ${i}` }));
    expect(buildAiReport(board(note({ ai })), input({ newStickies: many }), now, ids).added).toHaveLength(5);
    const closed = buildAiReport(board(note({ ai: { ...ai, mayAdd: false } })), input({ newStickies: many }), now, ids);
    expect(closed.report.add).toEqual([]);
    expect(closed.skipped).toEqual(['the new stickies: this sticky’s settings don’t let the AI add stickies']);
  });

  it('ticks off and adds to the checklist and sources only when the sticky allows it', () => {
    const checklist = [
      { id: 'c1', text: 'Read the call', done: false },
      { id: 'c2', text: 'Ask about budget', done: false },
    ];
    const links = [{ id: 'l1', url: 'https://nsf.gov/a', verified: true }];
    const changes = { checklist: { tick: ['c1', 'ask ABOUT budget'], add: ['Email the PO', 'read the call'] }, sources: [{ url: 'https://nsf.gov/a' }, { url: 'https://nsf.gov/b', label: 'FAQ' }] };
    const editable = buildAiReport(board(note({ ai: { ...ai, mayEdit: true }, checklist, links })), input(changes), now, () => 'new');
    expect(editable.report.checklist).toEqual([
      { id: 'c1', text: 'Read the call', done: true },
      { id: 'c2', text: 'Ask about budget', done: true },
      { id: 'new', text: 'Email the PO', done: false },
    ]);
    expect(editable.report.links).toEqual([...links, { id: 'new', url: 'https://nsf.gov/b', label: 'FAQ', verified: false }]);

    const locked = buildAiReport(board(note({ ai, checklist, links })), input(changes), now, ids);
    expect(locked.report.checklist).toBeUndefined();
    expect(locked.report.links).toBeUndefined();
    expect(locked.skipped).toEqual(['the checklist and source changes: this sticky’s settings don’t let the AI change them']);
  });

  it('refuses a sticky that isn’t there or isn’t handed to the AI', () => {
    expect(() => buildAiReport(board(), input({}), now)).toThrow(AiReportError);
    expect(() => buildAiReport(board(note({})), input({}), now)).toThrow('isn’t handed to the AI helper');
  });

  it('can say the task didn’t work', () => {
    const built = buildAiReport(board(note({ ai })), input({ status: 'error', summary: 'grants.gov was down.' }), now, ids);
    expect(built.report.run).toMatchObject({ status: 'error', summary: 'grants.gov was down.' });
  });
});
