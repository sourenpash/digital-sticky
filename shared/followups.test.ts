import { describe, expect, it } from 'vitest';
import { afterFollowingUp, awaitingReply, defaultFollowUpDays, everyLabel, followUpChoices, followUpDue, isNudgeTime, latestNudge, startFollowUp } from './followups.ts';

const now = new Date('2026-10-06T19:42:00'); // a Tuesday evening
const local = (iso: string) => new Date(iso).toISOString();

describe('follow-ups', () => {
  it('starts at 9 AM on the day chosen, repeating at the same interval', () => {
    expect(startFollowUp(14, now)).toEqual({ at: local('2026-10-20T09:00:00'), everyDays: 14 });
    expect(startFollowUp(3, now)).toEqual({ at: local('2026-10-09T09:00:00'), everyDays: 3 });
  });

  it('offers 3 days only for messages, and suggests a wait that fits', () => {
    expect(followUpChoices({}).map(c => c.label)).toEqual(['1 week', '2 weeks', '1 month']);
    expect(followUpChoices({ channel: 'text' }).map(c => c.days)).toEqual([3, 7, 14, 30]);
    expect(defaultFollowUpDays({})).toBe(14);
    expect(defaultFollowUpDays({ channel: 'email' })).toBe(7);
    expect(defaultFollowUpDays({ channel: 'call' })).toBe(3);
    expect([3, 7, 14, 30].map(everyLabel)).toEqual(['every 3 days', 'every week', 'every 2 weeks', 'every month']);
  });

  it('finds the latest nudge that has come, at the same time of day', () => {
    const followUp = { at: local('2026-09-01T09:00:00'), everyDays: 14 };
    expect(latestNudge(followUp, new Date('2026-08-31T12:00:00'))).toBeNull();
    expect(latestNudge(followUp, new Date('2026-09-01T09:00:00'))?.toISOString()).toBe(local('2026-09-01T09:00:00'));
    expect(latestNudge(followUp, new Date('2026-09-15T08:59:00'))?.toISOString()).toBe(local('2026-09-01T09:00:00'));
    expect(latestNudge(followUp, new Date('2026-09-15T09:00:00'))?.toISOString()).toBe(local('2026-09-15T09:00:00'));
    expect(latestNudge(followUp, now)?.toISOString()).toBe(local('2026-09-29T09:00:00'));
    expect(latestNudge({ ...followUp, everyDays: 0 }, now)?.toISOString()).toBe(followUp.at);
  });

  it('knows its own nudge times', () => {
    const followUp = { at: local('2026-09-01T09:00:00'), everyDays: 7 };
    expect(isNudgeTime(followUp, local('2026-09-01T09:00:00'))).toBe(true);
    expect(isNudgeTime(followUp, local('2026-09-22T09:00:00'))).toBe(true);
    expect(isNudgeTime(followUp, local('2026-09-22T10:00:00'))).toBe(false);
    expect(isNudgeTime(followUp, local('2026-09-23T09:00:00'))).toBe(false);
    expect(isNudgeTime(followUp, local('2026-08-25T09:00:00'))).toBe(false);
    expect(isNudgeTime({ ...followUp, everyDays: 0 }, local('2026-09-08T09:00:00'))).toBe(false);
  });

  it('moves on after "I followed up", or ends a one-time follow-up', () => {
    expect(afterFollowingUp({ at: local('2026-10-01T09:00:00'), everyDays: 7 }, now)).toEqual({ at: local('2026-10-13T09:00:00'), everyDays: 7 });
    expect(afterFollowingUp({ at: local('2026-10-01T09:00:00'), everyDays: 0 }, now)).toBeUndefined();
  });

  it('is due once a nudge time has passed', () => {
    expect(followUpDue({ followUp: { at: local('2026-10-06T09:00:00'), everyDays: 7 } }, now)).toBe(true);
    expect(followUpDue({ followUp: { at: local('2026-10-07T09:00:00'), everyDays: 7 } }, now)).toBe(false);
    expect(followUpDue({}, now)).toBe(false);
  });

  it('waits for a reply on submitted applications and sent messages', () => {
    expect(awaitingReply({ stage: 'Submitted', done: false })).toBe(true);
    expect(awaitingReply({ stage: 'Interview', done: false })).toBe(false);
    expect(awaitingReply({ channel: 'email', done: false })).toBe(false);
    expect(awaitingReply({ channel: 'email', sentAt: now.toISOString(), done: false })).toBe(true);
    expect(awaitingReply({ channel: 'email', sentAt: now.toISOString(), done: true })).toBe(false);
  });
});
