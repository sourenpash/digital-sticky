import { useEffect, useState } from 'react';
import type { AnywhereStatus, PairCode } from '../../../shared/api.ts';
import { PAIR_ALPHABET, PAIR_CODE_LENGTH } from '../../../shared/pairing.ts';
import { SAMPLE_ANYWHERE_URL } from '../../../shared/sample.ts';
import { currentTime } from '../lib/now.ts';

// Using the board from anywhere: whether it's set up (scripts/linux/anywhere.sh on the
// wall computer), and codes for signing in another device.

/** Life of a sign-in code (the server's PairingCodes.LIFE_MS). */
export const CODE_LIFE_MS = 10 * 60_000;

/** The board's internet address, or null when it's only on the home Wi-Fi (null result while asking). */
export function useAnywhere(): AnywhereStatus | null {
  const [status, setStatus] = useState<AnywhereStatus | null>(__DEMO_BUILD__ ? { url: SAMPLE_ANYWHERE_URL } : null);
  useEffect(() => {
    if (__DEMO_BUILD__) return;
    let live = true;
    fetch(new URL('api/anywhere', document.baseURI), { cache: 'no-store' })
      .then(response => (response.ok ? (response.json() as Promise<AnywhereStatus>) : null))
      .then(
        data => {
          if (live && data) setStatus(data);
        },
        () => {},
      );
    return () => {
      live = false;
    };
  }, []);
  return status;
}

/** A code for another device to sign in with ("Connect another device"). */
export async function makeSignInCode(): Promise<PairCode | null> {
  if (__DEMO_BUILD__) {
    const code = Array.from({ length: PAIR_CODE_LENGTH }, () => PAIR_ALPHABET[Math.floor(Math.random() * PAIR_ALPHABET.length)]).join('');
    return { code, expiresAt: currentTime().getTime() + CODE_LIFE_MS };
  }
  try {
    const response = await fetch(new URL('api/pair-code', document.baseURI), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return response.ok ? ((await response.json()) as PairCode) : null;
  } catch {
    return null;
  }
}
