import { goalProgress } from '../../../shared/goals.ts';
import type { Goal, Note } from '../../../shared/types.ts';
import { GOAL_COLOR, GoalBar } from '../components/GoalBar.tsx';

export function GoalCard({ goal, notes, now, selected, onOpen }: { goal: Goal; notes: Note[]; now: Date; selected?: boolean; onOpen: () => void }) {
  const progress = goalProgress(goal, notes, now, { compact: true });
  const sub = progress.complete ? 'Reached!' : [progress.byLabel, progress.timeLeft].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      className={`goal-card paper-${GOAL_COLOR[goal.measure]}${selected ? ' is-selected' : ''}${progress.complete ? ' is-complete' : ''}`}
      onClick={onOpen}
    >
      <span className="goal-card-title">{goal.title || 'Untitled goal'}</span>
      <GoalBar ratio={progress.ratio} pace={progress.pace} />
      <span className="goal-card-foot">
        <span className="goal-card-sub">{sub}</span>
        <strong className="goal-card-value">{progress.label}</strong>
      </span>
    </button>
  );
}
