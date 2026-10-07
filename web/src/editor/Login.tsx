import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { normalizePairCode, PAIR_CODE_LENGTH } from '../../../shared/pairing.ts';
import { login, pair, refreshSession, useSession, type LoginResult } from '../store/session.ts';

function waitText(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? 'a minute' : `${minutes} minutes`;
}

type Failure = Exclude<LoginResult, { ok: true }>;

function failureText(result: Failure, tried: 'pin' | 'code', outside: boolean): string {
  if (result.reason === 'wait') return `Too many tries. Try again in ${waitText(result.retryAfter ?? 60)}.`;
  if (result.reason === 'offline') {
    return outside
      ? 'Can’t reach the board. Make sure the wall computer is on and online.'
      : 'Can’t reach the board. Make sure the wall computer is on and you’re on the same Wi-Fi.';
  }
  return tried === 'pin' ? 'That PIN isn’t right. Try again.' : 'That code isn’t right, or it has expired. Use the one on the wall now.';
}

interface Props {
  onUnlock?: () => void;
  /** Shown where the wall was asked for, to point out that the wall computer itself doesn't sign in. */
  wall?: boolean;
  /** Why this shows, e.g. a scanned code had expired. */
  notice?: string;
}

/**
 * Signing in: with the board's PIN (if it has one), or with the code the wall shows,
 * scanned with the camera (which opens the board signed in) or typed here.
 */
export function Login({ onUnlock, wall = false, notice }: Props) {
  const session = useSession();
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<{ on: 'pin' | 'code'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Until the server says whether there's a PIN, keep asking (it's usually there at once).
  useEffect(() => {
    if (__DEMO_BUILD__ || session) return;
    const id = window.setInterval(() => void refreshSession(), 3000);
    return () => window.clearInterval(id);
  }, [session]);

  const pinSet = __DEMO_BUILD__ || (session?.pinSet ?? false);
  const outside = session?.outside ?? false;
  const codeReady = normalizePairCode(code).length === PAIR_CODE_LENGTH;

  const run = async (tried: 'pin' | 'code', attempt: () => Promise<LoginResult>) => {
    if (__DEMO_BUILD__) {
      onUnlock?.();
      return;
    }
    setBusy(true);
    const result = await attempt();
    setBusy(false);
    if (result.ok) {
      onUnlock?.();
      return;
    }
    setError({ on: tried, text: failureText(result, tried, outside) });
  };

  const submitPin = () => {
    if (pin.length < 6) {
      setError({ on: 'pin', text: 'Your PIN is 6 to 12 digits.' });
      return;
    }
    void run('pin', async () => {
      const result = await login(pin);
      setPin('');
      return result;
    });
  };

  const submitCode = () => {
    if (!codeReady) {
      setError({ on: 'code', text: `The code on the wall has ${PAIR_CODE_LENGTH} letters and numbers.` });
      return;
    }
    void run('code', () => pair(code));
  };

  if (!__DEMO_BUILD__ && !session) {
    return (
      <div className="login">
        <div className="login-card" role="status">
          <span className="login-note paper-yellow" aria-hidden="true">
            <Lock />
          </span>
          <h1>Digital Sticky</h1>
          <p>Checking…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="login-card">
        <span className="login-note paper-yellow" aria-hidden="true">
          <Lock />
        </span>
        <h1>Digital Sticky</h1>
        {notice && (
          <p className="login-notice" role="alert">
            {notice}
          </p>
        )}
        {pinSet && (
          <form
            className="login-form"
            onSubmit={e => {
              e.preventDefault();
              submitPin();
            }}
          >
            <p>Enter the board’s PIN.</p>
            {/* Lets password managers (iCloud Keychain) save the PIN for this board. */}
            <input type="text" name="username" autoComplete="username" value="Digital Sticky" readOnly hidden />
            <input
              id="pin"
              name="password"
              className="pin-input"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="current-password"
              enterKeyHint="go"
              maxLength={12}
              aria-label="PIN"
              value={pin}
              disabled={busy}
              onChange={e => {
                setPin(e.target.value.replace(/\D/g, ''));
                setError(null);
              }}
            />
            {error?.on === 'pin' && (
              <p className="ne-error" role="alert">
                {error.text}
              </p>
            )}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Checking…' : 'Unlock'}
            </button>
          </form>
        )}
        {pinSet && (
          <p className="login-or" aria-hidden="true">
            <span>or</span>
          </p>
        )}
        <form
          className="login-form"
          onSubmit={e => {
            e.preventDefault();
            submitCode();
          }}
        >
          <p>
            {pinSet ? 'Or scan the code on the wall with your camera, or type it here.' : 'Scan the code on your wall with your phone’s camera, or type the code shown under it.'}
          </p>
          <div className="login-code-row">
            <input
              id="pair-code"
              className="code-input"
              aria-label="Code from the wall"
              placeholder="K7QM-2XPA"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={12}
              value={code}
              disabled={busy}
              onChange={e => {
                setCode(e.target.value.toUpperCase());
                setError(null);
              }}
            />
            <button type="submit" className={`btn${pinSet ? '' : ' btn-primary'}`} disabled={busy || !codeReady}>
              Sign in
            </button>
          </div>
          {error?.on === 'code' && (
            <p className="ne-error" role="alert">
              {error.text}
            </p>
          )}
        </form>
        <p className="login-foot">
          {wall
            ? 'This is the wall screen. On the wall computer itself, open the board at localhost: it doesn’t need to sign in. To show the wall on this device, sign in once, then set it up under Wall, Wall screens.'
            : outside
              ? 'Away from the wall? On a phone or computer that’s already signed in, open Wall, then Connect another device, for a code.'
              : 'This device stays signed in after this.'}
        </p>
      </div>
    </div>
  );
}
