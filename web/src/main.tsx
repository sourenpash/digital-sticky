import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { currentToken, navigate, startToken } from './lib/route.ts';
import { applyPresetsFromUrl } from './proto/presets.ts';
import { engine } from './store/board.ts';
import { startLiveUpdates } from './store/live.ts';
import { listenForNotificationTaps } from './store/push.ts';
import { setWallScreenHint, wallScreenHint } from './store/screens.ts';
import { currentSession, refreshSession } from './store/session.ts';
import { refreshTicker } from './store/ticker.ts';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/note.css';
import './styles/wall.css';
import './styles/editor.css';
import './styles/proto.css';

// The preview page runs on sample data (and `?preset=` sets it up for screenshots);
// the real app connects to the board server for the board and live updates.
if (__DEMO_BUILD__) applyPresetsFromUrl();
else {
  startLiveUpdates(engine, {
    onReloadRequest: () => window.location.hash === '#wall' && window.location.reload(),
    onTicker: () => void refreshTicker(),
  });
  openWallOnWallScreens();
  listenForNotificationTaps(hash => navigate(hash));
}

/**
 * A device set up as a wall screen opens straight to the wall (its Home Screen app opens
 * at #board). It remembers being one, so the wall shows at once; the server confirms.
 */
function openWallOnWallScreens(): void {
  const atStart = startToken === '' || startToken === 'board';
  const guessed = atStart && wallScreenHint();
  if (guessed) navigate('wall', { replace: true });
  void refreshSession().then(() => {
    const session = currentSession();
    if (!session) return;
    if (session.wallScreen && !wallScreenHint()) {
      setWallScreenHint(true);
      if (atStart && currentToken() === startToken) navigate('wall', { replace: true });
    } else if (!session.wallScreen && wallScreenHint()) {
      // Removed in the Wall tab meanwhile: open the board as asked after all.
      setWallScreenHint(false);
      if (guessed && currentToken() === 'wall') navigate(startToken || 'board', { replace: true });
    }
  });
}
// Word hyphenation on the notes needs a language; the preview page has no <html lang>.
if (!document.documentElement.lang) document.documentElement.lang = 'en';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
