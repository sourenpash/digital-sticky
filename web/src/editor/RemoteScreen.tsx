import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import { ArrowLeft, ChevronLeft, CornerDownLeft, Delete, Globe, House, Keyboard, MousePointer2, RotateCw, TextCursorInput } from 'lucide-react';
import { typingChange, websiteUrl } from '../lib/remoteInput.ts';
import type { RemoteField } from '../../../shared/remote.ts';
import { liveRemote, previewRemote, useRemoteLink, type RemoteController, type RemoteKey, type RemoteLink, type RemotePlace } from '../store/remote.ts';
import { Toasts } from './Toasts.tsx';

/** Finger travel under this (px) and a lift within this (ms) is a tap, not a drag. */
const TAP_PX = 8;
const TAP_MS = 250;

interface Touch {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

/**
 * The touchpad: one finger moves the cursor (faster swipes go further), a tap clicks
 * (two quick taps double-click), two fingers scroll.
 */
function Touchpad({ remote, onTap }: { remote: RemoteController; onTap: () => void }) {
  const touches = useRef(new Map<number, Touch>());
  const gesture = useRef({ startedAt: 0, moved: false, fingers: 0 });
  const [finger, setFinger] = useState<{ x: number; y: number } | null>(null);
  const [tapped, setTapped] = useState(0);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (touches.current.size === 0) gesture.current = { startedAt: Date.now(), moved: false, fingers: 0 };
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
    gesture.current.fingers = Math.max(gesture.current.fingers, touches.current.size);
    const box = e.currentTarget.getBoundingClientRect();
    setFinger({ x: e.clientX - box.left, y: e.clientY - box.top });
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const touch = touches.current.get(e.pointerId);
    if (!touch) return;
    let dx = e.clientX - touch.x;
    let dy = e.clientY - touch.y;
    let gain = 2.2 * (1 + Math.min(2.5, Math.hypot(dx, dy) / 10));
    touch.x = e.clientX;
    touch.y = e.clientY;
    // A finger that hasn't gone far may still be a tap: hold its movement back, so taps
    // don't nudge the cursor (and two taps stay a double click). Once it's a drag, catch up.
    if (!gesture.current.moved) {
      if (Math.hypot(e.clientX - touch.startX, e.clientY - touch.startY) <= TAP_PX) return;
      gesture.current.moved = true;
      dx = e.clientX - touch.startX;
      dy = e.clientY - touch.startY;
      gain = 2.2;
    }
    if (touches.current.size === 1) {
      remote.move(dx * gain, dy * gain);
      const box = e.currentTarget.getBoundingClientRect();
      setFinger({ x: e.clientX - box.left, y: e.clientY - box.top });
    } else {
      // Each finger reports its own movement: half each is the pair's.
      remote.scroll(dx / 2, dy / 2);
    }
  };

  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!touches.current.delete(e.pointerId)) return;
    if (touches.current.size > 0) return;
    setFinger(null);
    const { startedAt, moved, fingers } = gesture.current;
    if (!moved && fingers === 1 && Date.now() - startedAt < TAP_MS) {
      remote.click();
      onTap();
      setTapped(n => n + 1);
    }
  };

  return (
    <div
      className="pad"
      role="application"
      aria-label="Touchpad: drag to move the cursor, tap to click, two fingers to scroll"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <div className="pad-hint" aria-hidden="true">
        <MousePointer2 />
        <span>Drag to move · Tap to click</span>
        <span>Two fingers to scroll</span>
      </div>
      {finger && <span className="pad-finger" style={{ left: finger.x, top: finger.y }} />}
      {tapped > 0 && <span key={tapped} className="pad-tap" aria-hidden="true" />}
    </div>
  );
}

const KEYS: Array<{ key: RemoteKey; label: string; icon?: typeof Delete }> = [
  { key: 'Enter', label: 'Enter', icon: CornerDownLeft },
  { key: 'Backspace', label: 'Delete', icon: Delete },
  { key: 'Tab', label: 'Tab' },
  { key: 'Escape', label: 'Esc' },
  { key: 'ArrowLeft', label: '←' },
  { key: 'ArrowUp', label: '↑' },
  { key: 'ArrowDown', label: '↓' },
  { key: 'ArrowRight', label: '→' },
];

type Panel = 'keyboard' | 'website' | null;

/** The phone keyboard to match the text box on the wall (a password stays out of the phone's suggestions). */
function keyboardFor(field: RemoteField | null): { type: 'text' | 'password'; inputMode: 'text' | 'email' | 'url' | 'decimal' | 'tel' | 'search'; words: boolean } {
  switch (field) {
    case 'password':
      return { type: 'password', inputMode: 'text', words: false };
    case 'email':
      return { type: 'text', inputMode: 'email', words: false };
    case 'url':
      return { type: 'text', inputMode: 'url', words: false };
    case 'number':
      return { type: 'text', inputMode: 'decimal', words: false };
    case 'tel':
      return { type: 'text', inputMode: 'tel', words: false };
    case 'search':
      return { type: 'text', inputMode: 'search', words: true };
    default:
      return { type: 'text', inputMode: 'text', words: true };
  }
}

function statusChip(link: RemoteLink, live: boolean): { text: string; on: boolean } {
  if (!live) return { text: 'Preview', on: false };
  switch (link.state) {
    case 'ready':
      return { text: 'Connected', on: true };
    case 'checking':
      return { text: 'Connecting…', on: false };
    case 'offline':
      return { text: 'Offline', on: false };
    default:
      return { text: 'Not connected', on: false };
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** A line about the connection, or about what the wall shows when it isn't the board. */
function RemoteNote({ link, live, preview }: { link: RemoteLink; live: boolean; preview: boolean }) {
  if (preview) return <p className="remote-note">Drag on the touchpad and watch the cursor on the wall.</p>;
  if (!live) return <p className="remote-note">On the wall computer this moves a cursor on the wall screen and types there. Here you can try the controls.</p>;
  if (link.state === 'offline') return <p className="remote-note">Can’t reach the board. Is this phone on the same Wi-Fi as the wall computer?</p>;
  if (link.state === 'unavailable') {
    return (
      <p className="remote-note">
        {link.reason === 'off'
          ? 'Remote control is turned off on the wall computer (KIOSK_DEBUG_PORT is off in its .env file).'
          : 'Can’t find the wall’s browser. The remote works when the wall screen is started by the installer, which turns remote control on. Restart the wall computer, or run scripts/linux/kiosk.sh on it.'}
      </p>
    );
  }
  if (link.state === 'ready' && !link.onBoard) {
    return (
      <p className="remote-showing">
        On the wall: <strong>{link.title || hostOf(link.url)}</strong>
      </p>
    );
  }
  return null;
}

/**
 * Control the wall screen from a phone: a touchpad, a keyboard, and a few big buttons.
 * `preview`: next to the wall on the side-by-side page, where it moves a cursor there.
 */
export function RemoteScreen({ go, preview = false }: { go: (token: string) => void; preview?: boolean }) {
  // The single-file preview has no wall computer to talk to.
  const live = !preview && !__DEMO_BUILD__;
  const remote = live ? liveRemote : previewRemote;
  const link = useRemoteLink(live);
  const [panel, setPanel] = useState<Panel>(null);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [address, setAddress] = useState('');
  const typeField = useRef<HTMLInputElement>(null);
  const addressField = useRef<HTMLInputElement>(null);
  /** What the wall has been sent from the typing field (it mirrors the field). */
  const sent = useRef('');
  const url = websiteUrl(address);
  const chip = statusChip(link, live);

  const clearTyping = () => {
    sent.current = '';
    setText('');
  };

  // iPhones only bring up the keyboard when focus() happens inside the tap itself, so
  // the field is rendered right away (flushSync) and focused in the same handler.
  const open = (next: 'keyboard' | 'website') => {
    if (panel !== next) flushSync(() => setPanel(next));
    (next === 'keyboard' ? typeField : addressField).current?.focus();
  };
  const toggle = (next: 'keyboard' | 'website') => {
    if (panel === next) setPanel(null);
    else open(next);
  };

  // Keys and buttons move the wall's text cursor, so the typing field starts over after them.
  const pressKey = (key: RemoteKey) => {
    remote.key(key);
    clearTyping();
  };
  const goTo = (place: RemotePlace) => {
    remote.go(place);
    clearTyping();
  };
  const keyboard = keyboardFor(live ? link.field : null);

  const typed = (value: string) => {
    const { backspaces, text: added } = typingChange(sent.current, value);
    for (let i = 0; i < backspaces; i++) remote.key('Backspace');
    if (added) remote.type(added);
    sent.current = value;
    setText(value);
  };

  return (
    <div className="remote">
      <header className="remote-head">
        <button type="button" className="icon-btn" aria-label="Back to Wall settings" onClick={() => go('display')}>
          <ChevronLeft />
        </button>
        <h1>Wall remote</h1>
        <span className={`remote-status${chip.on ? ' is-on' : ''}`}>{chip.text}</span>
      </header>

      <RemoteNote link={link} live={live} preview={preview} />

      {live && link.dialog && (
        <div className="remote-dialog" role="alertdialog" aria-labelledby="remote-dialog-text">
          <p id="remote-dialog-text">
            <span>The wall asks:</span> {link.dialog.message || 'OK to go on?'}
          </p>
          <div className="remote-dialog-actions">
            <button type="button" className="btn btn-sm" onClick={() => remote.answer(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => remote.answer(true)}>
              OK
            </button>
          </div>
        </div>
      )}

      <Touchpad remote={remote} onTap={clearTyping} />

      {live && link.state === 'ready' && link.field && !typing ? (
        <button type="button" className="remote-typebar" onClick={() => open('keyboard')}>
          <TextCursorInput aria-hidden="true" />
          <span>
            A text box is selected on the wall. <strong>Tap to type</strong>
          </span>
        </button>
      ) : (
        panel !== 'keyboard' && !link.dialog && <p className="remote-hint">Select a text box on the wall to type into it.</p>
      )}

      {panel === 'keyboard' && (
        <div className="remote-panel">
          <form
            className="remote-type"
            onSubmit={e => {
              e.preventDefault();
              pressKey('Enter');
            }}
          >
            <input
              ref={typeField}
              aria-label="Type on the wall"
              value={text}
              placeholder="Letters go to the wall as you type"
              type={keyboard.type}
              inputMode={keyboard.inputMode}
              autoCapitalize={keyboard.words ? 'sentences' : 'off'}
              autoComplete="off"
              autoCorrect={keyboard.words ? 'on' : 'off'}
              spellCheck={keyboard.words}
              enterKeyHint="enter"
              maxLength={2000}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              onChange={e => typed(e.target.value)}
              onKeyDown={e => {
                // Backspace with nothing left here still deletes on the wall.
                if (e.key === 'Backspace' && e.currentTarget.value === '') remote.key('Backspace');
              }}
            />
          </form>
          <div className="remote-keys">
            {KEYS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" className="remote-key" aria-label={label} onClick={() => pressKey(key)}>
                {Icon ? <Icon aria-hidden="true" /> : label}
              </button>
            ))}
          </div>
        </div>
      )}

      {panel === 'website' && (
        <form
          className="remote-panel remote-type"
          onSubmit={e => {
            e.preventDefault();
            if (!url) return;
            goTo({ url });
            setAddress('');
            setPanel(null);
          }}
        >
          <input
            ref={addressField}
            aria-label="Website to open on the wall"
            value={address}
            placeholder="e.g. youtube.com"
            inputMode="url"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            onChange={e => setAddress(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!url}>
            Open
          </button>
        </form>
      )}

      <nav className="remote-bar" aria-label="Wall controls">
        <button type="button" className={`remote-btn${panel === 'keyboard' ? ' is-on' : ''}`} aria-pressed={panel === 'keyboard'} onClick={() => toggle('keyboard')}>
          <Keyboard aria-hidden="true" />
          <span>Keyboard</span>
        </button>
        <button type="button" className="remote-btn" onClick={() => goTo('back')}>
          <ArrowLeft aria-hidden="true" />
          <span>Back</span>
        </button>
        <button type="button" className={`remote-btn${live && link.state === 'ready' && !link.onBoard ? ' is-hint' : ''}`} onClick={() => goTo('board')}>
          <House aria-hidden="true" />
          <span>Board</span>
        </button>
        <button type="button" className="remote-btn" onClick={() => goTo('reload')}>
          <RotateCw aria-hidden="true" />
          <span>Reload</span>
        </button>
        <button type="button" className={`remote-btn${panel === 'website' ? ' is-on' : ''}`} aria-pressed={panel === 'website'} onClick={() => toggle('website')}>
          <Globe aria-hidden="true" />
          <span>Website</span>
        </button>
      </nav>
      {live && <Toasts />}
    </div>
  );
}
