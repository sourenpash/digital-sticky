import { format } from 'date-fns';
import { datedNotes } from '../../../shared/board.ts';
import { countdownLabel, isPast } from '../../../shared/dates.ts';
import type { Note } from '../../../shared/types.ts';
import { WallClock } from './WallClock.tsx';

export function NightClock({ notes, now }: { notes: Note[]; now: Date }) {
  const next = datedNotes(notes).find(item => item.kind === 'due' && !isPast(item.when, now));
  return (
    <div className="night-clock">
      <WallClock className="night-time" />
      <div className="night-date">{format(now, 'EEEE, MMMM d')}</div>
      {next && (
        <div className="night-next">
          Next deadline <strong>{next.note.title}</strong> · {countdownLabel(next.when, now)}
        </div>
      )}
    </div>
  );
}
