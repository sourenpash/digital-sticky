import { describe, expect, it } from 'vitest';
import { composeWhen, countdownLabel, inTimeWindow, parseWhen, splitWhen, urgencyOf } from './dates.ts';

const at = (iso: string) => new Date(iso);

describe('parseWhen', () => {
  it('treats YYYY-MM-DD as a local all-day date', () => {
    const when = parseWhen('2026-10-03');
    expect(when?.allDay).toBe(true);
    expect(when?.date.getDate()).toBe(3);
    expect(when?.date.getHours()).toBe(0);
  });

  it('keeps full date-times as instants', () => {
    const when = parseWhen('2026-10-03T21:00:00.000Z');
    expect(when?.allDay).toBe(false);
    expect(when?.date.getHours()).toBe(17); // 5 PM in New York (EDT)
  });

  it('rejects junk', () => {
    expect(parseWhen('not a date')).toBeNull();
    expect(parseWhen(undefined)).toBeNull();
  });
});

describe('countdownLabel', () => {
  const evening = at('2026-09-30T22:42:00'); // local time, Wednesday evening

  it('counts calendar days, not 24h blocks', () => {
    expect(countdownLabel(parseWhen('2026-10-01')!, evening)).toBe('Tomorrow');
    expect(countdownLabel(parseWhen('2026-10-03')!, evening)).toBe('3 days');
  });

  it('labels today and overdue', () => {
    expect(countdownLabel(parseWhen('2026-09-30')!, evening)).toBe('Today');
    expect(countdownLabel(parseWhen('2026-09-29')!, evening)).toBe('1 day overdue');
    expect(countdownLabel(parseWhen('2026-09-27')!, evening)).toBe('3 days overdue');
  });

  it('shows times for timed deadlines and flags ones that passed today', () => {
    const fivePm = parseWhen(at('2026-10-01T17:00:00').toISOString())!;
    expect(countdownLabel(fivePm, evening)).toBe('Tomorrow 5 PM');
    const earlier = parseWhen(at('2026-09-30T17:00:00').toISOString())!;
    expect(countdownLabel(earlier, evening)).toBe('Overdue');
    expect(urgencyOf(earlier, evening)).toBe('overdue');
  });
});

describe('urgencyOf', () => {
  const now = at('2026-09-30T09:00:00');
  it('buckets by days left', () => {
    expect(urgencyOf(parseWhen('2026-09-30')!, now)).toBe('today');
    expect(urgencyOf(parseWhen('2026-10-03')!, now)).toBe('soon');
    expect(urgencyOf(parseWhen('2026-10-07')!, now)).toBe('week');
    expect(urgencyOf(parseWhen('2026-10-20')!, now)).toBe('later');
  });
});

describe('inTimeWindow', () => {
  it('handles windows that cross midnight', () => {
    expect(inTimeWindow(at('2026-09-30T23:15:00'), '22:00', '07:00')).toBe(true);
    expect(inTimeWindow(at('2026-09-30T06:59:00'), '22:00', '07:00')).toBe(true);
    expect(inTimeWindow(at('2026-09-30T07:00:00'), '22:00', '07:00')).toBe(false);
    expect(inTimeWindow(at('2026-09-30T13:00:00'), '22:00', '07:00')).toBe(false);
  });
});

describe('composeWhen / splitWhen', () => {
  it('round-trips date-only and timed values in local time', () => {
    expect(composeWhen('2026-10-03', '')).toBe('2026-10-03');
    expect(splitWhen('2026-10-03')).toEqual({ date: '2026-10-03', time: '' });
    const timed = composeWhen('2026-10-03', '17:30');
    expect(splitWhen(timed)).toEqual({ date: '2026-10-03', time: '17:30' });
    expect(composeWhen('', '17:30')).toBeUndefined();
  });
});
