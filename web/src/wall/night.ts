import { inTimeWindow } from '../../../shared/dates.ts';
import type { Settings } from '../../../shared/types.ts';

export type WallMode = 'day' | 'dim' | 'clock';

export function wallMode(settings: Settings, now: Date): WallMode {
  const { mode, start, end, style } = settings.night;
  const night = mode === 'on' || (mode === 'auto' && inTimeWindow(now, start, end));
  return night ? style : 'day';
}
