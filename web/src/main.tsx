import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyPresetsFromUrl } from './proto/presets.ts';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/note.css';
import './styles/wall.css';
import './styles/editor.css';
import './styles/proto.css';

applyPresetsFromUrl();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
