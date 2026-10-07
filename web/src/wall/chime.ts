import { useEffect, useState } from 'react';

type AudioCtor = typeof AudioContext;

// The wall's chime. Browsers only play sound once the page has been tapped or clicked,
// except the wall computer's (its kiosk browser is allowed). One audio context is
// shared, so a single tap turns sound on for good while the page stays open.

let shared: AudioContext | null = null;

function context(): AudioContext | null {
  if (shared) return shared;
  try {
    const Ctor: AudioCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    shared = Ctor ? new Ctor() : null;
  } catch {
    shared = null;
  }
  return shared;
}

/** Two soft tones. */
export function playChime(): void {
  try {
    const ctx = context();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.18;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.75);
    });
  } catch {
    // Sound is a nice-to-have; the banner still shows.
  }
}

/**
 * True while the browser holds sound back until the wall is tapped (an iPad, a laptop;
 * never the wall computer). The first tap or click turns it on.
 */
export function useSoundBlocked(wanted: boolean): boolean {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!wanted) {
      setBlocked(false);
      return;
    }
    const ctx = context();
    if (!ctx) return;
    const update = () => setBlocked(ctx.state !== 'running');
    const unlock = () => {
      if (ctx.state !== 'running') void ctx.resume().then(update, () => {});
    };
    update();
    ctx.addEventListener('statechange', update);
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      ctx.removeEventListener('statechange', update);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [wanted]);
  return blocked;
}
