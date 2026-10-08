import { isNightTime } from '../../../shared/notify.ts';
import type { Settings } from '../../../shared/types.ts';

export type WallMode = 'day' | 'dim' | 'clock';

export function wallMode(settings: Settings, now: Date): WallMode {
  return isNightTime(settings, now) ? settings.night.style : 'day';
}
