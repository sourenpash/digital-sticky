type AudioCtor = typeof AudioContext;

/** Two soft tones. Browsers only allow sound after a tap, except in the kiosk (autoplay flag). */
export function playChime(): void {
  try {
    const Ctor: AudioCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
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
    window.setTimeout(() => void ctx.close(), 1400);
  } catch {
    // Sound is a nice-to-have; the banner still shows.
  }
}
