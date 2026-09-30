import { useEffect, useState } from 'react';
import { EditorApp } from './editor/EditorApp.tsx';
import { Login } from './editor/Login.tsx';
import { RemoteScreen } from './editor/RemoteScreen.tsx';
import { useNow } from './lib/now.ts';
import { navigate, parseRoute, useHashToken, type Route } from './lib/route.ts';
import { DemoSplit } from './proto/DemoSplit.tsx';
import { ProtoBar } from './proto/ProtoBar.tsx';
import { SHOW_PROTO_BAR, useProto } from './proto/protoState.ts';
import { useBoard, useSync } from './store/board.ts';
import { Wall } from './wall/Wall.tsx';

function defaultRoute(): Route {
  // The preview page opens the side-by-side demo on wide screens; the real app opens
  // the board (the wall screen is set up to open #wall).
  return __DEMO_BUILD__ && window.innerWidth >= 1100 ? { view: 'demo' } : { view: 'editor', tab: 'board' };
}

/** Before the board has loaded. After a few seconds it says why it's still waiting. */
function Loading({ wall }: { wall: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className={`boot${wall ? ' is-wall' : ''}`} role="status">
      <span className="brand-mark" aria-hidden="true" />
      <p className="boot-title">{slow ? 'Can’t reach the board' : 'Loading the board…'}</p>
      {slow && <p className="boot-hint">Make sure the wall computer is on and on the same Wi-Fi. This page keeps trying.</p>}
    </div>
  );
}

export function App() {
  const token = useHashToken();
  const route = parseRoute(token) ?? defaultRoute();
  const data = useBoard();
  const sync = useSync();
  const now = useNow();
  const { titleFont } = useProto();

  useEffect(() => {
    document.documentElement.classList.toggle('font-clean', titleFont === 'clean');
  }, [titleFont]);

  const current = route.view === 'editor' ? 'board' : route.view;
  let screen;
  if (sync.status === 'loading') {
    screen = <Loading wall={route.view === 'wall'} />;
  } else {
    switch (route.view) {
      case 'wall':
        screen = (
          <div className="wall-standalone">
            <Wall board={data} now={now} connectUrl={sync.connectUrl} />
          </div>
        );
        break;
      case 'demo':
        screen = <DemoSplit board={data} now={now} connectUrl={sync.connectUrl} />;
        break;
      case 'login':
        screen = <Login onUnlock={() => navigate('board')} />;
        break;
      case 'remote':
        screen = <RemoteScreen go={navigate} />;
        break;
      default:
        screen = <EditorApp route={route} go={navigate} />;
    }
  }

  return (
    <>
      {screen}
      {__DEMO_BUILD__ && SHOW_PROTO_BAR && <ProtoBar current={current} />}
    </>
  );
}
