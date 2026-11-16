import { describe, expect, it } from 'vitest';
import { composeEnd, endAfter, moveStart, noteSpan, spanDays, spanLabel, spanNow, spanOnDay, spanOver } from './spans.ts';

const at = (local: string) => new Date(local).toISOString();
const span = (start: string, end?: string) => noteSpan({ start, end })!;

describe('noteSpan', () => {
  it('reads all-day and timed spans, and leaves out an end that doesn’t fit', () => {
    expect(noteSpan({})).toBeNull();
    expect(span('2026-11-18', '2026-11-20').end?.allDay).toBe(true);
    expect(span('2026-11-18', '2026-11-18').end).not.toBeNull();
    expect(span('2026-11-18', '2026-11-17').end).toBeNull();
    expect(span(at('2026-11-18T14:30'), at('2026-11-18T14:00')).end).toBeNull();
    expect(span(at('2026-11-18T14:30'), '2026-11-19').end).toBeNull();
  });
});

describe('spanLabel and spanOnDay', () => {
  it('says the times, or the days', () => {
    expect(spanLabel(span('2026-11-18'))).toBe('All day');
    expect(spanLabel(span(at('2026-11-18T14:30'), at('2026-11-18T15:30')))).toBe('2:30 – 3:30 PM');
    expect(spanLabel(span(at('2026-11-18T11:00'), at('2026-11-18T13:00')))).toBe('11 AM – 1 PM');
    expect(spanLabel(span(at('2026-11-18T14:30')))).toBe('2:30 PM');
    expect(spanLabel(span(at('2026-11-18T14:30'), at('2026-11-18T15:30')), { date: true })).toBe('Wed, Nov 18 · 2:30 – 3:30 PM');
    expect(spanLabel(span('2026-11-18', '2026-11-20'))).toBe('Nov 18 – 20');
    expect(spanLabel(span('2026-11-30', '2026-12-02'))).toBe('Nov 30 – Dec 2');
    expect(spanLabel(span(at('2026-11-18T09:00'), at('2026-11-20T17:00')))).toBe('Nov 18, 9 AM – Nov 20, 5 PM');
  });

  it('says how a long one stands on each of its days', () => {
    const trip = span(at('2026-11-18T09:00'), at('2026-11-20T17:00'));
    expect(spanOnDay(trip, new Date('2026-11-18T12:00'))).toBe('from 9 AM');
    expect(spanOnDay(trip, new Date('2026-11-19T12:00'))).toBe('all day');
    expect(spanOnDay(trip, new Date('2026-11-20T12:00'))).toBe('until 5 PM');
    const conference = span('2026-11-18', '2026-11-20');
    expect(spanOnDay(conference, new Date('2026-11-19T12:00'))).toBe('until Nov 20');
    expect(spanOnDay(conference, new Date('2026-11-20T12:00'))).toBe('last day');
    expect(spanOnDay(span('2026-11-18'), new Date('2026-11-18T12:00'))).toBeNull();
  });
});

describe('spanDays, spanNow and spanOver', () => {
  it('covers each day, but not the morning after one that ends at midnight', () => {
    expect(spanDays(span('2026-11-30', '2026-12-02'))).toEqual(['2026-11-30', '2026-12-01', '2026-12-02']);
    expect(spanDays(span(at('2026-11-18T20:00'), at('2026-11-19T00:00')))).toEqual(['2026-11-18']);
    expect(spanDays(span(at('2026-11-18T14:30')))).toEqual(['2026-11-18']);
    expect(spanDays(span('2026-01-01', '2062-01-01'))).toHaveLength(62);
  });

  it('knows when it’s on and when it’s over', () => {
    const meeting = span(at('2026-11-18T14:30'), at('2026-11-18T15:30'));
    expect(spanNow(meeting, new Date('2026-11-18T15:00'))).toBe(true);
    expect(spanOver(meeting, new Date('2026-11-18T15:31'))).toBe(true);
    const conference = span('2026-11-18', '2026-11-20');
    expect(spanNow(conference, new Date('2026-11-20T23:00'))).toBe(true);
    expect(spanOver(conference, new Date('2026-11-21T00:01'))).toBe(true);
    expect(spanNow(conference, new Date('2026-11-17T23:00'))).toBe(false);
  });
});

describe('editing', () => {
  it('moves the end with the start, keeping the length', () => {
    expect(moveStart({ start: '2026-11-18', end: '2026-11-20' }, '2026-11-25')).toEqual({ start: '2026-11-25', end: '2026-11-27' });
    const meeting = { start: at('2026-11-18T14:30'), end: at('2026-11-18T15:30') };
    expect(moveStart(meeting, at('2026-11-19T09:00'))).toEqual({ start: at('2026-11-19T09:00'), end: at('2026-11-19T10:00') });
    // Switching between all day and a time drops the end; clearing the start clears both.
    expect(moveStart(meeting, '2026-11-19')).toEqual({ start: '2026-11-19', end: undefined });
    expect(moveStart(meeting, undefined)).toEqual({ start: undefined, end: undefined });
  });

  it('makes the end from the date and time boxes', () => {
    const start = at('2026-11-18T14:30');
    expect(composeEnd(start, '', '15:30')).toBe(at('2026-11-18T15:30'));
    expect(composeEnd(start, '2026-11-20', '')).toBe(at('2026-11-20T14:30'));
    expect(composeEnd(start, '', '')).toBeUndefined();
    expect(composeEnd('2026-11-18', '2026-11-20', '')).toBe('2026-11-20');
    expect(composeEnd(undefined, '2026-11-20', '10:00')).toBeUndefined();
    expect(endAfter(start, 60)).toBe(at('2026-11-18T15:30'));
    expect(endAfter('2026-11-18', 60)).toBeUndefined();
  });
});
