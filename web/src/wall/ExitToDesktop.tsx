import { Minimize2, PencilLine } from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigate } from '../lib/route.ts';

/** Only the wall computer's own browser (at localhost) can close the wall screen; the server checks too. */
export const CAN_EXIT_TO_DESKTOP = !__DEMO_BUILD__ && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

interface ExitToDesktopProps {
  /** The mouse is in use, so the button shows. */
  shown: boolean;
  /** The pointer is over the button (it stays up while it is). */
  onHover: (over: boolean) => void;
}

/**
 * "Exit to desktop", in a corner of the wall screen while the mouse is in use. It closes
 * the wall screen; the Sticky Wall icon in the dock (or the next login) brings it back.
 */
export function ExitToDesktop({ shown, onHover }: ExitToDesktopProps) {
  const [state, setState] = useState<'ready' | 'closing' | 'failed'>('ready');

  useEffect(() => {
    if (state !== 'failed') return;
    const id = window.setTimeout(() => setState('ready'), 6000);
    return () => window.clearTimeout(id);
  }, [state]);

  const exit = async () => {
    setState('closing');
    try {
      const response = await fetch(new URL('api/wall/close', document.baseURI), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      // When it works, this browser is closed before the answer arrives.
      setState(response.ok ? 'ready' : 'failed');
    } catch {
      setState('failed');
    }
  };

  return (
    <button
      type="button"
      className={`wall-exit${shown || state !== 'ready' ? ' is-shown' : ''}`}
      disabled={state === 'closing'}
      onClick={() => void exit()}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <Minimize2 aria-hidden="true" />
      <span>{state === 'failed' ? 'Couldn’t close it: press Alt+Tab' : state === 'closing' ? 'Closing…' : 'Exit to desktop'}</span>
    </button>
  );
}

/**
 * "Edit the board", in a corner of the wall on a wall screen (an iPad, a laptop) once it's
 * tapped or the mouse moves. It opens the board for editing on this device.
 */
export function EditTheBoard({ shown, onHover }: ExitToDesktopProps) {
  return (
    <button
      type="button"
      className={`wall-exit${shown ? ' is-shown' : ''}`}
      onClick={() => navigate('board')}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <PencilLine aria-hidden="true" />
      <span>Edit the board</span>
    </button>
  );
}
