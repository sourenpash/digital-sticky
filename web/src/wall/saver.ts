import { inTimeWindow } from '../../../shared/dates.ts';
import type { SaverSettings } from '../../../shared/types.ts';

/** Why the screen saver is on: the hours you sleep, or one of the regular breaks. */
export type SaverReason = 'sleep' | 'break';

/**
 * Whether the screen saver is due at `now`. Breaks start on the hour (every 60 minutes:
 * :00 to :05), so they're easy to predict; a break as long as the gap between them
 * would never end, so there are none then.
 */
export function saverDue(saver: SaverSettings, now: Date): SaverReason | null {
  if (saver.sleep && inTimeWindow(now, saver.sleepStart, saver.sleepEnd)) return 'sleep';
  if (saver.every > 0 && saver.length < saver.every) {
    const minute = now.getHours() * 60 + now.getMinutes();
    if (minute % saver.every < saver.length) return 'break';
  }
  return null;
}
