import { addDays, addMonths, endOfMonth, format, getDay, set, startOfDay, startOfWeek } from 'date-fns';
import { DEFAULT_LANES } from './defaults.ts';
import type { Board, ChecklistItem, Goal, Note, SourceLink } from './types.ts';

// Sample board for the preview page and `npm run demo`. Dates are relative to "now"
// so it always looks current.

const dateOnly = (d: Date) => format(d, 'yyyy-MM-dd');
const at = (d: Date, hours: number, minutes = 0) =>
  set(d, { hours, minutes, seconds: 0, milliseconds: 0 }).toISOString();

let counter = 0;
const id = (prefix: string) => `${prefix}${++counter}`;
const items = (list: Array<[string, boolean]>): ChecklistItem[] =>
  list.map(([text, done]) => ({ id: id('c'), text, done }));
const link = (url: string, label: string, verified: boolean): SourceLink => ({ id: id('l'), url, label, verified });

export function makeSampleBoard(now: Date): Board {
  counter = 0;
  const day = (offset: number) => addDays(now, offset);
  const stamp = (offset: number) => at(day(offset), 9);
  const base = { body: '', checklist: [], links: [], pinned: false, done: false };

  const note = (fields: Partial<Note> & Pick<Note, 'laneId' | 'title'>, createdDaysAgo: number): Note => ({
    ...base,
    id: id('n'),
    createdAt: stamp(-createdDaysAgo),
    updatedAt: stamp(-createdDaysAgo),
    ...fields,
  });

  // Recurring tasks log each "Did it". These fill in the days of the current week
  // before today (most recent first), so the preview looks lived-in on any day.
  const weekStart = startOfWeek(now);
  const earlierThisWeek = (max: number, hour: number) => {
    const out: string[] = [];
    for (let d = addDays(startOfDay(now), -1); d >= weekStart && out.length < max; d = addDays(d, -1)) out.push(at(d, hour));
    return out;
  };
  const monday = addDays(weekStart, 1);

  const notes: Note[] = [
    note(
      {
        laneId: 'apps',
        title: 'NSF CAREER proposal',
        funder: 'NSF',
        amount: '$500,000',
        stage: 'Drafting',
        due: dateOnly(day(3)),
        pinned: true,
        body: 'Send the full draft to Dr. Kim for a read-through before submitting.',
        checklist: items([
          ['Confirm eligibility', true],
          ['Project summary', true],
          ['Budget + justification', false],
          ['3 letters of collaboration', false],
          ['Submit on Research.gov', false],
        ]),
        links: [
          link('https://www.nsf.gov/funding/opportunities/career', 'Program page', true),
          link('https://www.nsf.gov/bfa/dias/policy/papp', 'Budget cap FAQ', false),
        ],
      },
      12,
    ),
    note(
      {
        laneId: 'apps',
        title: 'NIH R01 resubmission',
        funder: 'NIH',
        amount: '$1.2M over 5 yrs',
        stage: 'Researching',
        due: at(day(15), 17),
        checklist: items([
          ['Read summary statement', true],
          ['Introduction page', false],
          ['Rewrite specific aims', false],
        ]),
        links: [link('https://grants.nih.gov/grants/how-to-apply-application-guide.html', 'Application guide', false)],
      },
      20,
    ),
    note(
      {
        laneId: 'apps',
        title: 'Gates Grand Challenges',
        funder: 'Gates Foundation',
        amount: '$100,000',
        stage: 'Researching',
        due: dateOnly(day(31)),
        checklist: items([
          ['Read the RFP', false],
          ['2-page concept note', false],
        ]),
      },
      5,
    ),
    note(
      {
        laneId: 'apps',
        title: 'City arts micro-grant',
        funder: 'City Arts Council',
        amount: '$2,500',
        stage: 'Submitted',
        due: dateOnly(day(-2)),
      },
      30,
    ),
    note(
      {
        laneId: 'apps',
        title: 'Dept. travel grant',
        funder: 'Graduate School',
        amount: '$1,500',
        stage: 'Awarded',
        due: dateOnly(day(-20)),
      },
      45,
    ),
    note(
      {
        laneId: 'check',
        title: 'Is the NSF budget cap before or after indirect costs?',
        due: dateOnly(day(2)),
        links: [link('https://www.nsf.gov/bfa/dias/policy/papp', 'NSF PAPPG', false)],
      },
      3,
    ),
    note(
      {
        laneId: 'check',
        title: 'R01 page limit for Research Strategy',
        due: dateOnly(day(10)),
        links: [link('https://grants.nih.gov/grants/how-to-apply-application-guide/format-and-write/page-limits.htm', 'NIH page limits', false)],
      },
      4,
    ),
    note(
      {
        laneId: 'check',
        title: 'CAREER eligibility: early-career rule',
        links: [link('https://www.nsf.gov/funding/opportunities/career', 'Solicitation', true)],
        done: true,
        doneAt: at(now, 8),
      },
      6,
    ),
    note(
      {
        laneId: 'todo',
        title: 'Email program officer about CAREER scope',
        due: dateOnly(day(1)),
      },
      2,
    ),
    note(
      {
        laneId: 'todo',
        title: 'Ask Dr. Lee for a support letter',
        due: dateOnly(day(5)),
        checklist: items([
          ['Send draft letter', false],
          ['Follow up', false],
        ]),
      },
      2,
    ),
    note(
      {
        laneId: 'todo',
        title: 'Update CV + biosketch',
        body: 'NSF wants the SciENcv format now.',
      },
      8,
    ),
    note(
      {
        laneId: 'routine',
        title: 'Search Grants.gov for new calls',
        repeat: { every: 'week', times: 1, days: [1] },
        // Done on Monday, so it rests for the rest of the week.
        completions: getDay(now) > 1 ? [at(monday, 9, 15)] : [],
      },
      40,
    ),
    note(
      {
        laneId: 'routine',
        title: 'Write for an hour',
        repeat: { every: 'week', times: 5 },
        completions: earlierThisWeek(3, 20),
      },
      40,
    ),
    note(
      {
        laneId: 'routine',
        title: 'Update the funding tracker',
        repeat: { every: 'week', times: 1, days: [5] },
        completions: [],
      },
      30,
    ),
    note(
      {
        laneId: 'routine',
        title: 'Check email for funder replies',
        repeat: { every: 'day', times: 1 },
        completions: earlierThisWeek(2, 9),
      },
      30,
    ),
    note(
      {
        laneId: 'remind',
        title: 'Call the financial office',
        remindAt: at(day(1), 10),
      },
      1,
    ),
    note(
      {
        laneId: 'remind',
        title: 'Dentist',
        remindAt: at(day(4), 15, 30),
      },
      7,
    ),
  ];

  const goals: Goal[] = [
    {
      id: 'g1',
      title: 'Submit 5 applications',
      measure: 'submitted',
      target: 5,
      count: 0,
      by: dateOnly(endOfMonth(addMonths(now, 3))),
      createdAt: stamp(-30),
    },
    { id: 'g2', title: 'Win $10,000 in funding', measure: 'won', target: 10_000, count: 0, createdAt: stamp(-30) },
    {
      id: 'g3',
      title: 'Talk to 10 program officers',
      measure: 'count',
      target: 10,
      count: 4,
      by: dateOnly(endOfMonth(addMonths(now, 1))),
      createdAt: stamp(-20),
    },
  ];

  return {
    lanes: DEFAULT_LANES.map(lane => ({ ...lane })),
    notes,
    goals,
    settings: {
      // The sample starts in day mode so it looks the same at any hour; a real board
      // defaults to 'auto' (10 PM–7 AM).
      night: { mode: 'off', start: '22:00', end: '07:00', style: 'dim' },
      wall: { showConnect: false, chime: true, alertMinutes: 60 },
    },
    alerts: [],
  };
}

/** Placeholder address for the "connect your phone" code on the preview page. */
export const SAMPLE_CONNECT_URL = 'http://192.168.1.50:3000';
