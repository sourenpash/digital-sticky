import { useEffect } from 'react';
import { SAMPLE_CONNECT_URL } from './data/sample.ts';
import { EditorApp } from './editor/EditorApp.tsx';
import { Login } from './editor/Login.tsx';
import { useNow } from './lib/now.ts';
import { navigate, parseRoute, useHashToken, type Route } from './lib/route.ts';
import { DemoSplit } from './proto/DemoSplit.tsx';
import { ProtoBar } from './proto/ProtoBar.tsx';
import { SHOW_PROTO_BAR, useProto } from './proto/protoState.ts';
import { useBoard } from './store/board.ts';
import { Wall } from './wall/Wall.tsx';

function defaultRoute(): Route {
  // Prototype: wide screens open the side-by-side demo, phones open the editor.
  return window.innerWidth >= 1100 ? { view: 'demo' } : { view: 'editor', tab: 'board' };
}

export function App() {
  const token = useHashToken();
  const route = parseRoute(token) ?? defaultRoute();
  const data = useBoard();
  const now = useNow();
  const { titleFont } = useProto();

  useEffect(() => {
    document.documentElement.classList.toggle('font-clean', titleFont === 'clean');
  }, [titleFont]);

  const current = route.view === 'editor' ? 'board' : route.view;
  let screen;
  switch (route.view) {
    case 'wall':
      screen = (
        <div className="wall-standalone">
          <Wall board={data} now={now} connectUrl={SAMPLE_CONNECT_URL} />
        </div>
      );
      break;
    case 'demo':
      screen = <DemoSplit board={data} now={now} />;
      break;
    case 'login':
      screen = <Login onUnlock={() => navigate('board')} />;
      break;
    default:
      screen = <EditorApp route={route} go={navigate} />;
  }

  return (
    <>
      {screen}
      {SHOW_PROTO_BAR && <ProtoBar current={current} />}
    </>
  );
}
