import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { BellRing, MessageSquareText, Plus, Send, Trash2, X } from 'lucide-react';
import { whenLabel } from '../../../shared/ai.ts';
import type { IMessageInfo, PushDeviceInfo } from '../../../shared/api.ts';
import type { Board } from '../../../shared/types.ts';
import { useAnywhere } from '../store/anywhere.ts';
import { board as store } from '../store/board.ts';
import { pushSupport, testNotification, thisDevice, turnOffNotifications, turnOnNotifications, usePush, useThisDevice } from '../store/push.ts';
import { defaultScreenName } from '../store/screens.ts';
import { saveTexts, testText, useTexts } from '../store/texts.ts';
import { showToast } from '../store/toasts.ts';
import { CopyBox } from './CopyBox.tsx';
import { Switch } from './Switch.tsx';

// The Wall tab's reminders away from the wall: notifications on this phone or computer,
// and texts through iMessage (with BlueBubbles on a Mac).

function DeviceRow({ device, here, now }: { device: PushDeviceInfo; here: boolean; now: Date }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  return (
    <li className="screen-row">
      <BellRing className="ai-conn-icon" aria-hidden="true" />
      <span className="screen-text">
        <span className="screen-name">
          {device.name}
          {here && <span className="screen-tag">This device</span>}
        </span>
        <span className={`screen-hint${device.problem ? ' is-warn' : ''}`}>
          {device.problem ?? (device.lastSentAt ? `Last one ${whenLabel(parseISO(device.lastSentAt), now)}` : `Added ${format(parseISO(device.addedAt), 'MMM d')}`)}
        </span>
        {result && (
          <span className="ai-test-result" role="status">
            {result}
          </span>
        )}
      </span>
      <span className="screen-actions">
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          aria-label={`Send a test notification to ${device.name}`}
          title="Send a test"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setResult(await testNotification(device));
            setBusy(false);
          }}
        >
          <Send />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          aria-label={`Stop notifications on ${device.name}`}
          title="Stop notifications"
          onClick={async () => {
            const ok = await turnOffNotifications(device, here);
            showToast({ text: ok ? `${device.name} no longer gets notifications.` : 'Couldn’t change it. Check the connection and try again.' });
          }}
        >
          <Trash2 />
        </button>
      </span>
    </li>
  );
}

/** Notifications on this phone or computer, and the other devices that get them. */
export function NotificationsSection({ board, now }: { board: Board; now: Date }) {
  const push = usePush();
  const endpoint = useThisDevice();
  const anywhere = useAnywhere()?.url ?? null;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const support = pushSupport();
  const devices = push?.devices ?? [];
  const here = thisDevice(devices, endpoint);
  const deviceWord = /iPhone|Android.+Mobile/.test(navigator.userAgent) ? 'phone' : 'device';

  const turnOn = async () => {
    setBusy(true);
    setProblem(null);
    const failed = await turnOnNotifications(defaultScreenName());
    setBusy(false);
    if (failed) setProblem(failed);
    else showToast({ text: 'Notifications are on. Reminders from the wall show up here now.' });
  };

  return (
    <section className="set-group" id="notifications">
      <h3>
        <BellRing aria-hidden="true" /> Notifications
      </h3>
      <p className="set-note">Reminders and follow-up nudges show up on your phone too, with the same words as the wall. A tap opens the sticky.</p>
      {support === 'needs-https' && (
        <p className="set-note">
          Notifications need the board’s https address.{' '}
          {anywhere ? (
            <>
              Open <strong>{anywhere.replace(/^https:\/\//, '')}</strong> on this device, and turn them on there.
            </>
          ) : (
            <>
              Give the board one first: run <code>scripts/linux/anywhere.sh</code> on the wall computer.
            </>
          )}
        </p>
      )}
      {support === 'needs-home-screen' && (
        <p className="set-note">
          On an iPhone or iPad, notifications come from the board on your Home Screen: open the board’s https address in Safari, tap Share, then{' '}
          <strong>Add to Home Screen</strong>, and open it from there.
        </p>
      )}
      {support === 'unsupported' && <p className="set-note">This browser can’t show notifications from the board.</p>}
      {support === 'ok' &&
        (here ? (
          <p className="set-note">This {deviceWord} gets notifications.</p>
        ) : (
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || endpoint === undefined} onClick={() => void turnOn()}>
            <BellRing aria-hidden="true" /> Turn on notifications on this {deviceWord}
          </button>
        ))}
      {problem && (
        <p className="ne-error" role="alert">
          {problem}
        </p>
      )}
      {devices.length > 0 && (
        <ul className="screen-list" aria-label="Devices that get notifications">
          {devices.map(device => (
            <DeviceRow key={device.id} device={device} here={device.id === here?.id} now={now} />
          ))}
        </ul>
      )}
      <Switch
        id="notify-quiet"
        checked={board.settings.notify.quietAtNight}
        label="Quiet during night mode (notifications and texts; the wall still shows reminders)"
        onChange={quietAtNight => store.updateSettings(s => ({ ...s, notify: { ...s.notify, quietAtNight } }))}
      />
    </section>
  );
}

/** The texts settings form. */
function TextsForm({ info }: { info: IMessageInfo }) {
  const [url, setUrl] = useState(info.url ?? '');
  const [password, setPassword] = useState('');
  const [addresses, setAddresses] = useState(info.addresses);
  const [newAddress, setNewAddress] = useState('');
  const [reminders, setReminders] = useState(info.reminders);
  const [followUps, setFollowUps] = useState(info.followUps);
  const [morning, setMorning] = useState(info.morning);
  const [morningTime, setMorningTime] = useState(info.morningTime);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const addAddress = () => {
    const value = newAddress.trim();
    if (!value || addresses.includes(value)) return;
    setAddresses([...addresses, value]);
    setNewAddress('');
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const pending = newAddress.trim();
    const list = pending && !addresses.includes(pending) ? [...addresses, pending] : addresses;
    const problem = await saveTexts({
      url: url.trim(),
      ...(password.trim() ? { password: password.trim() } : {}),
      addresses: list,
      reminders,
      followUps,
      morning,
      morningTime,
    });
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setAddresses(list);
    setNewAddress('');
    setPassword('');
    showToast({ text: 'Saved. Send a test text to check it works.' });
  };

  const ready = Boolean(info.url && info.passwordSet && info.addresses.length);
  return (
    <form
      className="ai-links"
      aria-label="Texts settings"
      onSubmit={e => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="field" htmlFor="texts-url">
        <span className="field-label">BlueBubbles Server’s address</span>
        <input id="texts-url" value={url} inputMode="url" autoComplete="off" spellCheck={false} placeholder="http://mac-mini.local:1234" onChange={e => setUrl(e.target.value)} />
      </label>
      <label className="field" htmlFor="texts-password">
        <span className="field-label">Its password</span>
        <input
          id="texts-password"
          type="password"
          value={password}
          autoComplete="off"
          placeholder={info.passwordSet ? 'Saved. Paste a new one to change it.' : 'From BlueBubbles Server’s settings'}
          onChange={e => setPassword(e.target.value)}
        />
      </label>
      <div className="sym-field">
        <span className="field-label" id="texts-who">
          Who gets the texts, and may text the board
        </span>
        {addresses.length > 0 && (
          <ul className="sym-list" aria-labelledby="texts-who">
            {addresses.map(address => (
              <li key={address} className="sym-chip">
                {address}
                <button type="button" aria-label={`Remove ${address}`} onClick={() => setAddresses(addresses.filter(a => a !== address))}>
                  <X aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="set-row">
          <input
            className="sym-input sym-input-wide"
            aria-label="Phone number or Apple ID"
            value={newAddress}
            inputMode="email"
            autoComplete="off"
            placeholder="+1 555 123 4567 or you@icloud.com"
            onChange={e => setNewAddress(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addAddress();
              }
            }}
          />
          <button type="button" className="btn btn-sm" aria-label="Add this number" disabled={!newAddress.trim()} onClick={addAddress}>
            <Plus aria-hidden="true" /> Add
          </button>
        </div>
      </div>
      <span className="field-label">Text them</span>
      <label className="check-row">
        <input type="checkbox" checked={reminders} onChange={e => setReminders(e.target.checked)} />
        <span>Reminders, when they go off</span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={followUps} onChange={e => setFollowUps(e.target.checked)} />
        <span>Nudges to follow up</span>
      </label>
      <div className="set-row">
        <label className="check-row">
          <input type="checkbox" checked={morning} onChange={e => setMorning(e.target.checked)} />
          <span>A morning summary of what’s due, at</span>
        </label>
        <input type="time" aria-label="Morning summary time" value={morningTime} onChange={e => e.target.value && setMorningTime(e.target.value)} />
      </div>
      {error && (
        <p className="ne-error" role="alert">
          {error}
        </p>
      )}
      <div className="set-row">
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
          Save
        </button>
        {ready && !testing && (
          <button type="button" className="btn btn-sm" onClick={() => setTesting(true)}>
            <Send aria-hidden="true" /> Send a test text
          </button>
        )}
      </div>
      {testing && (
        <div className="screen-confirm" role="group" aria-label="Send a test text?">
          <span>This sends a real text to {info.addresses.join(', ')}.</span>
          <span className="set-row">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={async () => {
                setTesting(false);
                setResult(await testText());
              }}
            >
              Send it
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTesting(false)}>
              Cancel
            </button>
          </span>
        </div>
      )}
      {result && (
        <p className={`ai-test-result${result.ok ? ' is-ok' : ' is-warn'}`} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}

/** Reminders by iMessage, and texting the board back. */
export function TextsSection({ now }: { now: Date }) {
  const info = useTexts();
  const link = info ? (info.webhook.anywhere ?? info.webhook.home ?? new URL(info.webhook.path.replace(/^\//, ''), document.baseURI).href) : '';
  return (
    <section className="set-group" id="texts">
      <h3>
        <MessageSquareText aria-hidden="true" /> Texts (iMessage)
      </h3>
      <p className="set-note">
        Get reminders as iMessages, and text the board back: <strong>done</strong>, <strong>snooze 1h</strong>, <strong>add call NSF friday</strong>,{' '}
        <strong>today</strong>. It goes through a Mac that stays on.
      </p>
      {info ? (
        <>
          <ol className="ai-steps">
            <li>
              On a Mac that stays on, sign in to Messages (a separate Apple ID for the board is best), and install <strong>BlueBubbles Server</strong> from
              bluebubbles.app. Its setup gives it a password.
            </li>
            <li>Paste its address and password below, and add who gets the texts.</li>
            <li>
              In BlueBubbles Server’s <strong>API &amp; Webhooks</strong> settings, add this link as a webhook for <strong>New Messages</strong>, so the board hears
              texts back:
              <CopyBox label="Webhook link" text={link} />
            </li>
          </ol>
          <TextsForm key={`${info.url}|${info.addresses.join(',')}|${info.passwordSet}`} info={info} />
          {(info.lastSent || info.lastReceived) && (
            <p className="set-note">
              {info.lastSent && (
                <span className={info.lastSent.ok ? undefined : 'is-warn-text'}>
                  Last text sent {whenLabel(parseISO(info.lastSent.at), now)}
                  {info.lastSent.ok ? '.' : `: ${info.lastSent.message}`}{' '}
                </span>
              )}
              {info.lastReceived && `Last text in ${whenLabel(parseISO(info.lastReceived.at), now)}: “${info.lastReceived.text}”.`}
            </p>
          )}
        </>
      ) : (
        <p className="set-note">Checking…</p>
      )}
    </section>
  );
}
