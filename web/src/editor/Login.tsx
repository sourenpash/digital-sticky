import { useState } from 'react';
import { Lock } from 'lucide-react';

export function Login({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  return (
    <div className="login">
      <form
        className="login-card"
        onSubmit={e => {
          e.preventDefault();
          if (pin.length < 4) {
            setError('Your PIN is at least 4 digits.');
            return;
          }
          onUnlock();
        }}
      >
        <span className="login-note paper-yellow" aria-hidden="true">
          <Lock />
        </span>
        <h1>Digital Sticky</h1>
        <p>Enter the PIN you chose when setting up the wall.</p>
        <input
          id="pin"
          className="pin-input"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="current-password"
          maxLength={8}
          aria-label="PIN"
          value={pin}
          onChange={e => {
            setPin(e.target.value.replace(/\D/g, ''));
            setError('');
          }}
        />
        {error && <p className="ne-error">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block">
          Unlock
        </button>
        <p className="login-foot">This phone stays signed in after this.</p>
      </form>
    </div>
  );
}
