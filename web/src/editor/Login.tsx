import { useState } from 'react';
import { Lock } from 'lucide-react';
import { login } from '../store/session.ts';

function waitText(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? 'a minute' : `${minutes} minutes`;
}

/**
 * The PIN screen. `wall`: shown where the wall screen was asked for, to point out that
 * the wall computer itself doesn't need the PIN.
 */
export function Login({ onUnlock, wall = false }: { onUnlock?: () => void; wall?: boolean }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pin.length < 6) {
      setError('Your PIN is 6 to 12 digits.');
      return;
    }
    if (__DEMO_BUILD__) {
      onUnlock?.();
      return;
    }
    setBusy(true);
    const result = await login(pin);
    setBusy(false);
    setPin('');
    if (result.ok) {
      onUnlock?.();
      return;
    }
    setError(
      result.reason === 'wrong'
        ? 'That PIN isn’t right. Try again.'
        : result.reason === 'wait'
          ? `Too many tries. Try again in ${waitText(result.retryAfter ?? 60)}.`
          : 'Can’t reach the board. Make sure the wall computer is on and you’re on the same Wi-Fi.',
    );
  };

  return (
    <div className="login">
      <form
        className="login-card"
        onSubmit={e => {
          e.preventDefault();
          void submit();
        }}
      >
        <span className="login-note paper-yellow" aria-hidden="true">
          <Lock />
        </span>
        <h1>Digital Sticky</h1>
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
            setError('');
          }}
        />
        {error && (
          <p className="ne-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        <p className="login-foot">
          {wall
            ? 'This is the wall screen. On the wall computer itself, open the board at localhost: it doesn’t need the PIN.'
            : 'This device stays signed in after this.'}
        </p>
      </form>
    </div>
  );
}
