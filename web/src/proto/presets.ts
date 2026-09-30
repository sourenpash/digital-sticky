import { board } from '../store/board.ts';

/**
 * `?preset=dim,banner` sets the prototype up in a given state (used for screenshots).
 * day | dim | clock | banner | qr
 */
export function applyPresetsFromUrl(): void {
  let presets: string[] = [];
  try {
    presets = (new URLSearchParams(window.location.search).get('preset') ?? '').split(',').filter(Boolean);
  } catch {
    return;
  }
  for (const preset of presets) applyPreset(preset);
}

export function applyPreset(preset: string): void {
  const night = (mode: 'auto' | 'on' | 'off', style?: 'dim' | 'clock') =>
    board.updateSettings(s => ({ ...s, night: { ...s.night, mode, style: style ?? s.night.style } }));
  switch (preset) {
    case 'day':
      night('off');
      break;
    case 'dim':
      night('on', 'dim');
      break;
    case 'clock':
      night('on', 'clock');
      break;
    case 'qr':
      board.updateSettings(s => ({ ...s, wall: { ...s.wall, showConnect: true } }));
      break;
    case 'banner': {
      const reminder = board.get().notes.find(note => note.remindAt);
      if (reminder) board.fireReminder(reminder.id);
      break;
    }
  }
}
