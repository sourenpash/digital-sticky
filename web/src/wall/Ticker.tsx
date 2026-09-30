import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { formatChange, formatPrice, type TickerItem } from '../../../shared/ticker.ts';
import type { TickerSettings } from '../../../shared/types.ts';
import { useTicker } from '../store/ticker.ts';

/** How fast the ribbon moves, in wall units per second (slow enough to read from bed). */
const SPEED_U = 3.5;

function Item({ item }: { item: TickerItem }) {
  if (item.kind === 'headline') {
    return (
      <span className="tk-item tk-news">
        <span className="tk-src">{item.source}</span>
        {item.title}
      </span>
    );
  }
  const direction = item.change > 0.05 ? 'up' : item.change < -0.05 ? 'down' : 'flat';
  return (
    <span className="tk-item">
      <span className="tk-sym">{item.symbol}</span>
      <span className="tk-price">{formatPrice(item.price)}</span>
      <span className={`tk-change tk-${direction}`}>{formatChange(item.change)}</span>
    </span>
  );
}

/** Prices and headlines sliding slowly along the bottom of the wall. */
export function Ticker({ settings, u }: { settings: TickerSettings; u: number }) {
  const { items, sample } = useTicker(settings);
  const runRef = useRef<HTMLSpanElement>(null);
  const [seconds, setSeconds] = useState(60);

  useLayoutEffect(() => {
    const run = runRef.current;
    if (!run) return;
    const measure = () => setSeconds(Math.max(15, run.offsetWidth / (SPEED_U * u)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(run);
    return () => observer.disconnect();
  }, [u, items]);

  if (items.length === 0) return null;
  const row = items.map((item, i) => <Item key={`${i}-${item.kind === 'price' ? item.symbol : item.title}`} item={item} />);
  return (
    <div className="wall-ticker" role="marquee" aria-label="Prices and tech news">
      {sample && <span className="wall-ticker-tag">Sample</span>}
      <div className="wall-ticker-window">
        <div className="wall-ticker-track" style={{ '--ticker-s': `${seconds}s` } as CSSProperties}>
          <span ref={runRef} className="wall-ticker-run">
            {row}
          </span>
          <span className="wall-ticker-run" aria-hidden="true">
            {row}
          </span>
        </div>
      </div>
    </div>
  );
}
