import { describe, expect, it } from 'vitest';
import { formatMoney, goalProgress, parseAmount } from './goals.ts';
import type { Goal, Note } from './types.ts';

const now = new Date('2026-09-30T19:42:00');

function app(stage: Note['stage'], amount?: string): Note {
  return {
    id: `n-${stage}-${amount}`,
    laneId: 'apps',
    title: 'Application',
    body: '',
    checklist: [],
    links: [],
    pinned: false,
    done: false,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    stage,
    amount,
  };
}

const goal = (fields: Partial<Goal>): Goal => ({
  id: 'g1',
  title: 'Goal',
  measure: 'submitted',
  target: 5,
  count: 0,
  createdAt: new Date('2026-08-31T12:00').toISOString(),
  ...fields,
});

describe('parseAmount', () => {
  it('reads common ways of writing money', () => {
    expect(parseAmount('$500,000')).toBe(500_000);
    expect(parseAmount('$1.2M over 5 yrs')).toBe(1_200_000);
    expect(parseAmount('$2,500')).toBe(2_500);
    expect(parseAmount('€10k')).toBe(10_000);
    expect(parseAmount('Up to 3 years of $50k')).toBe(50_000);
    expect(parseAmount('25000')).toBe(25_000);
  });

  it('returns null when there is no figure', () => {
    expect(parseAmount('Full tuition')).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });
});

describe('formatMoney', () => {
  it('formats full and compact amounts', () => {
    expect(formatMoney(1500)).toBe('$1,500');
    expect(formatMoney(1500, true)).toBe('$1.5k');
    expect(formatMoney(10_000, true)).toBe('$10k');
    expect(formatMoney(1_200_000, true)).toBe('$1.2M');
    expect(formatMoney(950, true)).toBe('$950');
  });
});

describe('goalProgress', () => {
  const notes = [app('Drafting'), app('Submitted', '$2,500'), app('Awarded', '$1,500'), app('Declined', '$9,000')];

  it('counts submitted, awarded and declined applications', () => {
    const progress = goalProgress(goal({ measure: 'submitted', target: 5 }), notes, now);
    expect(progress.value).toBe(3);
    expect(progress.label).toBe('3 of 5');
    expect(progress.ratio).toBeCloseTo(0.6);
  });

  it('adds up money from awarded applications only', () => {
    const progress = goalProgress(goal({ measure: 'won', target: 10_000 }), notes, now, { compact: true });
    expect(progress.value).toBe(1_500);
    expect(progress.label).toBe('$1.5k of $10k');
  });

  it('uses the hand-kept count', () => {
    const progress = goalProgress(goal({ measure: 'count', target: 10, count: 4 }), notes, now);
    expect(progress.label).toBe('4 of 10');
    expect(progress.complete).toBe(false);
  });

  it('shows time left and where an even pace would be', () => {
    const progress = goalProgress(goal({ by: '2026-12-31' }), notes, now);
    expect(progress.byLabel).toBe('by Dec 31');
    expect(progress.timeLeft).toBe('92 days left');
    expect(progress.pace).toBeCloseTo(30 / 122, 2);
  });

  it('drops the pace mark once the goal is reached', () => {
    const progress = goalProgress(goal({ target: 2, by: '2026-12-31' }), notes, now);
    expect(progress.complete).toBe(true);
    expect(progress.ratio).toBe(1);
    expect(progress.pace).toBeUndefined();
  });
});
