import { useState } from 'react';
import type { Board } from '../../../shared/types.ts';
import { SAMPLE_CONNECT_URL } from '../data/sample.ts';
import { EditorApp, type EditorRoute } from '../editor/EditorApp.tsx';
import { Login } from '../editor/Login.tsx';
import { parseRoute } from '../lib/route.ts';
import { Wall } from '../wall/Wall.tsx';

/** Prototype landing page: the phone app and the wall side by side, sharing one board. */
export function DemoSplit({ board, now }: { board: Board; now: Date }) {
  const [token, setToken] = useState('board');
  const route = parseRoute(token);
  const editorRoute: EditorRoute = route?.view === 'editor' ? route : { tab: 'board' };

  return (
    <div className="demo">
      <header className="demo-head">
        <div className="demo-title">
          <span className="brand-mark" aria-hidden="true" />
          <h1>Digital Sticky</h1>
          <span className="demo-tag">Prototype</span>
        </div>
        <p>Tap around on the phone: add a note, tick a checklist item, mark a recurring task done, bump a goal. The wall updates instantly. This is sample data and nothing is saved.</p>
      </header>
      <div className="demo-stage">
        <div className="phone-frame">
          <div className="phone-screen">
            {route?.view === 'login' ? <Login onUnlock={() => setToken('board')} /> : <EditorApp route={editorRoute} go={setToken} />}
          </div>
        </div>
        <figure className="demo-wall">
          <div className="monitor">
            <Wall board={board} now={now} connectUrl={SAMPLE_CONNECT_URL} />
          </div>
          <figcaption>The bedroom wall screen, scaled down</figcaption>
        </figure>
      </div>
    </div>
  );
}
