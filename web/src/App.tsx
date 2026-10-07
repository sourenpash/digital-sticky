import { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { SAMPLE_PAIR_CODE } from '../../shared/sample.ts';
import type { Board } from '../../shared/types.ts';
import { EditorApp } from './editor/EditorApp.tsx';
import { Login } from './editor/Login.tsx';
import { PairScreen } from './editor/PairScreen.tsx';
import { RemoteScreen } from './editor/RemoteScreen.tsx';
import { useNow } from './lib/now.ts';
import { navigate, parseRoute, useHashToken, type Route } from './lib/route.ts';
import { DemoSplit } from './proto/DemoSplit.tsx';
import { ProtoBar } from './proto/ProtoBar.tsx';
import { SHOW_PROTO_BAR } from './proto/protoState.ts';
import { useBoard, useSync } from './store/board.ts';
import { useSession } from './store/session.ts';
import type { SyncStatus } from './store/sync.ts';
import { useSoundBlocked } from './wall/chime.ts';
import { CAN_EXIT_TO_DESKTOP, EditTheBoard, ExitToDesktop } from './wall/ExitToDesktop.tsx';
import { wallMode } from './wall/night.ts';
import { Wall } from './wall/Wall.tsx';
import { useBurnInDrift, useCheckIn, useLongOffline, useMouseInUse, useWakeLock, useWallCode } from './wall/standalone.ts';

/** "Tap" on touch screens, "Click" with a mouse. */
const TAP = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click';

function defaultRoute(): Route {
  // The preview page opens the side-by-side demo on wide screens; the real app opens
  // the board (the wall screen is set up to open #wall).
  return __DEMO_BUILD__ && window.innerWidth >= 1100 ? { view: 'demo' } : { view: 'editor', tab: 'board' };
}

/**
 * The wall itself (#wall), on the wall computer or any wall screen: full screen, awake,
 * drifting a little, and honest about the connection. The pointer shows while the mouse
 * is in use (or after a tap), with a way out: to the desktop on the wall computer, to
 * editing the board everywhere else.
 */
function WallScreen({ board, now, connectUrl, status }: { board: Board; now: Date; connectUrl: string | null; status: SyncStatus }) {
  useWakeLock();
  const [x, y] = useBurnInDrift();
  const offline = useLongOffline(status);
  const mouse = useMouseInUse();
  const [onButton, setOnButton] = useState(false);
  const pointer = mouse || onButton;
  const session = useSession();
  // The wall computer and wall screens show sign-in codes (never over the internet), and check in.
  const isWall = !!session && (session.wallComputer || session.wallScreen);
  const code = useWallCode(isWall && !session.outside && board.settings.wall.showConnect);
  useCheckIn(isWall);
  const soundBlocked = useSoundBlocked(board.settings.wall.chime && wallMode(board.settings, now) === 'day');
  return (
    <div className={`wall-standalone${pointer ? ' is-pointer' : ''}`} style={{ transform: `translate(${x}px, ${y}px)` }}>
      <Wall board={board} now={now} connectUrl={connectUrl} pairCode={__DEMO_BUILD__ ? SAMPLE_PAIR_CODE : code} sound offline={offline} />
      {CAN_EXIT_TO_DESKTOP && session?.wallComputer ? (
        <ExitToDesktop shown={pointer} onHover={setOnButton} />
      ) : (
        <EditTheBoard shown={pointer} onHover={setOnButton} />
      )}
      {soundBlocked && (
        <p className="wall-sound-hint">
          <Volume2 aria-hidden="true" /> {TAP} anywhere to turn on sounds
        </p>
      )}
    </div>
  );
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

  // The PIN screen has its own address only on the preview page; once signed in it moves on.
  const signedIn = sync.status !== 'locked' && sync.status !== 'loading';
  useEffect(() => {
    if (!__DEMO_BUILD__ && route.view === 'login' && signedIn) navigate('board');
  }, [route.view, signedIn]);

  const current = route.view === 'editor' ? 'board' : route.view;
  let screen;
  if (route.view === 'pair') {
    screen = <PairScreen code={route.code} />;
  } else if (sync.status === 'locked') {
    screen = <Login wall={route.view === 'wall' || route.view === 'demo'} />;
  } else if (sync.status === 'loading') {
    screen = <Loading wall={route.view === 'wall'} />;
  } else {
    switch (route.view) {
      case 'wall':
        screen = <WallScreen board={data} now={now} connectUrl={sync.connectUrl} status={sync.status} />;
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
