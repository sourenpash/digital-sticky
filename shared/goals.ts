import { differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';
import { parseWhen } from './dates.ts';
import { FINISHED_STAGES, type Goal, type Note } from './types.ts';

const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?)\s*(k|m|mil|million|thousand|b|bn|billion)?\b`;
const WITH_CURRENCY = new RegExp(String.raw`[$€£¥]\s*${NUMBER}`, 'i');
const ANY = new RegExp(NUMBER, 'i');
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mil: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/**
 * Reads an application's free-text amount as a number: "$500,000", "$1.2M over 5 yrs",
 * "Up to 3 years of $50k". A figure with a currency sign wins over a bare number.
 */
export function parseAmount(text: string | undefined): number | null {
  if (!text) return null;
  const match = WITH_CURRENCY.exec(text) ?? ANY.exec(text);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return value * (SCALE[match[2]?.toLowerCase() ?? ''] ?? 1);
}

const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);

/** "$1,500", or compact "$1.5k" / "$1.2M" for the wall. */
export function formatMoney(value: number, compact = false): string {
  if (compact && value >= 1e6) return `$${oneDecimal(value / 1e6)}M`;
  if (compact && value >= 1e3) return `$${oneDecimal(value / 1e3)}k`;
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

export function goalValue(goal: Goal, notes: Note[]): number {
  switch (goal.measure) {
    case 'submitted':
      return notes.filter(note => note.stage !== undefined && FINISHED_STAGES.includes(note.stage)).length;
    case 'won':
      return notes
        .filter(note => note.stage === 'Awarded')
        .reduce((sum, note) => sum + (parseAmount(note.amount) ?? 0), 0);
    case 'count':
      return goal.count;
  }
}

export interface GoalProgress {
  value: number;
  target: number;
  /** 0–1, for the bar. */
  ratio: number;
  complete: boolean;
  /** "2 of 5", "$1.5k of $10k". */
  label: string;
  /** Where an even pace from the goal's start would be today (0–1), if it has a finish date. */
  pace?: number;
  /** "by Dec 31". */
  byLabel?: string;
  /** "92 days left", "Ends today", "Ended Dec 31". */
  timeLeft?: string;
}

export function goalProgress(goal: Goal, notes: Note[], now: Date, opts: { compact?: boolean } = {}): GoalProgress {
  const value = goalValue(goal, notes);
  const target = Math.max(1, goal.target);
  const show = (n: number) => (goal.measure === 'won' ? formatMoney(n, opts.compact) : String(n));
  const progress: GoalProgress = {
    value,
    target,
    ratio: Math.min(1, Math.max(0, value / target)),
    complete: value >= target,
    label: `${show(value)} of ${show(target)}`,
  };

  const by = parseWhen(goal.by);
  if (by) {
    const left = differenceInCalendarDays(by.date, now);
    progress.byLabel = `by ${format(by.date, 'MMM d')}`;
    progress.timeLeft =
      left > 1 ? `${left} days left` : left === 1 ? '1 day left' : left === 0 ? 'Ends today' : `Ended ${format(by.date, 'MMM d')}`;
    const start = parseISO(goal.createdAt);
    const total = differenceInCalendarDays(by.date, start);
    if (isValid(start) && total > 0 && !progress.complete) {
      progress.pace = Math.min(1, Math.max(0, differenceInCalendarDays(now, start) / total));
    }
  }
  return progress;
}

export const MEASURE_LABEL: Record<Goal['measure'], string> = {
  submitted: 'Applications submitted',
  won: 'Money won',
  count: 'I’ll count it myself',
};
