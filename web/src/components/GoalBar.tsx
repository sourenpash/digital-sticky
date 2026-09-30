import type { GoalMeasure, NoteColor } from '../../../shared/types.ts';

/** Goal bars take the color of what they count: applications are yellow, money green. */
export const GOAL_COLOR: Record<GoalMeasure, NoteColor> = { submitted: 'yellow', won: 'green', count: 'purple' };

/**
 * A goal's progress bar. The thin mark shows where an even pace would be today,
 * for goals with a finish date.
 */
export function GoalBar({ ratio, pace }: { ratio: number; pace?: number }) {
  return (
    <span className="goal-bar" aria-hidden="true">
      <span className="goal-bar-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
      {pace !== undefined && pace > 0 && pace < 1 && <span className="goal-bar-pace" style={{ left: `${(pace * 100).toFixed(1)}%` }} />}
    </span>
  );
}
