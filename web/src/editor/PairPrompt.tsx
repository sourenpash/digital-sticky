import { useState } from 'react';
import { QrCode } from 'lucide-react';
import type { Board } from '../../../shared/types.ts';
import { board as store, useSync } from '../store/board.ts';
import { useSession } from '../store/session.ts';
import { showToast } from '../store/toasts.ts';

// Once a phone is connected, the wall's "Connect your phone" code has done its job.
// Phones (not the wall computer or wall screens) are asked once whether to hide it.

const ASKED_KEY = 'sticky-wall:asked-hide-code';
/** The preview page asks again after a reload, so the question can be seen more than once. */
let askedThisVisit = false;

function askedBefore(): boolean {
  if (__DEMO_BUILD__) return askedThisVisit;
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberAsked(): void {
  askedThisVisit = true;
  if (__DEMO_BUILD__) return;
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // Private browsing can refuse storage: it asks again next time, which is harmless.
  }
}

export function PairPrompt({ board }: { board: Board }) {
  const session = useSession();
  const { status } = useSync();
  const [answered, setAnswered] = useState(askedBefore);
  const isPhone = __DEMO_BUILD__ || (session !== null && !session.wallComputer && !session.wallScreen);
  if (answered || !board.settings.wall.showConnect || !isPhone || status !== 'live') return null;

  const answer = (hide: boolean) => {
    rememberAsked();
    setAnswered(true);
    if (!hide) return;
    store.updateSettings(s => ({ ...s, wall: { ...s.wall, showConnect: false } }));
    showToast({
      text: 'The code is hidden. Show it again under Wall, Connect a phone or computer.',
      actionLabel: 'Undo',
      action: () => store.updateSettings(s => ({ ...s, wall: { ...s.wall, showConnect: true } })),
    });
  };

  return (
    <section className="pair-prompt" aria-labelledby="pair-prompt-title">
      <QrCode className="pair-prompt-icon" aria-hidden="true" />
      <div className="pair-prompt-text">
        <h2 id="pair-prompt-title">This phone is connected</h2>
        <p>Hide the “Connect your phone” code on the wall? You can show it again any time under Wall.</p>
        <div className="pair-prompt-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => answer(true)}>
            Hide the code
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => answer(false)}>
            Keep showing it
          </button>
        </div>
      </div>
    </section>
  );
}
