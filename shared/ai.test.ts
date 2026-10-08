import { describe, expect, it } from 'vitest';
import { AI_AGENT_PROMPT, aiDue, aiKicker, defaultAiTask, describeAiSchedule, nextAiRun, wakeText } from './ai.ts';
import type { AiRun, AiTask } from './types.ts';

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

describe('when the AI has work', () => {
  const run = (at: string): AiRun => ({ id: at, at: new Date(at).toISOString(), status: 'done', summary: '', links: [], added: [] });
  const sticky = (ai: Partial<AiTask>, aiLog: AiRun[] = []) => ({
    ai: { ...daily, since: new Date('2026-09-20T12:00:00').toISOString(), ...ai },
    aiLog,
    done: false,
    createdAt: new Date('2026-09-01T12:00:00').toISOString(),
  });

  it('is due at each scheduled time it hasn’t run since', () => {
    // Every day at 8: last ran yesterday at 8, so today's 8 AM is due.
    expect(aiDue(sticky({}, [run('2026-09-29T08:01:00')]), now)).toBe(true);
    expect(aiDue(sticky({}, [run('2026-09-30T08:01:00')]), now)).toBe(false);
    // Handed over this evening: the first check is tomorrow at 8.
    expect(aiDue(sticky({ since: new Date('2026-09-30T19:00:00').toISOString() }), now)).toBe(false);
    expect(aiDue(sticky({ since: new Date('2026-09-30T19:00:00').toISOString() }), new Date('2026-10-01T08:00:00'))).toBe(true);
    // Every Monday at 8, on a Wednesday: due if it hasn't run since Monday.
    expect(aiDue(sticky({ schedule: 'weekly', weekday: 1 }, [run('2026-09-22T08:00:00')]), now)).toBe(true);
    expect(aiDue(sticky({ schedule: 'weekly', weekday: 1 }, [run('2026-09-28T09:00:00')]), now)).toBe(false);
    // Every Wednesday at 9 PM, on Wednesday at 7:42 PM: not yet.
    expect(aiDue(sticky({ schedule: 'weekly', weekday: 3, time: '21:00' }, [run('2026-09-24T21:00:00')]), now)).toBe(false);
  });

  it('does a one-time task once, at its time', () => {
    expect(aiDue(sticky({ schedule: 'once', since: new Date('2026-09-30T07:00:00').toISOString() }), now)).toBe(true);
    expect(aiDue(sticky({ schedule: 'once', since: new Date('2026-09-30T09:00:00').toISOString() }), now)).toBe(false); // tomorrow 8 AM
    expect(aiDue(sticky({ schedule: 'once', since: new Date('2026-09-30T07:00:00').toISOString() }, [run('2026-09-30T08:00:00')]), now)).toBe(false);
  });

  it('is due when Run now was tapped since the last run, and never once the sticky is done', () => {
    const asked = new Date('2026-09-30T19:40:00').toISOString();
    expect(aiDue(sticky({ requestedAt: asked }, [run('2026-09-30T08:01:00')]), now)).toBe(true);
    expect(aiDue(sticky({ requestedAt: asked }, [run('2026-09-30T19:41:00')]), now)).toBe(false);
    expect(aiDue({ ...sticky({ requestedAt: asked }), done: true }, now)).toBe(false);
    expect(aiDue({ ...sticky({}), ai: undefined }, now)).toBe(false);
    // Boards from before: it counts from when the sticky was made.
    expect(aiDue({ ...sticky({}), ai: { ...daily } }, now)).toBe(true);
  });

  it('wakes an AI with the stickies that are due', () => {
    const text = wakeText([{ id: 'n1', title: 'Check grants.gov' }], false);
    expect(text).toBe('Sticky Wall: a task is due.\n- "Check grants.gov" (sticky n1)\nCall list_ai_tasks to get it, then report_ai_run for each.');
    const full = wakeText(
      [
        { id: 'n1', title: 'Check grants.gov' },
        { id: 'n2', title: ' ' },
      ],
      true,
    );
    expect(full).toContain('2 tasks are due');
    expect(full).toContain('"Untitled note" (sticky n2)');
    expect(full.endsWith(AI_AGENT_PROMPT)).toBe(true);
  });
});
