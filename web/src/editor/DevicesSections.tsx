import { useState } from 'react';
import { formatDistanceStrict, parseISO } from 'date-fns';
import { Globe, House, MonitorSmartphone, Pencil, Plus, QrCode, Smartphone, Trash2 } from 'lucide-react';
import type { PairCode, ScreenInfo } from '../../../shared/api.ts';
import { formatPairCode, pairUrl } from '../../../shared/pairing.ts';
import { makeSignInCode, useAnywhere } from '../store/anywhere.ts';
import { becomeWallScreen, defaultScreenName, removeScreen, renameScreen, useScreens } from '../store/screens.ts';
import { useSession } from '../store/session.ts';
import { showToast } from '../store/toasts.ts';
import { useQrSvg } from '../wall/ConnectCard.tsx';
import { Switch } from './Switch.tsx';

// The Wall tab's sections about devices: connecting phones and computers (at home and,
// when it's set up, from anywhere), and the devices that show the wall.

const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

/** This app's own address, for when the wall computer hasn't said which one to use. */
function ownAddress(): string {
  return new URL('.', document.baseURI).href;
}

/** "Connect another device": a sign-in code for the new device to scan or type. */
function ConnectAnother({ base, now }: { base: string; now: Date }) {
  const [invite, setInvite] = useState<PairCode | null>(null);
  const [failed, setFailed] = useState(false);
  const svg = useQrSvg(invite ? pairUrl(base, invite.code) : base);
  const expired = invite !== null && now.getTime() >= invite.expiresAt;

  const make = async () => {
    setFailed(false);
    const code = await makeSignInCode();
    if (code) setInvite(code);
    else setFailed(true);
  };

  if (!invite) {
    return (
      <>
        <button type="button" className="btn btn-sm" onClick={() => void make()}>
          <Smartphone aria-hidden="true" /> Connect another device
        </button>
        {failed && (
          <p className="ne-error" role="alert">
            Couldn’t make a code. Check the connection and try again.
          </p>
        )}
      </>
    );
  }
  return (
    <div className="invite" role="group" aria-label="Connect another device">
      <div className={`invite-qr${expired ? ' is-expired' : ''}`} aria-label={`QR code for signing in at ${hostOf(base)}`} dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="invite-text">
        {expired ? (
          <p>This code has expired.</p>
        ) : (
          <>
            <p>
              On the other device, point the camera at this code. Or open <strong>{hostOf(base)}</strong> there and type:
            </p>
            <p className="invite-code">{formatPairCode(invite.code)}</p>
            <p className="set-note">It works once, for 10 minutes.</p>
          </>
        )}
        <div className="set-row">
          {expired && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void make()}>
              Make a new code
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setInvite(null)}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConnectProps {
  connectUrl: string | null;
  showConnect: boolean;
  onShowConnect: (show: boolean) => void;
  now: Date;
}

/** Connect a phone or computer: the wall's code, where the board can be used, and codes for more devices. */
export function ConnectSection({ connectUrl, showConnect, onShowConnect, now }: ConnectProps) {
  const session = useSession();
  const anywhere = useAnywhere();
  const pinSet = __DEMO_BUILD__ || !!session?.pinSet;
  const anywhereUrl = anywhere?.url ?? null;
  // A code only helps where devices sign in: from anywhere, or on a board with a PIN.
  const canInvite = anywhereUrl !== null || pinSet;

  return (
    <section className="set-group">
      <h3>
        <QrCode aria-hidden="true" /> Connect a phone or computer
      </h3>
      <Switch id="show-qr" checked={showConnect} label="Show the “Connect your phone” code on the wall" onChange={onShowConnect} />
      {anywhereUrl ? (
        <div className="access-status is-on">
          <Globe aria-hidden="true" />
          <p>
            <strong>From anywhere: on.</strong> The board’s address is <strong className="access-host">{hostOf(anywhereUrl)}</strong>. It works at home and
            away, and each device signs in once, by scanning the code on the wall.
          </p>
        </div>
      ) : (
        <div className="access-status">
          <House aria-hidden="true" />
          <p>
            <strong>Home Wi-Fi only.</strong>{' '}
            {connectUrl ? (
              <>
                Wall address: <strong className="access-host">{hostOf(connectUrl)}</strong>.
              </>
            ) : (
              'The wall computer didn’t find its Wi-Fi address, so the code is hidden.'
            )}{' '}
            {anywhere && (
              <>
                To use the board from anywhere, run <code>scripts/linux/anywhere.sh</code> on the wall computer once. Nothing changes on your router.
              </>
            )}
          </p>
        </div>
      )}
      {canInvite && <ConnectAnother base={anywhereUrl ?? connectUrl ?? ownAddress()} now={now} />}
      <p className="set-note">
        <strong>Add it to your Home Screen:</strong> open the address in Safari, tap Share, then Add to Home Screen. It opens like an app.
        {canInvite && ` If it asks you to sign in there, type the code from the wall${pinSet ? ' or the PIN' : ''}.`}
      </p>
    </section>
  );
}

/** "Showing the wall now", "Last seen 3 hours ago". */
function seenLabel(screen: ScreenInfo, now: Date): string {
  if (screen.showing) return 'Showing the wall now';
  if (!screen.lastSeenAt) return 'Hasn’t shown the wall yet';
  const seen = parseISO(screen.lastSeenAt);
  return now.getTime() - seen.getTime() < 60_000 ? 'Last seen just now' : `Last seen ${formatDistanceStrict(seen, now, { addSuffix: true })}`;
}

function ScreenRow({ screen, now, signsIn }: { screen: ScreenInfo; now: Date; signsIn: boolean }) {
  const [mode, setMode] = useState<'view' | 'rename' | 'remove'>('view');
  const [name, setName] = useState(screen.name);
  const [busy, setBusy] = useState(false);

  const rename = async () => {
    const next = name.trim();
    if (!next || next === screen.name) {
      setMode('view');
      return;
    }
    setBusy(true);
    const ok = await renameScreen(screen.id, next);
    setBusy(false);
    if (ok) setMode('view');
    else showToast({ text: 'Couldn’t rename it. Check the connection and try again.' });
  };

  const remove = async () => {
    setBusy(true);
    const ok = await removeScreen(screen);
    setBusy(false);
    if (ok) showToast({ text: screen.thisDevice ? 'This device is no longer a wall screen.' : `“${screen.name}” is no longer a wall screen.` });
    else showToast({ text: 'Couldn’t remove it. Check the connection and try again.' });
  };

  return (
    <li className="screen-row">
      <span className={`screen-dot${screen.showing ? ' is-on' : ''}`} aria-hidden="true" />
      {mode === 'rename' ? (
        <form
          className="screen-rename"
          onSubmit={e => {
            e.preventDefault();
            void rename();
          }}
        >
          <input aria-label={`New name for ${screen.name}`} value={name} maxLength={60} autoFocus onChange={e => setName(e.target.value)} />
          <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !name.trim()}>
            Save
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMode('view')}>
            Cancel
          </button>
        </form>
      ) : (
        <span className="screen-text">
          <span className="screen-name">
            {screen.name}
            {screen.thisDevice && <span className="screen-tag">This device</span>}
          </span>
          <span className="screen-hint">{seenLabel(screen, now)}</span>
          {mode === 'remove' && (
            <span className="screen-confirm" role="group" aria-label={`Remove ${screen.name}?`}>
              <span>
                {screen.wallComputer
                  ? 'Remove it from the list? It comes back when it shows the wall again.'
                  : `It stops opening to the wall${signsIn ? ' and has to sign in again' : ''}.`}
              </span>
              <span className="set-row">
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove()}>
                  Remove
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMode('view')}>
                  Cancel
                </button>
              </span>
            </span>
          )}
        </span>
      )}
      {mode === 'view' && (
        <span className="screen-actions">
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label={`Rename ${screen.name}`}
            title="Rename"
            onClick={() => {
              setName(screen.name);
              setMode('rename');
            }}
          >
            <Pencil />
          </button>
          {!(screen.wallComputer && screen.showing) && (
            <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${screen.name}`} title="Remove" onClick={() => setMode('remove')}>
              <Trash2 />
            </button>
          )}
        </span>
      )}
    </li>
  );
}

/** Wall screens: the devices that show the wall, and making this device one. */
export function WallScreensSection({ now, go }: { now: Date; go: (token: string) => void }) {
  const session = useSession();
  const screens = useScreens();
  const [naming, setNaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const thisScreen = screens?.find(screen => screen.thisDevice && !screen.wallComputer) ?? null;
  const isWallComputer = !!session?.wallComputer;
  // Removed screens sign in again only where devices sign in at all.
  const signsIn = __DEMO_BUILD__ || !!session?.pinSet || !!session?.outside;

  const start = async () => {
    const name = naming?.trim();
    if (!name) return;
    setBusy(true);
    const ok = await becomeWallScreen(name);
    setBusy(false);
    if (!ok) {
      showToast({ text: 'Couldn’t set it up. Check the connection and try again.' });
      return;
    }
    setNaming(null);
    go('wall');
  };

  const stop = async () => {
    if (!thisScreen) return;
    if (await removeScreen(thisScreen)) showToast({ text: 'This device is no longer a wall screen.' });
    else showToast({ text: 'Couldn’t change it. Check the connection and try again.' });
  };

  return (
    <section className="set-group">
      <h3>
        <MonitorSmartphone aria-hidden="true" /> Wall screens
      </h3>
      <p className="set-note">Any device can show the wall: an iPad, a TV’s web browser, an old laptop. They all show the same board, live.</p>
      {screens === null ? (
        <p className="set-note">Checking…</p>
      ) : screens.length > 0 ? (
        <ul className="screen-list">
          {screens.map(screen => (
            <ScreenRow key={screen.id} screen={screen} now={now} signsIn={signsIn} />
          ))}
        </ul>
      ) : (
        <p className="set-note">None yet. The wall computer shows up here once it shows the wall.</p>
      )}
      {thisScreen ? (
        <div className="set-row">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => go('wall')}>
            Show the wall now
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void stop()}>
            Stop using this device as a wall screen
          </button>
        </div>
      ) : (
        !isWallComputer &&
        (naming === null ? (
          <button type="button" className="btn btn-sm" onClick={() => setNaming(defaultScreenName())}>
            <Plus aria-hidden="true" /> Use this device as a wall screen
          </button>
        ) : (
          <form
            className="screen-new"
            onSubmit={e => {
              e.preventDefault();
              void start();
            }}
          >
            <label className="field" htmlFor="screen-name">
              <span className="field-label">Name for this wall screen</span>
              <input id="screen-name" value={naming} maxLength={60} placeholder="e.g. Kitchen iPad" onChange={e => setNaming(e.target.value)} />
            </label>
            <p className="set-note">It opens to the wall from now on. Tap the wall for Edit the board.</p>
            <div className="set-row">
              <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !naming.trim()}>
                Show the wall here
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNaming(null)}>
                Cancel
              </button>
            </div>
          </form>
        ))
      )}
      <details className="screen-tips">
        <summary>Tips for an iPad or a TV</summary>
        <ul>
          <li>On an iPad, add the board to the Home Screen first (Share, then Add to Home Screen) and open it from there, so the wall fills the screen.</li>
          <li>
            Keep it plugged in. At the internet address (From anywhere) the wall asks to keep the screen on; if it still goes dark, set Auto-Lock to Never in
            Settings, Display &amp; Brightness.
          </li>
          <li>Browsers hold sounds back until the wall is tapped once, so tap it after it opens.</li>
          <li>The phone remote controls the wall computer only.</li>
        </ul>
      </details>
    </section>
  );
}
