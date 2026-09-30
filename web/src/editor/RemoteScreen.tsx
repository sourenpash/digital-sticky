import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, ChevronLeft, CornerDownLeft, Delete, Globe, House, Keyboard, MousePointer2, RotateCw } from 'lucide-react';
import { remote, type RemoteKey } from '../store/remote.ts';
import { normalizeUrl } from './NoteEditor.tsx';

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
 * The touchpad: one finger moves the cursor (faster swipes go further), a tap clicks,
 * two fingers scroll.
 */
function Touchpad() {
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
    const dx = e.clientX - touch.x;
    const dy = e.clientY - touch.y;
    touch.x = e.clientX;
    touch.y = e.clientY;
    if (Math.hypot(e.clientX - touch.startX, e.clientY - touch.startY) > TAP_PX) gesture.current.moved = true;
    if (touches.current.size === 1) {
      const speed = Math.hypot(dx, dy);
      const gain = 2.2 * (1 + Math.min(2.5, speed / 10));
      remote.move(dx * gain, dy * gain);
      const box = e.currentTarget.getBoundingClientRect();
      setFinger({ x: e.clientX - box.left, y: e.clientY - box.top });
    } else {
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

/**
 * Control the wall screen from a phone: a touchpad, a keyboard, and a few big buttons.
 * `preview`: next to the wall on the side-by-side page, where it moves a cursor there.
 */
export function RemoteScreen({ go, preview = false }: { go: (token: string) => void; preview?: boolean }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [text, setText] = useState('');
  const [address, setAddress] = useState('');
  const url = normalizeUrl(address);
  const toggle = (next: Panel) => setPanel(current => (current === next ? null : next));

  return (
    <div className="remote">
      <header className="remote-head">
        <button type="button" className="icon-btn" aria-label="Back to Wall settings" onClick={() => go('display')}>
          <ChevronLeft />
        </button>
        <h1>Wall remote</h1>
        <span className={`remote-status${remote.connected ? ' is-on' : ''}`}>{preview ? 'Preview' : remote.connected ? 'Connected' : 'Not set up yet'}</span>
      </header>

      {preview ? (
        <p className="remote-note">Drag on the touchpad and watch the cursor on the wall.</p>
      ) : (
        !remote.connected && <p className="remote-note">This starts working once the wall computer is set up, in the last step. For now you can try the controls.</p>
      )}

      <Touchpad />
      <p className="remote-hint">When a text box on the wall is selected, a “Type into it” button shows up here.</p>

      {panel === 'keyboard' && (
        <div className="remote-panel">
          <form
            className="remote-type"
            onSubmit={e => {
              e.preventDefault();
              if (text) remote.type(text);
              remote.key('Enter');
              setText('');
            }}
          >
            <input
              aria-label="Type on the wall"
              value={text}
              placeholder="Type here to type on the wall"
              autoFocus
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="send"
              onChange={e => setText(e.target.value)}
            />
          </form>
          <div className="remote-keys">
            {KEYS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" className="remote-key" aria-label={label} onClick={() => remote.key(key)}>
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
            remote.go({ url });
            setAddress('');
            setPanel(null);
          }}
        >
          <input aria-label="Website to open on the wall" value={address} placeholder="e.g. youtube.com" inputMode="url" autoFocus autoCapitalize="off" autoComplete="off" autoCorrect="off" enterKeyHint="go" onChange={e => setAddress(e.target.value)} />
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
        <button type="button" className="remote-btn" onClick={() => remote.go('back')}>
          <ArrowLeft aria-hidden="true" />
          <span>Back</span>
        </button>
        <button type="button" className="remote-btn" onClick={() => remote.go('board')}>
          <House aria-hidden="true" />
          <span>Board</span>
        </button>
        <button type="button" className="remote-btn" onClick={() => remote.go('reload')}>
          <RotateCw aria-hidden="true" />
          <span>Reload</span>
        </button>
        <button type="button" className={`remote-btn${panel === 'website' ? ' is-on' : ''}`} aria-pressed={panel === 'website'} onClick={() => toggle('website')}>
          <Globe aria-hidden="true" />
          <span>Website</span>
        </button>
      </nav>
    </div>
  );
}
