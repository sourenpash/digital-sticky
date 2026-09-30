import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Board } from '../../../shared/types.ts';
import { CalendarPanel } from './CalendarPanel.tsx';
import { ConnectCard } from './ConnectCard.tsx';
import { NightClock } from './NightClock.tsx';
import { ReminderBanner } from './ReminderBanner.tsx';
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
export function Wall({ board, now, connectUrl }: { board: Board; now: Date; connectUrl: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const mode = wallMode(board.settings, now);

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

  // Chime when a new reminder appears (not at night).
  const alertCount = board.alerts.length;
  const lastCount = useRef(alertCount);
  useEffect(() => {
    if (alertCount > lastCount.current && board.settings.wall.chime && mode === 'day') playChime();
    lastCount.current = alertCount;
  }, [alertCount, board.settings.wall.chime, mode]);

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
                  <CalendarPanel notes={board.notes} lanes={board.lanes} now={now} />
                  <UpcomingList notes={board.notes} now={now} max={board.settings.wall.showConnect ? 4 : 8} />
                  {board.settings.wall.showConnect && <ConnectCard url={connectUrl} />}
                </aside>
              </div>
            </>
          )}
          <ReminderBanner alerts={board.alerts} notes={board.notes} />
        </div>
      )}
    </div>
  );
}
