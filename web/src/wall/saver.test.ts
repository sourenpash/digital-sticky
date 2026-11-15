import { describe, expect, it } from 'vitest';
import type { SaverSettings } from '../../../shared/types.ts';
import { saverDue } from './saver.ts';

const saver: SaverSettings = { every: 60, length: 5, sleep: true, sleepStart: '01:00', sleepEnd: '09:00' };
const at = (time: string) => new Date(`2026-11-14T${time}:00`);

describe('saverDue', () => {
  it('is on all through the sleep hours', () => {
    expect(saverDue(saver, at('01:00'))).toBe('sleep');
    expect(saverDue(saver, at('04:30'))).toBe('sleep');
    expect(saverDue(saver, at('08:59'))).toBe('sleep');
    expect(saverDue(saver, at('09:30'))).toBe(null);
    expect(saverDue(saver, at('00:30'))).toBe(null);
  });

  it('takes a break at the start of each period', () => {
    expect(saverDue(saver, at('14:00'))).toBe('break');
    expect(saverDue(saver, at('14:04'))).toBe('break');
    expect(saverDue(saver, at('14:05'))).toBe(null);
    expect(saverDue({ ...saver, every: 30, length: 2 }, at('14:31'))).toBe('break');
    expect(saverDue({ ...saver, every: 30, length: 2 }, at('14:32'))).toBe(null);
  });

  it('can be switched off', () => {
    const off = { ...saver, every: 0, sleep: false };
    expect(saverDue(off, at('03:00'))).toBe(null);
    expect(saverDue(off, at('14:00'))).toBe(null);
  });

  it('has no breaks when one would last the whole gap', () => {
    expect(saverDue({ ...saver, every: 5, length: 5 }, at('14:01'))).toBe(null);
  });
});
