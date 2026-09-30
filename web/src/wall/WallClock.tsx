import { format } from 'date-fns';
import { useNow } from '../lib/now.ts';

export function WallClock({ className = 'wall-clock' }: { className?: string }) {
  const now = useNow(1000);
  const hm = format(now, 'h:mm');
  return (
    <div className={className} aria-label={format(now, 'h:mm a')}>
      <span className="clock-hm" aria-hidden="true">
        {[...hm].map((ch, i) => (
          <span key={i} className={ch === ':' ? 'c' : 'd'}>
            {ch}
          </span>
        ))}
      </span>
      <span className="clock-ampm" aria-hidden="true">
        {format(now, 'a')}
      </span>
    </div>
  );
}
