import type { AiConnectionKind } from './ai.ts';
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

/** `connect` event on api/events: the address phones can open changed. */
export interface ConnectEvent {
  connectUrl: string | null;
}

/** GET api/session: whether this device has to sign in, and how it got in. */
export interface SessionResponse {
  pinSet: boolean;
  signedIn: boolean;
  /** The wall computer itself (localhost), which never signs in. */
  wallComputer: boolean;
  /** A device set up as a wall screen. */
  wallScreen: boolean;
  /** This request came from the internet (through Tailscale), not the home Wi-Fi. */
  outside: boolean;
}

/** A device set up as a wall screen (GET api/screens). */
export interface ScreenInfo {
  id: string;
  name: string;
  addedAt: string;
  lastSeenAt: string | null;
  /** Checked in within the last few minutes. */
  showing: boolean;
  /** The device asking. */
  thisDevice: boolean;
  wallComputer: boolean;
}

/** A sign-in code (shared/pairing.ts): it works once, until `expiresAt` (ms since 1970). */
export interface PairCode {
  code: string;
  expiresAt: number;
}

/** GET api/pair-code: the code the wall shows, or none when no device needs one (no PIN, and only used at home). */
export type WallCode = PairCode | { code: null };

/** GET api/anywhere: the board's internet address, when it can be used from anywhere. */
export interface AnywhereStatus {
  url: string | null;
}

/** An AI connection (GET api/ai). Its token is never sent back, only its last 4 characters. */
export interface AiConnectionInfo {
  id: string;
  kind: AiConnectionKind;
  name: string;
  /** The routine's fire address, OpenClaw's address, or the webhook's. */
  url: string | null;
  /** "abcd" of a token ending in abcd; null when none is saved. */
  tokenEnd: string | null;
  isDefault: boolean;
  /** What's wrong, when wake-ups have stopped until it's fixed (a wrong token, say). */
  problem: string | null;
  /** The last time the board woke it (or tried to). */
  lastWake: { at: string; ok: boolean; message: string; url?: string } | null;
}

/** GET api/ai: how AIs connect to the board, and the ones that can be woken. */
export interface AiOverview {
  /**
   * The board's MCP links (they include a secret): from anywhere, and on the home Wi-Fi,
   * when the board knows those addresses. `path` is the link's path, for the app to put
   * after its own address when it knows neither.
   */
  mcp: { anywhere: string | null; home: string | null; path: string | null };
  /** The last time an AI used the board over MCP, and which. */
  lastUsed: { at: string; client: string } | null;
  connections: AiConnectionInfo[];
  /** Wake-ups so far today (the limit is settings.ai.dailyCap). */
  wakesToday: number;
}

/** POST api/ai/connections/:id/test */
export interface AiTestResult {
  ok: boolean;
  message: string;
  url?: string;
}

/** A device that gets notifications (GET api/push). */
export interface PushDeviceInfo {
  id: string;
  name: string;
  addedAt: string;
  lastSentAt: string | null;
  /** Why the last one didn't go through, if it didn't. */
  problem: string | null;
  /** The end of its push address, so a device can tell it's the one. */
  endpointEnd: string;
}

/** GET api/push: the key browsers subscribe with, and the devices that get notifications. */
export interface PushOverview {
  publicKey: string;
  devices: PushDeviceInfo[];
}

/** Texts through iMessage (GET api/imessage). The BlueBubbles password never comes back. */
export interface IMessageInfo {
  /** BlueBubbles Server's address, like http://mac-mini.local:1234. */
  url: string | null;
  passwordSet: boolean;
  /** Phone numbers and Apple IDs that get the texts, and may text the board. */
  addresses: string[];
  reminders: boolean;
  followUps: boolean;
  morning: boolean;
  /** `HH:MM`, for the morning summary. */
  morningTime: string;
  /** The link BlueBubbles sends new messages to (it holds a secret): from anywhere, and on the home Wi-Fi. */
  webhook: { anywhere: string | null; home: string | null; path: string };
  lastSent: { at: string; ok: boolean; message: string } | null;
  lastReceived: { at: string; from: string; text: string } | null;
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
