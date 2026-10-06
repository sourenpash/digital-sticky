import { describe, expect, it } from 'vitest';
import { aiKicker, defaultAiTask, describeAiSchedule, nextAiRun } from './ai.ts';
import type { AiTask } from './types.ts';

const now = new Date('2026-09-30T19:42:00'); // a Wednesday evening
const daily: AiTask = { instructions: 'x', schedule: 'daily', time: '08:00', mayAdd: true, mayEdit: false };

describe('AI helper settings', () => {
  it('starts from the sticky’s own words and rhythm', () => {
    expect(defaultAiTask({ title: ' Check grants.gov ', body: 'Neuroscience only.' })).toEqual({
      instructions: 'Check grants.gov\n\nNeuroscience only.',
      schedule: 'once',
      time: '08:00',
      mayAdd: true,
      mayEdit: false,
    });
    expect(defaultAiTask({ title: 'Scan calls', body: '', repeat: { every: 'week', times: 1, days: [5] } })).toMatchObject({ schedule: 'weekly', weekday: 5 });
    expect(defaultAiTask({ title: 'Scan calls', body: '', repeat: { every: 'day', times: 1 } })).toMatchObject({ schedule: 'daily' });
  });

  it('describes the schedule and finds the next run', () => {
    expect(describeAiSchedule(daily)).toBe('Every day at 8 AM');
    expect(describeAiSchedule({ ...daily, schedule: 'weekly', weekday: 1, time: '07:30' })).toBe('Every Monday at 7:30 AM');
    expect(describeAiSchedule({ ...daily, schedule: 'once' })).toBe('Once, at 8 AM');
    expect(nextAiRun(daily, undefined, now)).toEqual(new Date('2026-10-01T08:00:00'));
    expect(nextAiRun({ ...daily, time: '21:00' }, undefined, now)).toEqual(new Date('2026-09-30T21:00:00'));
    expect(nextAiRun({ ...daily, schedule: 'weekly', weekday: 3 }, undefined, now)).toEqual(new Date('2026-10-07T08:00:00'));
    expect(nextAiRun({ ...daily, schedule: 'weekly', weekday: 1 }, undefined, now)).toEqual(new Date('2026-10-05T08:00:00'));
    expect(nextAiRun({ ...daily, schedule: 'once' }, undefined, now)).toEqual(new Date('2026-10-01T08:00:00'));
    expect(nextAiRun({ ...daily, schedule: 'once' }, '2026-09-30T12:00:00.000Z', now)).toBeNull();
  });

  it('says on the square when it last checked', () => {
    const run = { id: 'r', status: 'done' as const, summary: '', links: [], added: [] };
    expect(aiKicker({ ai: daily }, now)).toBe('AI · daily 8 AM');
    expect(aiKicker({ ai: { ...daily, schedule: 'weekly', weekday: 1 } }, now)).toBe('AI · Mondays');
    expect(aiKicker({ ai: daily, aiLog: [{ ...run, at: new Date('2026-09-30T08:00:00').toISOString() }] }, now)).toBe('AI · checked 8 AM');
    expect(aiKicker({ ai: daily, aiLog: [{ ...run, at: new Date('2026-09-28T08:00:00').toISOString() }] }, now)).toBe('AI · checked Mon 8 AM');
    expect(aiKicker({ ai: daily, aiState: { status: 'running', since: now.toISOString() } }, now)).toBe('AI · checking now');
    expect(aiKicker({}, now)).toBeUndefined();
  });
});
