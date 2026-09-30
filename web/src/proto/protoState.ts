import { useSyncExternalStore } from 'react';

// Prototype-only switches (not part of the real app).

export type TitleFont = 'marker' | 'clean';

interface ProtoState {
  titleFont: TitleFont;
}

let state: ProtoState = { titleFont: 'marker' };
const listeners = new Set<() => void>();

export const proto = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  set(patch: Partial<ProtoState>) {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  },
};

export function useProto(): ProtoState {
  return useSyncExternalStore(proto.subscribe, proto.get);
}

/** `?proto=0` hides the prototype bar (screenshots). */
export const SHOW_PROTO_BAR = (() => {
  try {
    return new URLSearchParams(window.location.search).get('proto') !== '0';
  } catch {
    return true;
  }
})();
