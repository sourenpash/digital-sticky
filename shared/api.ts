import type { Op } from './ops.ts';
import type { Board } from './types.ts';

// The HTTP API between the board server and the app. Paths are relative ("api/…")
// so the app also works when it's served from a sub-path.

/** GET api/state */
export interface StateResponse {
  /** Changes every time the server starts; a new epoch means "forget what you had". */
  epoch: string;
  /** Goes up by one with every change. */
  rev: number;
  board: Board;
  /** Address phones can open, for the "Connect your phone" code. */
  connectUrl: string | null;
}

/** Every change answers with the revision that includes it. */
export interface ChangeResponse {
  epoch: string;
  rev: number;
}

export interface ErrorResponse {
  error: string;
}

/** `hello` event on api/events: sent on every (re)connect. */
export interface HelloEvent {
  epoch: string;
  rev: number;
  buildId: string;
}

/** `change` event on api/events: the board moved on; fetch api/state to catch up. */
export interface ChangeEvent {
  epoch: string;
  rev: number;
}

export interface ApiRequest {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
}

/** JSON drops `undefined`, so a cleared field goes over the wire as `null`. */
function wire(patch: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === undefined ? null : value]));
}

const seg = encodeURIComponent;

/** The request that carries out an operation on the server. */
export function requestFor(op: Op): ApiRequest {
  switch (op.type) {
    case 'note.add':
      return { method: 'POST', path: 'api/notes', body: op.note };
    case 'note.patch':
      return { method: 'PATCH', path: `api/notes/${seg(op.id)}`, body: wire(op.patch) };
    case 'note.delete':
      return { method: 'DELETE', path: `api/notes/${seg(op.id)}` };
    case 'note.restore':
      return { method: 'POST', path: `api/notes/${seg(op.id)}/restore`, body: {} };
    case 'note.completions':
      return { method: 'POST', path: `api/notes/${seg(op.id)}/completions`, body: { add: op.add ?? [], remove: op.remove ?? [] } };
    case 'lane.add':
      return { method: 'POST', path: 'api/lanes', body: op.lane };
    case 'lane.patch':
      return { method: 'PATCH', path: `api/lanes/${seg(op.id)}`, body: wire(op.patch) };
    case 'lane.delete':
      return { method: 'DELETE', path: `api/lanes/${seg(op.id)}` };
    case 'lane.restore':
      return { method: 'POST', path: `api/lanes/${seg(op.id)}/restore`, body: {} };
    case 'lane.order':
      return { method: 'PUT', path: 'api/lanes/order', body: { ids: op.ids } };
    case 'goal.add':
      return { method: 'POST', path: 'api/goals', body: op.goal };
    case 'goal.patch':
      return { method: 'PATCH', path: `api/goals/${seg(op.id)}`, body: wire(op.patch) };
    case 'goal.delete':
      return { method: 'DELETE', path: `api/goals/${seg(op.id)}` };
    case 'goal.restore':
      return { method: 'POST', path: `api/goals/${seg(op.id)}/restore`, body: {} };
    case 'settings.patch':
      return { method: 'PATCH', path: 'api/settings', body: op.patch };
    case 'alert.fire':
      return { method: 'POST', path: 'api/alerts', body: { id: op.id, noteId: op.noteId } };
    case 'alert.dismiss':
      return { method: 'DELETE', path: `api/alerts/${seg(op.id)}` };
  }
}
