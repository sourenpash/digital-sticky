import { useEffect, useState } from 'react';
import { navigate } from '../lib/route.ts';
import { currentSession, pair, refreshSession, type LoginResult } from '../store/session.ts';
import { showToast } from '../store/toasts.ts';
import { Login } from './Login.tsx';

/** One try per code, even if this screen is drawn twice. */
const tries = new Map<string, Promise<LoginResult>>();

/**
 * #pair-K7QM2XPA: a phone scanned the code on the wall. It signs in with the code and
 * opens the board; the code leaves the address (and the history) on the way.
 */
export function PairScreen({ code }: { code: string }) {
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let attempt = tries.get(code);
    if (!attempt) {
      attempt = __DEMO_BUILD__ ? Promise.resolve<LoginResult>({ ok: true }) : pair(code);
      tries.set(code, attempt);
    }
    void attempt.then(async result => {
      if (!live) return;
      if (result.ok) {
        showToast({ text: 'Signed in. This device stays signed in.' });
        navigate('board', { replace: true });
        return;
      }
      // An old code scanned again on a device that's signed in anyway: just open the board.
      await refreshSession();
      if (!live) return;
      if (currentSession()?.signedIn) {
        navigate('board', { replace: true });
        return;
      }
      setFailed(
        result.reason === 'wait'
          ? 'Too many tries from this device. Wait a little, then scan the code on the wall again.'
          : result.reason === 'offline'
            ? 'Can’t reach the board. Make sure the wall computer is on, then scan the code again.'
            : 'That code has expired or was already used. Scan the code on the wall again, or type it below.',
      );
    });
    return () => {
      live = false;
    };
  }, [code]);

  if (failed) return <Login notice={failed} onUnlock={() => navigate('board', { replace: true })} />;
  return (
    <div className="boot" role="status">
      <span className="brand-mark" aria-hidden="true" />
      <p className="boot-title">Signing in…</p>
    </div>
  );
}
