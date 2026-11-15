import { format } from 'date-fns';
import { useEffect, useState, type CSSProperties } from 'react';
import { WallClock } from './WallClock.tsx';

/** The clock shows this long when the saver comes on, then the screen goes black. */
const CLOCK_MS = 8000;

/**
 * Covers the wall so the TV doesn't burn in: the time and date for a few seconds, at a
 * different spot each time, then a black screen. Moving the mouse brings the wall back.
 */
export function ScreenSaver({ now }: { now: Date }) {
  const [clock, setClock] = useState(true);
  const [spot] = useState(() => ({ x: 20 + Math.random() * 60, y: 25 + Math.random() * 50 }));
  useEffect(() => {
    const id = window.setTimeout(() => setClock(false), CLOCK_MS);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className="screen-saver" aria-hidden="true">
      <div className={`saver-clock${clock ? ' is-shown' : ''}`} style={{ left: `${spot.x}%`, top: `${spot.y}%` } as CSSProperties}>
        <WallClock className="saver-time" />
        <div className="saver-date">{format(now, 'EEEE, MMMM d')}</div>
      </div>
    </div>
  );
}
