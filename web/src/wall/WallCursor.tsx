import { useRemoteCursor } from '../store/remote.ts';

/** The phone remote's cursor, drawn on the wall (preview page only). */
export function WallCursor() {
  const { x, y, visible, clicks } = useRemoteCursor();
  return (
    <div className={`wall-cursor${visible ? ' is-on' : ''}`} style={{ left: `${x * 100}%`, top: `${y * 100}%` }} aria-hidden="true">
      {clicks > 0 && <span key={clicks} className="wall-cursor-click" />}
      <svg viewBox="0 0 24 24">
        <path d="M4 2.5 19.5 13l-7.2 1.3L8.6 21z" />
      </svg>
    </div>
  );
}
