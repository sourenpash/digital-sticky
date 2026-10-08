import { describe, expect, it } from 'vitest';
import { parseTextCommand } from './textCommands.ts';

const now = new Date('2026-09-30T19:42:00'); // a Wednesday evening
const parse = (text: string) => parseTextCommand(text, now);

describe('texting the board', () => {
  it('finishes the sticky it just reminded you about, or one you name', () => {
    expect(parse('done')).toEqual({ type: 'done' });
    expect(parse('Done!')).toEqual({ type: 'done' });
    expect(parse('did it')).toEqual({ type: 'done' });
    expect(parse('👍')).toEqual({ type: 'done' });
    expect(parse('done NSF budget')).toEqual({ type: 'done', what: 'NSF budget' });
  });

  it('snoozes for a while, until tonight, tomorrow or a weekday', () => {
    expect(parse('snooze')).toEqual({ type: 'snooze', until: new Date('2026-09-30T20:42:00'), label: '1 hour' });
    expect(parse('snooze 10m')).toMatchObject({ until: new Date('2026-09-30T19:52:00'), label: '10 min' });
    expect(parse('snooze 30 minutes')).toMatchObject({ until: new Date('2026-09-30T20:12:00'), label: '30 min' });
    expect(parse('snooze 2h')).toMatchObject({ until: new Date('2026-09-30T21:42:00'), label: '2 hours' });
    expect(parse('Snooze 1.5 hours.')).toMatchObject({ until: new Date('2026-09-30T21:12:00') });
    expect(parse('remind me in an hour')).toMatchObject({ until: new Date('2026-09-30T20:42:00') });
    expect(parse('snooze tonight')).toMatchObject({ until: new Date('2026-09-30T20:00:00'), label: 'tonight' });
    expect(parse('snooze tomorrow')).toMatchObject({ until: new Date('2026-10-01T09:00:00'), label: 'tomorrow' });
    expect(parse('snooze friday')).toMatchObject({ until: new Date('2026-10-02T09:00:00'), label: 'Friday' });
    expect(parse('snooze wed')).toMatchObject({ until: new Date('2026-10-07T09:00:00'), label: 'Wednesday' });
    expect(parse('snooze 1h NSF')).toMatchObject({ what: 'nsf' });
    expect(parse('snooze forever')).toEqual({ type: 'unknown' });
    expect(parse('snooze 900 hours')).toEqual({ type: 'unknown' });
  });

  it('adds a to-do, with a deadline when the end says when', () => {
    expect(parse('add call NSF friday')).toEqual({ type: 'add', title: 'Call NSF', due: '2026-10-02' });
    expect(parse('add Call NSF by friday')).toEqual({ type: 'add', title: 'Call NSF', due: '2026-10-02' });
    expect(parse('add renew passport wednesday')).toEqual({ type: 'add', title: 'Renew passport', due: '2026-09-30' });
    expect(parse('add renew passport next wednesday')).toEqual({ type: 'add', title: 'Renew passport', due: '2026-10-07' });
    expect(parse('add pay rent tomorrow')).toEqual({ type: 'add', title: 'Pay rent', due: '2026-10-01' });
    expect(parse('add submit report oct 14')).toEqual({ type: 'add', title: 'Submit report', due: '2026-10-14' });
    expect(parse('add submit report Sept 3rd')).toEqual({ type: 'add', title: 'Submit report', due: '2027-09-03' });
    expect(parse('add submit report 10/14')).toEqual({ type: 'add', title: 'Submit report', due: '2026-10-14' });
    expect(parse('add submit report 2027-01-05')).toEqual({ type: 'add', title: 'Submit report', due: '2027-01-05' });
    expect(parse('add email Dr. Kim about the budget')).toEqual({ type: 'add', title: 'Email Dr. Kim about the budget' });
    // A date alone isn't a to-do.
    expect(parse('add friday')).toEqual({ type: 'add', title: 'Friday' });
    expect(parse('add 2/30')).toEqual({ type: 'add', title: '2/30' });
    expect(parse('add')).toEqual({ type: 'unknown' });
  });

  it('answers today and help, and says when it didn’t get it', () => {
    expect(parse('Today')).toEqual({ type: 'today' });
    expect(parse("what's due?")).toEqual({ type: 'today' });
    expect(parse('help')).toEqual({ type: 'help' });
    expect(parse('?')).toEqual({ type: 'help' });
    expect(parse('hello there')).toEqual({ type: 'unknown' });
  });
});
