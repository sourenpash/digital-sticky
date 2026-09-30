import { format } from 'date-fns';
import { datedNotes } from '../../../shared/board.ts';
import { daysUntil, isPast } from '../../../shared/dates.ts';
import type { Note } from '../../../shared/types.ts';
import { WallClock } from './WallClock.tsx';

export function WallHeader({ notes, now }: { notes: Note[]; now: Date }) {
  const deadlines = datedNotes(notes).filter(item => item.kind === 'due');
  const overdue = deadlines.filter(item => isPast(item.when, now)).length;
  const thisWeek = deadlines.filter(item => !isPast(item.when, now) && daysUntil(item.when, now) <= 7).length;

  return (
    <header className="wall-head">
      <div className="wall-date">
        <span className="wall-weekday">{format(now, 'EEEE')}</span>
        <span className="wall-day">{format(now, 'MMMM d')}</span>
      </div>
      <div className="wall-summary">
        {overdue > 0 && <span className="pill pill-overdue">{overdue} overdue</span>}
        <span className={`pill ${thisWeek > 0 ? 'pill-week' : 'pill-calm'}`}>
          {thisWeek === 0 ? 'Nothing due this week' : `${thisWeek} due in the next 7 days`}
        </span>
      </div>
      <WallClock />
    </header>
  );
}
