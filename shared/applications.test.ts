import { describe, expect, it } from 'vitest';
import { applicationKicker, isTemplateChecklist, stageLabel, templateChecklist } from './applications.ts';
import { datedNotes, noteWhen } from './board.ts';
import { goalValue } from './goals.ts';
import type { Goal, Note } from './types.ts';

function app(fields: Partial<Note> = {}): Note {
  return {
    id: 'a1',
    laneId: 'apps',
    title: 'Research Scientist',
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

let n = 0;
const makeId = () => `c${++n}`;

describe('application types', () => {
  it('names a good outcome and the interview stage in each type’s words', () => {
    expect(stageLabel('Awarded', 'grant')).toBe('Awarded');
    expect(stageLabel('Awarded', 'job')).toBe('Offer');
    expect(stageLabel('Awarded', 'school')).toBe('Accepted');
    expect(stageLabel('Interview', 'job')).toBe('Interview');
    expect(stageLabel('Interview', 'grant')).toBe('Shortlisted');
    expect(stageLabel('Drafting', undefined)).toBe('Drafting');
  });

  it('puts the type in front of the stage on squares, except for grants', () => {
    expect(applicationKicker({ appType: 'job', stage: 'Interview' })).toBe('Job · Interview');
    expect(applicationKicker({ appType: 'fellowship' })).toBe('Fellowship');
    expect(applicationKicker({ appType: 'grant', stage: 'Drafting' })).toBe('Drafting');
    expect(applicationKicker({ stage: 'Submitted' })).toBe('Submitted');
    expect(applicationKicker({})).toBeUndefined();
  });

  it('only swaps a checklist that is still the untouched template', () => {
    const grant = templateChecklist('grant', makeId);
    expect(isTemplateChecklist(grant, 'grant')).toBe(true);
    expect(isTemplateChecklist(grant, undefined)).toBe(true); // older applications started as grants
    expect(isTemplateChecklist(grant, 'job')).toBe(false);
    expect(isTemplateChecklist(grant.map((item, i) => (i === 0 ? { ...item, done: true } : item)), 'grant')).toBe(false);
    expect(isTemplateChecklist([...grant, { id: 'x', text: 'Extra', done: false }], 'grant')).toBe(false);
    expect(isTemplateChecklist([], 'grant')).toBe(false);
  });

  it('counts awarded grants and fellowships as money won, not job salaries', () => {
    const goal: Goal = { id: 'g', title: 'Win $10k', measure: 'won', target: 10_000, count: 0, createdAt: '2026-01-01T00:00:00.000Z' };
    const notes = [
      app({ id: '1', appType: 'grant', stage: 'Awarded', amount: '$1,500' }),
      app({ id: '2', appType: 'fellowship', stage: 'Awarded', amount: '$2,000' }),
      app({ id: '3', stage: 'Awarded', amount: '$500' }),
      app({ id: '4', appType: 'job', stage: 'Awarded', amount: '$120k' }),
      app({ id: '5', appType: 'grant', stage: 'Submitted', amount: '$9,000' }),
    ];
    expect(goalValue(goal, notes)).toBe(4000);
  });

  it('stops counting down a submitted application but still shows its reminder', () => {
    const interview = app({ appType: 'job', stage: 'Interview', due: '2026-09-20', remindAt: '2026-10-06T18:00:00.000Z' });
    expect(noteWhen(interview)).toMatchObject({ kind: 'remind' });
    expect(noteWhen(app({ stage: 'Submitted', due: '2026-09-20' }))).toBeNull();
    expect(datedNotes([interview]).map(item => item.kind)).toEqual(['remind']);
  });
});
