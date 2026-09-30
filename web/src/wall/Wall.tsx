import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Board } from '../../../shared/types.ts';
import { ConnectCard } from './ConnectCard.tsx';
import { NightClock } from './NightClock.tsx';
import { ReminderBanner } from './ReminderBanner.tsx';
import { Ticker } from './Ticker.tsx';
import { TwoWeeks } from './TwoWeeks.tsx';
import { WallCursor } from './WallCursor.tsx';
import { UpcomingList } from './UpcomingList.tsx';
import { WallColumns } from './WallColumns.tsx';
import { WallHeader } from './WallHeader.tsx';
import { playChime } from './chime.ts';
import { wallMode } from './night.ts';

interface Box {
  w: number;
  h: number;
  u: number;
}

/**
 * The wall display. It sizes itself from its frame: `u` is 1/120 of a 16:9 wall,
 * and every size in wall.css is a multiple of it, so it looks the same on a 1080p
 * monitor, a 4K monitor, or the small preview in the editor.
 */
interface WallProps {
  board: Board;
  now: Date;
  connectUrl: string | null;
  /** Chime when a reminder goes off (the wall itself, not previews of it). */
  sound?: boolean;
  /** Show the phone remote's cursor (preview page). */
  cursor?: boolean;
  /** The board has been out of reach for a while. */
  offline?: boolean;
}

export function Wall({ board, now, connectUrl, sound = false, cursor = false, offline = false }: WallProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const mode = wallMode(board.settings, now);
  const connect = board.settings.wall.showConnect ? connectUrl : null;

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const W = frame.clientWidth;
      const H = frame.clientHeight;
      if (!W || !H) return;
      // Tall frames (phones) get a letterboxed 16:9 wall; wide frames are filled.
      const h = W / H < 4 / 3 ? (W * 9) / 16 : H;
      setBox({ w: W, h, u: Math.min(W / 120, h / 67.5) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // Chime when a reminder goes off (not at night). Tracks ids, so one going away while
  // another arrives still chimes, and reminders already up when the page opens don't.
  const seen = useRef<Set<string> | null>(null);
  const { alerts } = board;
  const chime = sound && board.settings.wall.chime && mode === 'day';
  useEffect(() => {
    const ids = alerts.map(alert => alert.id);
    const fresh = seen.current !== null && ids.some(id => !seen.current?.has(id));
    seen.current = new Set(ids);
    if (fresh && chime) playChime();
  }, [alerts, chime]);

  return (
    <div ref={frameRef} className="wall-frame">
      {box && (
        <div
          className={`wall wall-mode-${mode}`}
          style={{ width: box.w, height: box.h, '--u': `${box.u}px` } as CSSProperties}
        >
          {mode === 'clock' ? (
            <NightClock notes={board.notes} now={now} />
          ) : (
            <>
              <WallHeader goals={board.goals} notes={board.notes} now={now} />
              <div className="wall-main">
                <WallColumns lanes={board.lanes} notes={board.notes} now={now} u={box.u} />
                <aside className="wall-side">
                  <UpcomingList notes={board.notes} now={now} max={connect ? 5 : 10} />
                  {connect && <ConnectCard url={connect} />}
                </aside>
              </div>
              <TwoWeeks notes={board.notes} lanes={board.lanes} now={now} />
              {mode === 'day' && board.settings.ticker.show && <Ticker settings={board.settings.ticker} u={box.u} />}
            </>
          )}
          <ReminderBanner alerts={board.alerts} notes={board.notes} />
          {cursor && <WallCursor />}
          {offline && (
            <p className="wall-offline" role="status">
              Reconnecting to the board…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
