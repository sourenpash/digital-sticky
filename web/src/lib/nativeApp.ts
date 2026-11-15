import { useSyncExternalStore } from 'react';

// The board inside the iPhone app (ios/). The app shows this same web app, and tells it
// so before it starts: `window.stickyApp`, updated with a `sticky-app` event. The app
// sets reminders as notifications on the phone itself (from api/upcoming), so it doesn't
// use Web Push. Messages back go through `window.webkit.messageHandlers.stickyApp`.

export interface NativeAppState {
  version: string;
  /** Whether the phone shows the board's reminders: not asked yet, on, or turned off in Settings. */
  notifications: 'unknown' | 'on' | 'denied';
  /** The board's address the app opens. */
  address: string;
  /** How many reminders are set on the phone. */
  scheduled: number;
}

export type NativeAppMessage =
  | { type: 'boardChanged' }
  | { type: 'enableNotifications' }
  | { type: 'testNotification' }
  /** The iPhone's Settings, to turn notifications back on. */
  | { type: 'openPhoneSettings' }
  /** The app's own screen for the board's address. */
  | { type: 'changeAddress' };

interface AppWindow {
  stickyApp?: NativeAppState;
  webkit?: {
    messageHandlers?: {
      stickyApp?: { postMessage(message: NativeAppMessage): void };
    };
  };
}

const appWindow = () => window as unknown as AppWindow;

/** The app's state, or null in a browser. */
export function nativeApp(): NativeAppState | null {
  return appWindow().stickyApp ?? null;
}

export function tellApp(message: NativeAppMessage): void {
  appWindow().webkit?.messageHandlers?.stickyApp?.postMessage(message);
}

/** The app's state, kept up to date (null in a browser). */
export function useNativeApp(): NativeAppState | null {
  return useSyncExternalStore(listener => {
    window.addEventListener('sticky-app', listener);
    return () => window.removeEventListener('sticky-app', listener);
  }, nativeApp);
}

/**
 * Tells the app when the board changes (here or on another device), a few seconds
 * after it settles, so the reminders set on the phone stay current.
 */
export function tellAppAboutChanges(subscribe: (listener: () => void) => () => void, waitMs = 3000): () => void {
  if (!nativeApp()) return () => {};
  let timer: number | undefined;
  const stop = subscribe(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => tellApp({ type: 'boardChanged' }), waitMs);
  });
  return () => {
    window.clearTimeout(timer);
    stop();
  };
}
