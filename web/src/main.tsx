import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyPresetsFromUrl } from './proto/presets.ts';
import { engine } from './store/board.ts';
import { startLiveUpdates } from './store/live.ts';
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
else startLiveUpdates(engine, { onReloadRequest: () => window.location.hash === '#wall' && window.location.reload() });
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
