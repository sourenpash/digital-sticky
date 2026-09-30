import { format } from 'date-fns';
import { goalProgress } from '../../../shared/goals.ts';
import type { Goal, Note } from '../../../shared/types.ts';
import { GOAL_COLOR, GoalBar } from '../components/GoalBar.tsx';
import { WallClock } from './WallClock.tsx';

/** Date, up to three goals with progress bars, and the clock. */
export function WallHeader({ goals, notes, now }: { goals: Goal[]; notes: Note[]; now: Date }) {
  return (
    <header className="wall-head">
      <div className="wall-date">
        <span className="wall-weekday">{format(now, 'EEEE')}</span>
        <span className="wall-day">{format(now, 'MMMM d')}</span>
      </div>
      <div className="wall-goals">
        {goals.slice(0, 3).map(goal => {
          const progress = goalProgress(goal, notes, now, { compact: true });
          const sub = progress.complete ? 'Reached!' : [progress.byLabel, progress.timeLeft].filter(Boolean).join(' · ');
          return (
            <div key={goal.id} className={`wall-goal paper-${GOAL_COLOR[goal.measure]}${progress.complete ? ' is-complete' : ''}`}>
              <span className="wall-goal-title">{goal.title}</span>
              <GoalBar ratio={progress.ratio} pace={progress.pace} />
              <div className="wall-goal-foot">
                {sub && <span className="wall-goal-sub">{sub}</span>}
                <span className="wall-goal-value">{progress.label}</span>
              </div>
            </div>
          );
        })}
      </div>
      <WallClock />
    </header>
  );
}
